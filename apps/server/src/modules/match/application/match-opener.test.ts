import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { UNKNOWN_PLAYER_NAME } from '../domain/directory.js';
import type { MatchNotifier } from '../domain/ports.js';
import {
  MatchOpener,
  type MatchStarter,
  type PlayerPresence,
  type QueueEviction,
} from './match-opener.js';
import type { MatchSeats, SeatWearing } from './match-runtime.js';

/**
 * Chemin unique d'ouverture : invitation et file d'attente passent par ici.
 *
 * Ce qui est verifie n'est pas du confort. Chaque joueur doit recevoir le nom
 * de l'AUTRE — le bug a deja ete commis, les deux voyaient « Adversaire ». Un
 * joueur qui commence un match doit quitter la file — sinon le worker le
 * rapparie et son second adversaire heritera d'un forfait. Et rien ne doit
 * etre annonce si les sieges ne sont pas libres.
 */

class RecordingNotifier implements MatchNotifier {
  readonly sent: { playerId: string; name: string; payload: unknown }[] = [];

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    this.sent.push({ playerId, name, payload });
  }

  foundBy(playerId: string): ServerMessage<'match:found'> | undefined {
    return this.sent.find((m) => m.playerId === playerId && m.name === 'match:found')?.payload as
      ServerMessage<'match:found'> | undefined;
  }
}

class FakeRuntime implements MatchStarter {
  readonly opened: {
    matchId: string;
    seats: MatchSeats;
    mode: string | undefined;
    ghost: {
      seat: 'a' | 'b';
      mmr: number;
      sourcePlayerId: string;
      displayName: string;
      league: string;
    } | null;
    rulesVariant: string | undefined;
    queueWaitMs: Partial<Record<'a' | 'b', number>> | undefined;
    /** Messages deja partis au moment de l'ouverture : l'ordre compte. */
    sentBefore: number;
  }[] = [];
  readonly abandonArmed: string[] = [];
  /** Ce que l'ouverture a pose sur chaque siege, pour pouvoir le relire. */
  readonly worn: {
    matchId: string;
    seat: 'a' | 'b';
    wearing: SeatWearing;
    /** Le match existait-il deja ? Le vrai runtime ignore un match inconnu. */
    existed: boolean;
  }[] = [];
  busy = new Set<string>();
  refuse = false;

  constructor(private readonly notifier: RecordingNotifier) {}

  isBusy(playerId: string): boolean {
    return this.busy.has(playerId);
  }

  setWearing(matchId: string, seat: 'a' | 'b', wearing: SeatWearing): void {
    this.worn.push({
      matchId,
      seat,
      wearing,
      existed: this.opened.some((opened) => opened.matchId === matchId),
    });
  }

  createMatch(input: {
    matchId: string;
    seed: string;
    seats: MatchSeats;
    mode?: 'RANKED' | 'CASUAL' | 'INVITE';
    ghost?: {
      seat: 'a' | 'b';
      mmr: number;
      sourcePlayerId: string;
      displayName: string;
      league: string;
    } | null;
    rulesVariant?: string;
    queueWaitMs?: Partial<Record<'a' | 'b', number>>;
  }): boolean {
    if (this.refuse) return false;
    this.opened.push({
      matchId: input.matchId,
      seats: input.seats,
      mode: input.mode,
      ghost: input.ghost ?? null,
      rulesVariant: input.rulesVariant,
      queueWaitMs: input.queueWaitMs,
      sentBefore: this.notifier.sent.length,
    });
    return true;
  }

  notePlayerDisconnected(playerId: string): void {
    this.abandonArmed.push(playerId);
  }
}

/**
 * Presence : tout le monde est connecte sous son nom, sauf ce qu'on retire.
 *
 * Les trois reponses sont **synchrones**, comme le registre de sessions reel :
 * c'est ce qui permet a l'ouverture de n'avoir aucun point de suspension.
 */
class FakePresence implements PlayerPresence {
  readonly absent = new Set<string>();
  readonly anonymous = new Set<string>();
  readonly leagues = new Map<string, string>();
  readonly wearing = new Map<string, SeatWearing>();

  isConnected(playerId: string): boolean {
    return !this.absent.has(playerId);
  }

