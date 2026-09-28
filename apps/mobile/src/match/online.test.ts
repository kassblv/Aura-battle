import { BALANCE } from '@aura/rules';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { createGameClient, type Transport } from '../net/client.js';
import { createOnlineMatch } from './online.js';

const MATCH = 'm_11111111-1111-4111-8111-111111111111';

function harness() {
  const handlers = new Map<string, (message: unknown) => void>();
  const sent: { name: string; payload: unknown }[] = [];
  let now = 1000;

  const transport: Transport = {
    send: (name, payload) => {
      sent.push({ name, payload });
    },
    onMessage: (handler) => {
      handlers.set('*', handler);
    },
    onConnect: () => undefined,
    onDisconnect: () => undefined,
    // Ce test ne met jamais l application en veille : le double le dit plutot
    // que de faire semblant de savoir se reveiller.
    wake: () => undefined,
    close: () => undefined,
  };

  const emit = (name: string, payload: unknown): void => {
    handlers.get('*')?.({ name, payload });
  };

  const client = createGameClient(transport, { now: () => now });

  /** Horloge locale a 1000, serveur a 500 000 : un decalage franc de 499 000. */
  client.ping();
  const ping = sent.find((m) => m.name === 'ping');
  now = 1000;
  emit('pong', { t: (ping?.payload as { t: number }).t, serverTime: 500_000 });

  const match = createOnlineMatch(client);
  return {
    match,
    sent,
    emit,
    at: (value: number) => {
      now = value;
    },
  };
}

const orb = (index: number) => ({
  index,
  x: 0.5,
  y: 0.5,
  kind: 'normal' as const,
  points: 1,
  lifetimeMs: 1600,
});