  displayNameOf(playerId: string): string {
    return this.anonymous.has(playerId) ? UNKNOWN_PLAYER_NAME : `Nom de ${playerId}`;
  }

  wearingOf(playerId: string): SeatWearing {
    return this.wearing.get(playerId) ?? { ownedEffects: [], owned: [] };
  }

  leagueOf(playerId: string): string {
    return this.leagues.get(playerId) ?? 'sans_aura';
  }
}

class FakeQueue implements QueueEviction {
  readonly evicted: string[] = [];
  failure: Error | null = null;

  leave(playerId: string): Promise<void> {
    this.evicted.push(playerId);
    return this.failure === null ? Promise.resolve() : Promise.reject(this.failure);
  }
}

let notifier: RecordingNotifier;
let runtime: FakeRuntime;
let presence: FakePresence;
let queue: FakeQueue;
let opener: MatchOpener;

beforeEach(() => {
  notifier = new RecordingNotifier();
  runtime = new FakeRuntime(notifier);
  presence = new FakePresence();
  queue = new FakeQueue();
  opener = new MatchOpener(runtime, notifier, presence, queue);
});

const open = (mode: 'RANKED' | 'CASUAL' | 'INVITE' = 'RANKED'): string | null =>
  opener.open({ playerA: 'p1', playerB: 'p2', mode });