describe('createOnlineMatch', () => {
  it('part vide : rien n est connu avant que le serveur parle', () => {
    const { match } = harness();
    expect(match.state.phase).toBe('idle');
    expect(match.state.matchId).toBeNull();
  });

  it('retient le match et le siege annonces', () => {
    const { match, emit } = harness();
    emit('match:found', {
      matchId: MATCH,
      seat: 'b',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    expect(match.state.matchId).toBe(MATCH);
    expect(match.state.seat).toBe('b');
    expect(match.state.opponentName).toBe('Nova');
  });

  /*
    L'apparence de l'adversaire : sa tenue, sa couleur, sa danse signature.
    Le client en ligne dessinait en face une tenue ecrite en dur.
  */
  it('retient l apparence annoncee de l adversaire', () => {
    const { match, emit } = harness();
    const cosmetics = {
      outfit: 'outfit.kimono',
      auraColor: 'color.violet',
      signature: 'anim.calme.t3.moonwalk',
    };
    emit('match:found', {
      matchId: MATCH,
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    expect(match.state.opponentCosmetics).toEqual(cosmetics);
  });

  it('garde l apparence adverse a travers une reprise qui la rappelle', () => {
    const { match, emit } = harness();
    emit('match:state', {
      matchId: MATCH,
      seat: 'b',
      phase: 'recharge',
      round: 2,
      endsAt: 512_000,
      roundsWon: { a: 1, b: 0 },
      energy: 6,
      ult: 0,
      opponentLocked: false,
      opponent: {
        displayName: 'Nova',
        league: 'Or II',
        cosmetics: { hair: 'hair.long', signature: 'anim.hype.t2.floss' },
      },
      history: [],
    });
    expect(match.state.opponentCosmetics).toEqual({
      hair: 'hair.long',
      signature: 'anim.hype.t2.floss',
    });
  });

  /**
   * Les echeances arrivent en heure serveur. Les afficher telles quelles
   * donnerait un compte a rebours faux de tout le decalage d horloge — des
   * heures, sur un telephone regle a la main.
   */
  it('traduit les echeances en heure locale', () => {
    const { match, emit } = harness();
    emit('round:intro', {
      matchId: MATCH,
      round: 1,
      endsAt: 502_000,
      roundsWon: { a: 0, b: 0 },
      energy: 14,
      ult: 0,
    });
    // 502 000 en heure serveur, decalage 499 000 : 3 000 en heure locale.
    expect(match.state.phaseEndsAtMs).toBeCloseTo(3000, 3);
  });

  it('suit les phases annoncees par le serveur', () => {
    const { match, emit } = harness();
    emit('round:intro', {
      matchId: MATCH,
      round: 1,
      endsAt: 502_000,
      roundsWon: { a: 0, b: 0 },
      energy: 14,
      ult: 0,
    });
    expect(match.state.phase).toBe('intro');

    emit('recharge:start', {
      matchId: MATCH,
      round: 1,
      startsAt: 502_000,
      endsAt: 508_000,
      orbs: [orb(0), orb(1), orb(2)],
    });
    expect(match.state.phase).toBe('recharge');
    expect(match.state.orbs).toHaveLength(3);

    emit('choice:start', {
      matchId: MATCH,
      round: 1,
      endsAt: 523_000,
      meter: { period: 1300, zone: 0.4, perfect: 0.09, center: 0.5 },
      energy: 14,
      ult: 0,
    });
    expect(match.state.phase).toBe('choice');
    expect(match.state.meter?.period).toBe(1300);
  });

  it('retient ma case brillante, et l oublie si le serveur n en envoie pas', () => {
    const { match, emit } = harness();
    const start = {
      matchId: MATCH,
      round: 1,
      endsAt: 523_000,
      meter: { period: 1300, zone: 0.4, perfect: 0.09, center: 0.5 },
      energy: 14,
      ult: 0,
    };
    emit('choice:start', { ...start, shiny: { style: 'prouesse', tier: 3 } });
    expect(match.state.shiny).toEqual({ style: 'prouesse', tier: 3 });
    emit('choice:start', { ...start, round: 2 });
    expect(match.state.shiny).toBeNull();
  });

  /**
   * Le seul fait public pendant le choix : l adversaire a verrouille. Ni son
   * mouvement, ni son timing, ni son cout — et l interface n a donc rien de
   * plus a montrer.
   */
  it('signale le verrouillage adverse, sans rien d autre', () => {
    const { match, emit } = harness();
    emit('opponent:locked', { matchId: MATCH, round: 1 });
    expect(match.state.opponentLocked).toBe(true);
    expect(Object.keys(match.state)).not.toContain('opponentChoice');
  });

  it('oublie le verrouillage adverse a la manche suivante', () => {
    const { match, emit } = harness();
    emit('opponent:locked', { matchId: MATCH, round: 1 });
    emit('round:intro', {
      matchId: MATCH,
      round: 2,
      endsAt: 502_000,
      roundsWon: { a: 1, b: 0 },
      energy: 8,
      ult: 0,
    });
    expect(match.state.opponentLocked).toBe(false);
  });

  it('reprend un match en cours apres reconnexion', () => {
    const { match, emit } = harness();
    emit('match:state', {
      matchId: MATCH,
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 512_000,
      roundsWon: { a: 1, b: 0 },
      energy: 6,
      ult: 0.5,
      opponentLocked: true,
      meter: { period: 1300, zone: 0.4, perfect: 0.09, center: 0.5 },
      history: [{ round: 1, winner: 'a', scores: { a: 60, b: 41 } }],
    });
    expect(match.state.phase).toBe('choice');
    expect(match.state.round).toBe(2);
    expect(match.state.energy).toBe(6);
    expect(match.state.opponentLocked).toBe(true);
    expect(match.state.phaseEndsAtMs).toBeCloseTo(13_000, 3);
  });

  it('range le resultat de manche et le vainqueur', () => {
    const { match, emit } = harness();
    emit('round:result', {
      matchId: MATCH,
      round: 1,
      sides: {
        a: side('calme', 2),
        b: side('hype', 1),
      },
      winner: 'a',
      roundsWon: { a: 1, b: 0 },
      timeline: { revealFirst: 'a' },
    });
    expect(match.state.phase).toBe('reveal');
    expect(match.state.lastRound?.winner).toBe('a');
    expect(match.state.roundsWon).toEqual({ a: 1, b: 0 });
  });

  it('fait partir la revelation a la reception du resultat, pas a l echeance du choix', () => {
    /*
      Quand les deux joueurs verrouillent tot, le serveur revele sans attendre
      la fin du choix. `round:result` ne porte pas d'echeance : garder celle
      du choix faisait croire a l'ecran que la revelation venait a peine de
      commencer, pendant toute sa duree — et le panneau de verdict, qui attend
      la fin du choc, ne s'affichait jamais.
    */
    const { match, emit, at } = harness();
    emit('choice:start', {
      matchId: MATCH,
      round: 1,
      endsAt: 520_000,
      meter: { period: 1300, zone: 0.4, perfect: 0.09, center: 0.5 },
    });
    at(4_000);
    emit('round:result', {
      matchId: MATCH,
      round: 1,
      sides: { a: side('calme', 2), b: side('hype', 1) },
      winner: 'a',
      roundsWon: { a: 1, b: 0 },
      timeline: { revealFirst: 'a' },
    });
    expect(match.state.phaseEndsAtMs).toBe(4_000 + BALANCE.phases.revealMs);
  });

  it('termine le match', () => {
    const { match, emit } = harness();
    emit('match:end', {
      matchId: MATCH,
      winner: 'b',
      reason: 'rounds',
      rating: { before: 1200, after: 1185, leagueBefore: 'Or II', leagueAfter: 'Or II' },
      rewards: { softCurrency: 12, xp: 40, xpTotal: 40 },
    });
    expect(match.state.phase).toBe('ended');
    expect(match.state.result?.winner).toBe('b');
  });

  /*
    La regression : apres un duel par code, « Accueil » puis « Code »
    rouvrait l ecran de defaite du match fini, et l ecran d invitation — le
    seul d ou l on cree un nouveau code — ne revenait qu en relancant le jeu.
  */
  it('congedie un match termine : on repart de rien', () => {
    const { match, emit } = harness();
    emit('match:found', {
      matchId: MATCH,
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    emit('match:end', {
      matchId: MATCH,
      winner: 'b',
      reason: 'rounds',
      rating: { before: 1200, after: 1185, leagueBefore: 'Or II', leagueAfter: 'Or II' },
      rewards: { softCurrency: 12, xp: 40, xpTotal: 40 },
    });
    match.dismiss();
    expect(match.state.phase).toBe('idle');
    expect(match.state.matchId).toBeNull();
    expect(match.state.opponentName).toBeNull();
  });

  it('ne congedie JAMAIS un match en cours', () => {
    // Quitter un ecran n est pas abandonner : l abandon est `forfeit`, un
    // geste explicite. Effacer un match vivant laisserait le serveur le jouer
    // sans nous, et l ecran ne saurait plus qu il existe.
    const { match, emit } = harness();
    emit('recharge:start', {
      matchId: MATCH,
      round: 1,
      startsAt: 502_000,
      endsAt: 508_000,
      orbs: [orb(0)],
    });
    match.dismiss();
    expect(match.state.phase).toBe('recharge');
    expect(match.state.matchId).toBe(MATCH);
  });
});

describe('envois du joueur', () => {
  it('date les taps en heure de phase, pas en heure d horloge', () => {
    const { match, emit, sent, at } = harness();
    emit('recharge:start', {
      matchId: MATCH,
      round: 1,
      startsAt: 502_000,
      endsAt: 508_000,
      orbs: [orb(0)],
    });
    at(3500);
    match.tap([{ atMs: 500, orbIndex: 0 }]);
    const taps = sent.find((m) => m.name === 'recharge:taps');
    expect(taps).toBeDefined();
    expect((taps?.payload as { matchId: string }).matchId).toBe(MATCH);
  });

  it('numerote ses envois pour survivre a un renvoi', () => {
    const { match, emit, sent } = harness();
    emit('match:found', {
      matchId: MATCH,
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    match.tap([{ atMs: 100, orbIndex: 0 }]);
    match.tap([{ atMs: 200, orbIndex: 1 }]);
    const seqs = sent
      .filter((m) => m.name === 'recharge:taps')
      .map((m) => (m.payload as { seq: number }).seq);
    expect(seqs).toHaveLength(2);
    expect(seqs[1]).toBe(seqs[0]! + 1);
  });

  it('reprend au-dessus de la session precedente apres une reconnexion', () => {
    /*
      Le serveur jette tout `seq` inferieur ou egal au dernier recu, et il le
      retient pour tout le match. Le client, lui, est recree a chaque nouveau
      jeton d'acces — un rechargement, une reprise depuis l'arriere-plan, un
      jeton renouvele en pleine partie. Reparti de 0, il voyait alors TOUS ses
      taps et son verrouillage refuses en silence jusqu'a la fin du match.

      Partir de l'heure murale garantit qu'une session plus recente numerote
      au-dessus de la precedente, sans rien stocker.
    */
    const startedAt = Date.now();
    const { match, emit, sent } = harness();
    emit('match:found', {
      matchId: MATCH,
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    match.tap([{ atMs: 100, orbIndex: 0 }]);
    const seq = (sent.find((m) => m.name === 'recharge:taps')?.payload as { seq: number }).seq;
    expect(seq).toBeGreaterThanOrEqual(startedAt);
  });

  it('trie les taps par instant : le schema refuse le desordre', () => {
    const { match, emit, sent } = harness();
    emit('match:found', {
      matchId: MATCH,
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    match.tap([
      { atMs: 400, orbIndex: 1 },
      { atMs: 100, orbIndex: 0 },
    ]);
    const payload = sent.find((m) => m.name === 'recharge:taps')?.payload as {
      taps: { t: number }[];
    };
    expect(payload.taps.map((tap) => tap.t)).toEqual([100, 400]);
  });

  it('ne verrouille rien tant qu aucun match n est ouvert', () => {
    const { match, sent } = harness();
    const before = sent.length;
    match.lock(
      { move: { style: 'calme', tier: 1 }, amplifier: 0, useUltimate: false },
      'anim.calme.t1.pocket',
      0,
      500,
    );
    expect(sent).toHaveLength(before);
  });

  /*
    2.0.0 : le client dit la POSE, jamais le mouvement. Le serveur en deduit
    famille et palier, et verifie qu'elle est offerte ou possedee.
  */
  it('verrouille en envoyant la pose, pas le mouvement', () => {
    const { match, emit, sent } = harness();
    emit('match:found', {
      matchId: MATCH,
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: '1.0.0',
      contentVersion: '1.0.0',
      ghost: false,
    });
    match.lock(
      { move: { style: 'acrobatie', tier: 2 }, amplifier: 1, useUltimate: false },
      'anim.acrobatie.t2.wheel',
      100,
      700,
    );
    const lock = sent.find((m) => m.name === 'choice:lock')?.payload as Record<string, unknown>;
    expect(lock.poseId).toBe('anim.acrobatie.t2.wheel');
    expect(lock.amp).toBe(1);
    expect(lock).not.toHaveProperty('move');
  });
});

function side(style: 'calme' | 'hype' | 'provoc', tier: 0 | 1 | 2 | 3 | 4) {
  return {
    move: { style, tier },
    amp: 0,
    ult: false,
    cosmetic: { animationId: `anim.${style}.t${tier}.x`, effectId: 'fx.glow' },
    recharge: { points: 10, bestCombo: 4, boostPct: 0.1, ultGain: 0.2, energyGain: 1 },
    timing: { quality: 'good' as const, error: 0.04 },
    repeat: false,
    counter: false,
    countered: false,
    counterBlocked: false,
    base: 30,
    final: 34,
    energyAfter: 12,
    ultAfter: 0.2,
  };
}

describe('carte brillante — reprise et nouvelle manche', () => {
  const found = {
    matchId: MATCH,
    seat: 'a',
    opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
    protocolVersion: PROTOCOL_VERSION,
    rulesVersion: '1.0.0',
    contentVersion: '1.0.0',
    ghost: false,
  };

  it('retrouve sa case brillante apres une reprise en pleine phase de choix', () => {
    const { match, emit } = harness();
    emit('match:found', found);
    emit('match:state', {
      matchId: MATCH,
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 530_000,
      roundsWon: { a: 1, b: 0 },
      energy: 11,
      ult: 20,
      opponentLocked: false,
      ghost: false,
      history: [],
      shiny: { style: 'acrobatie', tier: 2 },
    });
    expect(match.state.shiny).toEqual({ style: 'acrobatie', tier: 2 });
  });

  it('oublie la case de la manche precedente des l intro suivante', () => {
    const { match, emit } = harness();
    emit('match:found', found);
    emit('choice:start', {
      matchId: MATCH,
      round: 1,
      endsAt: 523_000,
      meter: { period: 1300, zone: 0.4, perfect: 0.09, center: 0.5 },
      energy: 14,
      ult: 0,
      shiny: { style: 'hype', tier: 1 },
    });
    emit('round:intro', {
      matchId: MATCH,
      round: 2,
      endsAt: 540_000,
      roundsWon: { a: 1, b: 0 },
      energy: 12,
      ult: 10,
    });
    expect(match.state.shiny).toBeNull();
  });
});

describe('createOnlineMatch : l evenement de la semaine', () => {
  const found = (rulesVariant?: string): Record<string, unknown> => ({
    matchId: MATCH,
    seat: 'a',
    opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
    protocolVersion: PROTOCOL_VERSION,
    rulesVersion: '1.0.0',
    contentVersion: '1.0.0',
    ghost: false,
    ...(rulesVariant === undefined ? {} : { rulesVariant }),
  });

  it('retient la variante annoncee par match:found', () => {
    const { match, emit } = harness();
    emit('match:found', found('ultime'));
    expect(match.state.rulesVariant).toBe('ultime');
  });

  it('joue les regles normales quand le serveur n annonce rien', () => {
    const { match, emit } = harness();
    emit('match:found', found());
    expect(match.state.rulesVariant).toBeNull();
  });

  it('garde la variante a travers une reprise du meme match, pas d un autre', () => {
    const { match, emit } = harness();
    emit('match:found', found('contres'));
    const snapshot = {
      seat: 'a',
      phase: 'recharge',
      round: 2,
      endsAt: 512_000,
      roundsWon: { a: 1, b: 0 },
      energy: 6,
      ult: 0,
      opponentLocked: false,
      history: [],
    };
    emit('match:state', { matchId: MATCH, ...snapshot });
    expect(match.state.rulesVariant).toBe('contres');
    emit('match:state', { matchId: 'm_22222222-2222-4222-8222-222222222222', ...snapshot });
    expect(match.state.rulesVariant).toBeNull();
  });

  /*
    Application tuee puis rouverte : aucun `match:found` n'a ete recu, seul
    l'instantane est la. Il porte la variante (2.4.1) : l'ecran la reprend.
  */
  it('reprend la variante de l instantane apres une application tuee', () => {
    const { match, emit } = harness();
    emit('match:state', {
      matchId: MATCH,
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 512_000,
      roundsWon: { a: 1, b: 0 },
      energy: 6,
      ult: 0,
      opponentLocked: false,
      history: [],
      rulesVariant: 'ultime',
    });
    expect(match.state.rulesVariant).toBe('ultime');
  });
});

/*
  Bulle d'intention (2.6.0, test A/B). Le serveur dit si le match l'a ; les
  annonces arrivent par `intent:shown`, aux deux sieges, et une reprise les
  rappelle dans `match:state.intents`. Le client ne decide rien : il range, et
  n'envoie une annonce que quand elle a une chance d'etre retenue.
*/
describe('bulle d intention', () => {
  const found = (seat: 'a' | 'b', intentBubble?: true): Record<string, unknown> => ({
    matchId: MATCH,
    seat,
    opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
    protocolVersion: PROTOCOL_VERSION,
    rulesVersion: '1.0.0',
    contentVersion: '1.0.0',
    ghost: false,
    ...(intentBubble === undefined ? {} : { intentBubble }),
  });
  const choiceStart = (round = 1): Record<string, unknown> => ({
    matchId: MATCH,
    round,
    endsAt: 520_000,
    meter: { period: 1300, zone: 0.4, perfect: 0.09, center: 0.5 },
    energy: 8,
    ult: 0,
  });
  const intro = (round: number): Record<string, unknown> => ({
    matchId: MATCH,
    round,
    endsAt: 502_000,
    roundsWon: { a: 0, b: 0 },
    energy: 8,
    ult: 0,
  });
  const snapshot = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    matchId: MATCH,
    seat: 'b',
    phase: 'choice',
    round: 2,
    endsAt: 512_000,
    roundsWon: { a: 1, b: 0 },
    energy: 6,
    ult: 0,
    opponentLocked: false,
    history: [],
    ...over,
  });
  const intentsSent = (sent: readonly { name: string; payload: unknown }[]) =>
    sent.filter((m) => m.name === 'intent:show').map((m) => m.payload as Record<string, unknown>);

  it('ne connait pas de bulle tant que le serveur ne l annonce pas', () => {
    const { match, emit } = harness();
    emit('match:found', found('a'));
    expect(match.state.intentBubble).toBe(false);
    expect(match.state.intents).toEqual({ mine: null, theirs: null });
  });

  it('retient la bulle annoncee par match:found', () => {
    const { match, emit } = harness();
    emit('match:found', found('a', true));
    expect(match.state.intentBubble).toBe(true);
  });

  it('range chaque annonce du bon cote selon mon siege', () => {
    const { match, emit } = harness();
    emit('match:found', found('b', true));
    emit('choice:start', choiceStart());
    emit('intent:shown', { matchId: MATCH, round: 1, seat: 'a', style: 'provoc' });
    expect(match.state.intents).toEqual({ mine: null, theirs: 'provoc' });
    emit('intent:shown', { matchId: MATCH, round: 1, seat: 'b', style: 'calme' });
    expect(match.state.intents).toEqual({ mine: 'calme', theirs: 'provoc' });
  });

  it('ignore une annonce d une autre manche', () => {
    const { match, emit } = harness();
    emit('match:found', found('a', true));
    emit('round:intro', intro(2));
    emit('intent:shown', { matchId: MATCH, round: 1, seat: 'b', style: 'hype' });
    expect(match.state.intents.theirs).toBeNull();
  });

  it('oublie les annonces a chaque nouvelle manche, pas la bulle', () => {
    const { match, emit } = harness();
    emit('match:found', found('a', true));
    emit('choice:start', choiceStart());
    emit('intent:shown', { matchId: MATCH, round: 1, seat: 'b', style: 'hype' });
    emit('intent:shown', { matchId: MATCH, round: 1, seat: 'a', style: 'calme' });
    emit('round:intro', intro(2));
    expect(match.state.intents).toEqual({ mine: null, theirs: null });
    expect(match.state.intentBubble).toBe(true);
  });

  it('reprend bulle et annonces de l instantane, selon mon siege', () => {
    const { match, emit } = harness();
    emit('match:state', snapshot({ intentBubble: true, intents: { a: 'hype', b: 'acrobatie' } }));
    expect(match.state.intentBubble).toBe(true);
    // Je suis `b` : l'annonce de `a` est celle de l'adversaire.
    expect(match.state.intents).toEqual({ mine: 'acrobatie', theirs: 'hype' });
  });

  it('garde la bulle a la reprise du meme match, pas d un autre', () => {
    const { match, emit } = harness();
    emit('match:found', found('b', true));
    emit('match:state', snapshot());
    expect(match.state.intentBubble).toBe(true);
    expect(match.state.intents).toEqual({ mine: null, theirs: null });
    emit('match:state', snapshot({ matchId: 'm_22222222-2222-4222-8222-222222222222' }));
    expect(match.state.intentBubble).toBe(false);
  });

  it('annonce avec le numero d ordre des autres actions', () => {
    const { match, emit, sent } = harness();
    emit('match:found', found('a', true));
    emit('choice:start', choiceStart());
    match.tap([{ atMs: 100, orbIndex: 0 }]);
    match.showIntent('prouesse');
    const [intent] = intentsSent(sent);
    const tapSeq = (sent.find((m) => m.name === 'recharge:taps')?.payload as { seq: number }).seq;
    expect(intent).toEqual({ matchId: MATCH, round: 1, seq: tapSeq + 1, style: 'prouesse' });
    expect(match.state.intentSent).toBe(true);
  });

  it('n annonce rien sans bulle', () => {
    const { match, emit, sent } = harness();
    emit('match:found', found('a'));
    emit('choice:start', choiceStart());
    match.showIntent('calme');
    expect(intentsSent(sent)).toHaveLength(0);
  });

  it('n annonce qu une fois par manche, meme avant la confirmation', () => {
    const { match, emit, sent } = harness();
    emit('match:found', found('a', true));
    emit('choice:start', choiceStart());
    match.showIntent('calme');
    match.showIntent('hype');
    expect(intentsSent(sent)).toHaveLength(1);
    emit('intent:shown', { matchId: MATCH, round: 1, seat: 'a', style: 'calme' });
    match.showIntent('hype');
    expect(intentsSent(sent)).toHaveLength(1);
  });

  it('n annonce plus rien apres une annonce deja confirmee (reprise)', () => {
    const { match, emit, sent } = harness();
    emit('match:state', snapshot({ intentBubble: true, intents: { b: 'calme' } }));
    match.showIntent('hype');
    expect(intentsSent(sent)).toHaveLength(0);
  });

  it('n annonce plus rien apres mon verrouillage', () => {
    const { match, emit, sent } = harness();
    emit('match:found', found('a', true));
    emit('choice:start', choiceStart());
    match.lock(
      { move: { style: 'calme', tier: 1 }, amplifier: 0, useUltimate: false },
      'anim.calme.t1.pocket',
      0,
      500,
    );
    expect(match.state.lockedSelf).toBe(true);
    match.showIntent('hype');
    expect(intentsSent(sent)).toHaveLength(0);
  });

  it('n annonce que pendant la phase de choix', () => {
    const { match, emit, sent } = harness();
    emit('match:found', found('a', true));
    emit('round:intro', intro(1));
    match.showIntent('hype');
    expect(intentsSent(sent)).toHaveLength(0);
  });

  it('peut annoncer de nouveau a la manche suivante', () => {
    const { match, emit, sent } = harness();
    emit('match:found', found('a', true));
    emit('choice:start', choiceStart(1));
    match.showIntent('calme');
    match.lock(
      { move: { style: 'calme', tier: 1 }, amplifier: 0, useUltimate: false },
      'anim.calme.t1.pocket',
      0,
      500,
    );
    emit('round:intro', intro(2));
    expect(match.state.intentSent).toBe(false);
    expect(match.state.lockedSelf).toBe(false);
    emit('choice:start', choiceStart(2));
    match.showIntent('hype');
    expect(intentsSent(sent).map((p) => p.round)).toEqual([1, 2]);
  });
});