describe('MatchOpener', () => {
  it('assoit les deux joueurs a des places differentes dans le meme match', () => {
    const matchId = open();

    expect(matchId).not.toBeNull();
    expect(notifier.foundBy('p1')?.matchId).toBe(matchId);
    expect(notifier.foundBy('p2')?.matchId).toBe(matchId);
    expect(notifier.foundBy('p1')?.seat).not.toBe(notifier.foundBy('p2')?.seat);
    expect(runtime.opened).toHaveLength(1);
  });

  it('annonce a chaque joueur le nom de son ADVERSAIRE', () => {
    open();

    expect(notifier.foundBy('p1')?.opponent.displayName).toBe('Nom de p2');
    expect(notifier.foundBy('p2')?.opponent.displayName).toBe('Nom de p1');
  });

  /**
   * La ligue etait ecrite en dur (« bronze », qui n'est meme pas une ligue du
   * jeu). docs/05 : seule la ligue est publique, jamais le MMR.
   */
  it('annonce a chaque joueur la ligue de son ADVERSAIRE, jamais la sienne', () => {
    presence.leagues.set('p1', 'stable');
    presence.leagues.set('p2', 'legendaire');

    open();

    expect(notifier.foundBy('p1')?.opponent.league).toBe('legendaire');
    expect(notifier.foundBy('p2')?.opponent.league).toBe('stable');
  });

  /*
    L'apparence de l'adversaire partait vide : chacun voyait en face une tenue
    ecrite en dur dans le client, et la danse signature de l'autre n'avait
    aucun chemin pour arriver. Elle est publique — une tenue ne dit rien du
    coup qui sera joue — mais c'est celle de l'AUTRE, jamais la sienne.
  */
  it('annonce a chaque joueur l apparence de son ADVERSAIRE, jamais la sienne', () => {
    presence.wearing.set('p1', {
      ownedEffects: ['fx.shock'],
      owned: ['fx.shock', 'anim.hype.t2.floss'],
      look: { outfit: 'outfit.kimono', auraColor: 'color.violet', signature: 'anim.hype.t2.floss' },
    });
    presence.wearing.set('p2', {
      ownedEffects: [],
      owned: [],
      look: { hair: 'hair.long', signature: 'anim.calme.t3.moonwalk' },
    });

    open();

    expect(notifier.foundBy('p2')?.opponent.cosmetics).toEqual({
      outfit: 'outfit.kimono',
      auraColor: 'color.violet',
      signature: 'anim.hype.t2.floss',
    });
    expect(notifier.foundBy('p1')?.opponent.cosmetics).toEqual({
      hair: 'hair.long',
      signature: 'anim.calme.t3.moonwalk',
    });
  });

  /*
    Ce que le joueur possede ne part JAMAIS a l'ouverture : la liste de ses
    poses dirait a l'adversaire ce qu'il peut jouer, et la pose jouee n'est
    publique qu'avec son mouvement, dans `round:result` (regle d'or n°4).
  */
  it('n annonce ni les poses ni les effets possedes', () => {
    presence.wearing.set('p1', {
      ownedEffects: ['fx.shock'],
      owned: ['fx.shock', 'anim.hype.t2.floss'],
    });

    open();

    const sent = JSON.stringify(notifier.foundBy('p2'));
    expect(sent).not.toContain('floss');
    expect(sent).not.toContain('fx.shock');
  });

  /*
    L'apparence etait posee AVANT la creation du match, et le runtime ignore
    un match qu'il ne connait pas : aucun skin — danse ou effet — n'arrivait
    jamais a la revelation d'un vrai duel. Les tests du runtime posaient,
    eux, l'apparence apres la creation : ils ne pouvaient pas le voir.
  */
  it('pose l apparence de chaque siege sur un match deja cree', () => {
    presence.wearing.set('p1', { ownedEffects: ['fx.shock'], owned: ['fx.shock'] });

    open();

    expect(runtime.worn).toHaveLength(2);
    expect(runtime.worn.every((worn) => worn.existed)).toBe(true);
  });

  /** Un nom manquant ne vaut pas un duel annule. */
  it('ouvre quand meme avec un nom inconnu', () => {
    presence.anonymous.add('p2');

    expect(open()).not.toBeNull();
    expect(notifier.foundBy('p1')?.opponent.displayName).toBe(UNKNOWN_PLAYER_NAME);
  });

  it('annonce les versions du protocole, des regles et du contenu', () => {
    open();
    const found = notifier.foundBy('p1');

    expect(found?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(found?.rulesVersion).not.toBe('');
    expect(found?.ghost).toBe(false);
  });

  /**
   * Le retrait est declenche par l'**ouverture**, pas par l'appariement :
   * sinon une invitation acceptee pendant l'attente laisse son ticket derriere
   * elle, et le worker apparie un joueur deja en duel.
   */
  it('sort les deux joueurs de la file', () => {
    open();
    expect(queue.evicted.sort()).toEqual(['p1', 'p2']);
  });

  it('ouvre quand meme si la file ne repond pas', async () => {
    queue.failure = new Error('Redis injoignable');
    expect(open()).not.toBeNull();
    // Le rejet est avale par l'ouverture ; sans ce tour de boucle, il
    // remonterait en rejet non gere apres la fin du test.
    await Promise.resolve();
  });

  it('transmet au runtime l attente en file de chaque siege', () => {
    opener.open({ playerA: 'p1', playerB: 'p2', mode: 'RANKED', queueWaitMs: { a: 900, b: 300 } });
    expect(runtime.opened[0]?.queueWaitMs).toEqual({ a: 900, b: 300 });
  });

  it('n invente aucune attente pour une invitation', () => {
    open('INVITE');
    expect(runtime.opened[0]?.queueWaitMs).toBeUndefined();
  });

  it('conserve le mode d ouverture pour l enregistrement', () => {
    open('CASUAL');
    expect(runtime.opened[0]?.mode).toBe('CASUAL');
  });

  /**
   * Le cas qui fait le plus de degats : annoncer un match a quelqu'un qui joue
   * deja. Son client bascule sur une arene dont le serveur ne sait rien, et il
   * perd la partie en cours.
   */
  it('n annonce rien quand un joueur occupe deja un siege', () => {
    runtime.busy.add('p2');

    expect(open()).toBeNull();
    expect(notifier.sent).toHaveLength(0);
    expect(runtime.opened).toHaveLength(0);
  });

  /**
   * `createMatch` annonce la premiere manche sur-le-champ : un `round:intro`
   * qui precederait `match:found` porterait un `matchId` inconnu du client.
   */
  it('annonce le match avant de l ouvrir', () => {
    open();
    expect(runtime.opened[0]?.sentBefore).toBe(2);
  });

  /**
   * Un joueur peut fermer sa socket pendant la lecture des noms. Si son
   * `disconnect` est passe avant l'existence du match, plus rien n'armerait
   * l'abandon et son adversaire subirait trois manches d'actions par defaut.
   */
  it('arme l abandon d un joueur deja parti a l ouverture', () => {
    presence.absent.add('p2');

    open();

    expect(runtime.abandonArmed).toEqual(['p2']);
  });

  it('n arme rien quand les deux joueurs sont la', () => {
    open();
    expect(runtime.abandonArmed).toEqual([]);
  });

  /**
   * Un joueur assis des deux cotes controle les deux choix et gagne a coup
   * sur — et la partie part en base comme un match classe. `createMatch` le
   * refuse deja ; le refuser **ici** evite d'avoir annonce le match a
   * quelqu'un avant de se raviser, et vaut pour tous les appelants a la fois.
   */
  it('refuse d asseoir un joueur contre lui-meme', () => {
    expect(opener.open({ playerA: 'p1', playerB: 'p1', mode: 'RANKED' })).toBeNull();

    expect(notifier.sent).toHaveLength(0);
    expect(runtime.opened).toHaveLength(0);
    expect(queue.evicted).toEqual([]);
  });

  it('signale le refus d un joueur contre lui-meme', () => {
    const warnings: string[] = [];
    opener = new MatchOpener(runtime, notifier, presence, queue, {
      warn: (message: string) => warnings.push(message),
    });

    opener.open({ playerA: 'p1', playerB: 'p1', mode: 'INVITE' });

    expect(warnings).toHaveLength(1);
  });

  /**
   * Le journal ne recopie pas la cause brute : `String(cause)` rend
   * « nom: message », et le message d'une erreur ecrite par une bibliotheque
   * recopie volontiers les arguments qu'elle vient de refuser.
   */
  it('resume la panne de la file sans recopier son message', async () => {
    const warnings: string[] = [];
    opener = new MatchOpener(runtime, notifier, presence, queue, {
      warn: (message: string) => warnings.push(message),
    });
    queue.failure = new Error('ECONNREFUSED\n  mm:ticket:p1 = { mmr: 1337 }');

    open();
    await Promise.resolve();
    await Promise.resolve();

    expect(warnings.join(' ')).not.toContain('1337');
    expect(warnings.join(' ')).toContain('Error');
  });

  it('signale un refus d ouverture survenu apres l annonce', () => {
    const warnings: string[] = [];
    opener = new MatchOpener(runtime, notifier, presence, queue, {
      warn: (message: string) => warnings.push(message),
    });
    runtime.refuse = true;

    expect(open()).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

/**
 * Ouverture d'un match contre un fantome (docs/05 § « Fantomes »).
 *
 * « Sans faire croire a un faux humain en ligne. » Cette promesse se tient
 * ici, dans le premier message du match, et nulle part ailleurs : c'est
 * l'ouverture qui envoie `match:found`, donc elle seule peut dire la verite.
 */
describe('MatchOpener — face a un fantome', () => {
  const GHOST = {
    seat: 'b' as const,
    sourcePlayerId: 'p_source',
    mmr: 1_400,
    recordingId: 'rec_1',
    displayName: 'Aura anonyme',
    league: 'stable',
  };

  const openGhost = (): string | null =>
    opener.open({ playerA: 'p1', playerB: 'ghost:rec_1:n', mode: 'RANKED', ghost: GHOST });

  it('dit au joueur que son adversaire est un rejeu', () => {
    openGhost();
    expect(notifier.foundBy('p1')?.ghost).toBe(true);
  });

  /* Un rejeu n'a pas de session : il porte les defauts, sans rien inventer. */
  it('annonce un fantome sans apparence particuliere', () => {
    openGhost();
    expect(notifier.foundBy('p1')?.opponent.cosmetics).toEqual({});
  });

  it('n annonce rien au siege du fantome', () => {
    openGhost();
    expect(notifier.sent.filter((m) => m.playerId === 'ghost:rec_1:n')).toHaveLength(0);
  });

  it('montre le nom et la ligue fournis, pas ceux d une session inexistante', () => {
    openGhost();
    expect(notifier.foundBy('p1')?.opponent.displayName).toBe('Aura anonyme');
    expect(notifier.foundBy('p1')?.opponent.league).toBe('stable');
  });

  /**
   * Le defaut que ce test ferme : `isConnected` repond « non » pour un siege
   * sans session. Armer le compte a rebours d'abandon donnerait au joueur une
   * victoire par forfait au milieu de la deuxieme manche.
   */
  it('n arme aucun compte a rebours d abandon pour le fantome', () => {
    openGhost();
    expect(runtime.abandonArmed).not.toContain('ghost:rec_1:n');
  });

  it('arme toujours celui du joueur parti avant l ouverture', () => {
    presence.absent.add('p1');
    openGhost();
    expect(runtime.abandonArmed).toEqual(['p1']);
  });

  it('ne cherche pas a sortir un fantome de la file', () => {
    openGhost();
    expect(queue.evicted).toEqual(['p1']);
  });

  it('transmet le siege fantome au runtime', () => {
    openGhost();
    expect(runtime.opened[0]?.ghost).toEqual({
      seat: 'b',
      mmr: 1_400,
      sourcePlayerId: 'p_source',
      displayName: 'Aura anonyme',
      league: 'stable',
    });
  });

  it('laisse un match entre humains sans siege fantome', () => {
    open();
    expect(runtime.opened[0]?.ghost).toBeNull();
    expect(notifier.foundBy('p1')?.ghost).toBe(false);
    expect(notifier.foundBy('p2')?.ghost).toBe(false);
  });
});

/**
 * Evenements de la semaine (M10) : la partie rapide joue la variante de la
 * semaine, le classe et les invitations jouent les regles normales.
 *
 * L'ouverture est le bon endroit : c'est elle qui annonce `match:found`, et
 * l'annonce doit dire la regle que le runtime appliquera — la meme decision,
 * prise une fois, pour les deux.
 */
describe('MatchOpener — variante de la semaine', () => {
  /** Lundi 12 janvier 1970 : semaine 1, « Ultime express ». */
  const VARIANT_WEEK_MS = Date.UTC(1970, 0, 12, 12);
  /** Lundi 5 janvier 1970 : semaine 0, normale. */
  const NORMAL_WEEK_MS = Date.UTC(1970, 0, 5, 12);

  const openAt = (atMs: number, mode: 'RANKED' | 'CASUAL' | 'INVITE'): string | null => {
    opener = new MatchOpener(runtime, notifier, presence, queue, null, { now: () => atMs });
    return opener.open({ playerA: 'p1', playerB: 'p2', mode });
  };

  it('ouvre une partie rapide avec la variante, et l annonce aux deux joueurs', () => {
    openAt(VARIANT_WEEK_MS, 'CASUAL');

    expect(runtime.opened[0]?.rulesVariant).toBe('ultime');
    expect(notifier.foundBy('p1')?.rulesVariant).toBe('ultime');
    expect(notifier.foundBy('p2')?.rulesVariant).toBe('ultime');
  });

  it.each(['RANKED', 'INVITE'] as const)('joue %s en regles normales', (mode) => {
    openAt(VARIANT_WEEK_MS, mode);

    expect(runtime.opened[0]?.rulesVariant).toBe('normal');
    // Rien a annoncer : un client 2.3 ne connait pas le champ, et « normal »
    // est ce qu'il suppose sans lui.
    expect(notifier.foundBy('p1')).not.toHaveProperty('rulesVariant');
  });

  it('n annonce rien une semaine normale', () => {
    openAt(NORMAL_WEEK_MS, 'CASUAL');

    expect(runtime.opened[0]?.rulesVariant).toBe('normal');
    expect(notifier.foundBy('p1')).not.toHaveProperty('rulesVariant');
  });

  it('joue normal sans calendrier cable', () => {
    open('CASUAL');
    expect(runtime.opened[0]?.rulesVariant).toBe('normal');
  });

  /** Le fantome rejoue sous les regles de la partie : son adversaire les voit annoncees. */
  it('donne la variante a une partie rapide contre un fantome', () => {
    opener = new MatchOpener(runtime, notifier, presence, queue, null, {
      now: () => VARIANT_WEEK_MS,
    });
    opener.open({
      playerA: 'p1',
      playerB: 'ghost_x',
      mode: 'CASUAL',
      ghost: {
        seat: 'b',
        sourcePlayerId: 'p_source',
        mmr: 1_000,
        recordingId: 'r_1',
        displayName: 'Aura anonyme',
        league: 'sans_aura',
      },
    });

    expect(runtime.opened[0]?.rulesVariant).toBe('ultime');
    expect(notifier.foundBy('p1')?.rulesVariant).toBe('ultime');
  });
});
