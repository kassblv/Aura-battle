import type { Seat } from '@aura/rules';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  PresenceLeagueCache,
  RatingLookup,
  RatingWriter,
  SeasonRatings,
  WalletCredit,
} from '../domain/ports.js';
import { STARTING_RATING, type RatingSnapshot } from '../domain/rating.js';
import { RatingSettlementService } from './rating-settlement.service.js';

/**
 * Orchestration du classement de fin de match (docs/05, ADR 0010).
 *
 * Le calcul lui-meme est deja couvert, en propriete, par `rating.test.ts` :
 * ce fichier verifie seulement que le service lit, decide, ecrit et degrade
 * exactement quand il le doit — jamais qu'un chiffre precis sort d'une
 * formule.
 */

const SEATS = { a: 'p1', b: 'p2' } as const;
const NOW = Date.parse('2026-09-20T10:00:00Z');

class FakeLookup implements RatingLookup {
  season: SeasonRatings | null = { seasonId: 's_1', ratings: new Map() };
  failure: Error | null = null;
  calls: readonly string[][] = [];

  loadForMatch(playerIds: readonly string[], _nowMs: number): Promise<SeasonRatings | null> {
    this.calls = [...this.calls, [...playerIds]];
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve(this.season);
  }

  set(playerId: string, rating: RatingSnapshot): void {
    const ratings = new Map(this.season?.ratings ?? []);
    ratings.set(playerId, rating);
    this.season = { seasonId: this.season?.seasonId ?? 's_1', ratings };
  }
}

class FakeWriter implements RatingWriter {
  saved: { seasonId: string; entries: readonly { playerId: string; rating: RatingSnapshot }[] }[] =
    [];
  failure: Error | null = null;

  saveMany(
    seasonId: string,
    entries: readonly { readonly playerId: string; readonly rating: RatingSnapshot }[],
  ): Promise<void> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.saved.push({ seasonId, entries: [...entries] });
    return Promise.resolve();
  }
}

class FakePresenceCache implements PresenceLeagueCache {
  readonly leagues = new Map<string, string>();

  setLeague(playerId: string, league: string): void {
    this.leagues.set(playerId, league);
  }
}

/** Le portefeuille : on note qui est credite de combien, monnaie ET experience. */
class FakeWallets implements WalletCredit {
  readonly credits: { playerId: string; soft: number; xp: number }[] = [];
  /** La saison recue avec chaque credit, pour l'XP du passe. */
  readonly seasons: (string | null)[] = [];
  failure: Error | null = null;

  /** Total d experience simule apres credit : on empile les gains. */
  readonly totals = new Map<string, number>();

  credit(
    entries: readonly { playerId: string; soft: number; xp: number }[],
    seasonId: string | null,
  ): Promise<ReadonlyMap<string, number>> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.credits.push(...entries);
    this.seasons.push(seasonId);
    for (const entry of entries) {
      this.totals.set(entry.playerId, (this.totals.get(entry.playerId) ?? 0) + entry.xp);
    }
    return Promise.resolve(new Map(this.totals));
  }
}

let lookup: FakeLookup;
let writer: FakeWriter;
let presence: FakePresenceCache;
let wallets: FakeWallets;
let service: RatingSettlementService;

beforeEach(() => {
  lookup = new FakeLookup();
  writer = new FakeWriter();
  presence = new FakePresenceCache();
  wallets = new FakeWallets();
  service = new RatingSettlementService(lookup, writer, presence, null, wallets);
});

const settle = (
  overrides: Partial<{
    mode: 'RANKED' | 'CASUAL' | 'INVITE' | 'SOLO';
    result: { winner: Seat | null; reason: string };
    ghost: { seat: Seat; mmr: number; sourcePlayerId: string } | null;
  }> = {},
) =>
  service.settle({
    mode: overrides.mode ?? 'RANKED',
    seats: SEATS,
    result: overrides.result ?? { winner: 'a', reason: 'rounds' },
    atMs: NOW,
    ghost: overrides.ghost ?? null,
  });

describe('RatingSettlementService — match classe', () => {
  it('fait gagner des LP au vainqueur et en perdre au perdant', async () => {
    // Le perdant part avec des LP a perdre : au plancher (0, la valeur de
    // depart), une defaite ne peut que rester clouee a zero (docs/05, « MMR
    // jamais negatif » vaut aussi pour les LP) — ce n'est pas ce test-ci.
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 200 });

    const outcome = await settle();

    expect(outcome.a.after.leaguePoints).toBeGreaterThan(outcome.a.before.leaguePoints);
    expect(outcome.b.after.leaguePoints).toBeLessThan(outcome.b.before.leaguePoints);
  });

  it('ecrit les deux joueurs dans la meme saison', async () => {
    await settle();

    expect(writer.saved).toHaveLength(1);
    expect(writer.saved[0]?.seasonId).toBe('s_1');
    expect(writer.saved[0]?.entries.map((e) => e.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('rafraichit la ligue en cache pour les deux joueurs', async () => {
    await settle();

    expect(presence.leagues.has('p1')).toBe(true);
    expect(presence.leagues.has('p2')).toBe(true);
  });

  it('donne des recompenses au vainqueur et au perdant, l un plus que l autre', async () => {
    const outcome = await settle();

    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
    expect(outcome.b.rewards.softCurrency).toBeGreaterThan(0);
    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(outcome.b.rewards.softCurrency);
  });

  it('part du classement existant, pas de la valeur de depart', async () => {
    lookup.set('p1', { ...STARTING_RATING, mmr: 1_600, leaguePoints: 500 });
    lookup.set('p2', { ...STARTING_RATING, mmr: 1_000, leaguePoints: 0 });

    const outcome = await settle();

    expect(outcome.a.before.leaguePoints).toBe(500);
  });
});

describe('RatingSettlementService — hors ranked', () => {
  it('affiche le classement actuel sans le modifier pour une partie amicale', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 250 });
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 80 });

    const outcome = await settle({ mode: 'CASUAL' });

    expect(outcome.a.before.leaguePoints).toBe(250);
    expect(outcome.a.after.leaguePoints).toBe(250);
    expect(writer.saved).toHaveLength(0);
    expect(presence.leagues.size).toBe(0);
  });

  it('recompense quand meme les deux joueurs', async () => {
    const outcome = await settle({ mode: 'CASUAL' });

    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
  });
});

describe('RatingSettlementService — abandon (anti-ferme, docs/05)', () => {
  it('ne rapporte rien a celui qui abandonne', async () => {
    const outcome = await settle({ result: { winner: 'b', reason: 'forfeit' } });

    expect(outcome.a.rewards).toEqual({ softCurrency: 0, xp: 0, xpTotal: 0 });
    expect(outcome.b.rewards.softCurrency).toBeGreaterThan(0);
  });

  it('compte quand meme le forfait comme une defaite classee pour l abandonneur', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 200 });

    const outcome = await settle({ result: { winner: 'b', reason: 'forfeit' } });

    expect(outcome.a.after.leaguePoints).toBeLessThan(outcome.a.before.leaguePoints);
  });

  it('un double abandon ne change le classement de personne, et ne rapporte rien', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 300 });
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 150 });

    const outcome = await settle({ result: { winner: null, reason: 'forfeit' } });

    expect(outcome.a.after.leaguePoints).toBe(outcome.a.before.leaguePoints);
    expect(outcome.b.after.leaguePoints).toBe(outcome.b.before.leaguePoints);
    expect(outcome.a.rewards).toEqual({ softCurrency: 0, xp: 0, xpTotal: 0 });
    expect(outcome.b.rewards).toEqual({ softCurrency: 0, xp: 0, xpTotal: 0 });
    expect(writer.saved).toHaveLength(0);
  });
});

describe('RatingSettlementService — degradation (docs/05 : une base lente ne doit pas priver du resultat)', () => {
  it('rend un classement neutre hors saison, mais garde les recompenses', async () => {
    lookup.season = null;

    const outcome = await settle();

    expect(outcome.a.before.leaguePoints).toBe(0);
    expect(outcome.a.after.leaguePoints).toBe(0);
    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
  });

  it('rend un classement neutre quand la lecture echoue', async () => {
    lookup.failure = new Error('ECONNREFUSED');

    const outcome = await settle();

    expect(outcome.a.after.leaguePoints).toBe(0);
    expect(writer.saved).toHaveLength(0);
  });

  it('n affiche pas le nouveau classement quand l ecriture echoue', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 200 });
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 200 });
    writer.failure = new Error('ECONNRESET');

    const outcome = await settle();

    expect(outcome.a.after.leaguePoints).toBe(outcome.a.before.leaguePoints);
    expect(presence.leagues.size).toBe(0);
  });

  it('fonctionne sans cache de presence branche', async () => {
    const bareService = new RatingSettlementService(lookup, writer);

    await expect(
      bareService.settle({
        mode: 'RANKED',
        seats: SEATS,
        result: { winner: 'a', reason: 'rounds' },
        atMs: NOW,
      }),
    ).resolves.toBeDefined();
  });
});

/**
 * Match contre un fantome (docs/05 § « Fantomes »).
 *
 * Deux promesses, et les deux sont tenues ici plutot que dans le module match :
 * le fantome n'ecrit rien — il n'etait pas la — et son adversaire ne gagne que
 * la moitie des LP habituels.
 */
describe('RatingSettlementService — contre un fantome', () => {
  const GHOST = { seat: 'b' as Seat, mmr: 1_000, sourcePlayerId: 'p_source' };

  it('n ecrit le classement que du joueur present', async () => {
    await settle({ ghost: GHOST });

    expect(writer.saved).toHaveLength(1);
    expect(writer.saved[0]?.entries.map((entry) => entry.playerId)).toEqual(['p1']);
  });

  it('ne demande meme pas le classement du siege fantome', async () => {
    await settle({ ghost: GHOST });
    expect(lookup.calls[0]).toEqual(['p1']);
  });

  it('laisse le classement du fantome inchange, avant comme apres', async () => {
    const outcome = await settle({ ghost: GHOST });
    expect(outcome.b.after).toEqual(outcome.b.before);
  });

  it('ne rafraichit pas la ligue en session d un joueur qui n est pas la', async () => {
    await settle({ ghost: GHOST });
    expect([...presence.leagues.keys()]).toEqual(['p1']);
  });

  /** « Un match contre un fantome rapporte 50 % des LP habituels. » */
  it('rapporte la moitie des LP d un match entre humains', async () => {
    const humain = await settle();
    const fantome = await settle({ ghost: GHOST });

    const gainHumain = humain.a.after.leaguePoints - humain.a.before.leaguePoints;
    const gainFantome = fantome.a.after.leaguePoints - fantome.a.before.leaguePoints;

    expect(gainHumain).toBeGreaterThan(0);
    expect(gainFantome).toBeGreaterThan(0);
    expect(gainFantome).toBe(Math.round(gainHumain / 2));
  });

  it('fait quand meme perdre des LP a qui perd contre un fantome', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 300 });
    const outcome = await settle({ ghost: GHOST, result: { winner: 'b', reason: 'rounds' } });
    expect(outcome.a.after.leaguePoints).toBeLessThan(outcome.a.before.leaguePoints);
  });

  it('ne recompense pas un siege que personne n occupe', async () => {
    const outcome = await settle({ ghost: GHOST });
    expect(outcome.b.rewards).toEqual({ softCurrency: 0, xp: 0, xpTotal: 0 });
    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
  });

  it('n ecrit rien du tout quand le match n est pas classe', async () => {
    await settle({ ghost: GHOST, mode: 'CASUAL' });
    expect(writer.saved).toHaveLength(0);
  });

  it('montre la ligue impliquee par le MMR de l enregistrement', async () => {
    // 1 000 de MMR implique 0 LP (meme echelle, decalee), donc « Sans aura ».
    const bas = await settle({ ghost: { ...GHOST, mmr: 1_000 } });
    expect(bas.b.before.league).toBe('sans_aura');

    const haut = await settle({ ghost: { ...GHOST, mmr: 2_500 } });
    expect(haut.b.before.league).toBe('rayonnante');
  });
});

describe('credit de la monnaie douce', () => {
  /*
    Le serveur ANNONCE une recompense depuis M5 ; il ne l'a jamais ECRITE.

    C'est le client qui s'ajoutait l'argent dans son propre stockage — donc une
    monnaie qu'on s'offrait soi-meme, et qui disparaissait en changeant
    d'appareil. Avec un inventaire cote serveur, la bourse doit vivre au meme
    endroit que ce qu'elle achete.
  */
  it('credite ce qu il annonce', async () => {
    const outcome = await settle({ mode: 'RANKED', result: { winner: 'a', reason: 'rounds' } });

    expect(wallets.credits).toEqual([
      { playerId: 'p1', soft: outcome.a.rewards.softCurrency, xp: outcome.a.rewards.xp },
      { playerId: 'p2', soft: outcome.b.rewards.softCurrency, xp: outcome.b.rewards.xp },
    ]);
  });

  /*
    L'experience etait CALCULEE, ENVOYEE dans `match:end`, et ecrite nulle
    part : pas de colonne en base, pas une mention dans le client. Le jeu
    inventait un nombre a chaque match et l'oubliait aussitot.

    C'est pourtant le seul compteur qui monte meme quand on perd — une defaite
    vaut douze, une victoire trente — donc le contrepoids des LP, qui
    descendent.
  */
  it('credite l experience, pas seulement la monnaie', async () => {
    const outcome = await settle({ mode: 'RANKED', result: { winner: 'a', reason: 'rounds' } });

    expect(outcome.a.rewards.xp).toBeGreaterThan(0);
    // Le perdant aussi : c'est tout l'interet de ce compteur-la.
    expect(outcome.b.rewards.xp).toBeGreaterThan(0);
    for (const credit of wallets.credits) {
      expect(credit.xp, credit.playerId).toBeGreaterThan(0);
    }
  });

  /*
    L'XP de saison (passe de saison) se credite avec l'experience, sur la
    saison que le match vient de lire : jamais une autre lue plus tard.
  */
  it('transmet la saison du match au credit, pour l XP du passe', async () => {
    await settle({ mode: 'CASUAL', result: { winner: 'a', reason: 'rounds' } });
    expect(wallets.seasons).toEqual(['s_1']);
  });

  it('credite sans saison hors saison', async () => {
    lookup.season = null;
    await settle({ mode: 'RANKED', result: { winner: 'a', reason: 'rounds' } });
    expect(wallets.seasons).toEqual([null]);
    expect(wallets.credits.length).toBe(2);
  });

  it('credite aussi hors classe', async () => {
    await settle({ mode: 'CASUAL', result: { winner: 'a', reason: 'rounds' } });
    expect(wallets.credits.length).toBeGreaterThan(0);
  });

  /* Un fantome n'a pas de bourse : rien ne doit partir a son nom. */
  it('ne credite jamais le siege du fantome', async () => {
    await settle({
      mode: 'RANKED',
      result: { winner: 'a', reason: 'rounds' },
      ghost: { seat: 'b', mmr: 1_000, sourcePlayerId: 'p_source' },
    });

    expect(wallets.credits.map((c) => c.playerId)).toEqual(['p1']);
  });

  /*
    Un abandon ne rapporte rien — c'est la table de `rewardsFor` qui le dit, et
    on ne credite pas zero : une ligne de credit a zero est une ecriture qui ne
    change rien, et une ecriture qui ne change rien finit par etre lue comme
    une ecriture qui a echoue.

    Attention au raccourci : un double abandon ne vaut PAS zero pour tout le
    monde. `outcomeFor` ne rend `forfeited` que pour `reason: 'forfeit'` ;
    ailleurs, l'absence de vainqueur est une egalite, qui rapporte douze.
  */
  it('n envoie rien pour un abandon des deux cotes', async () => {
    await settle({ mode: 'RANKED', result: { winner: null, reason: 'forfeit' } });
    expect(wallets.credits).toEqual([]);
  });

  it('credite le vainqueur d un abandon, mais pas celui qui abandonne', async () => {
    await settle({ mode: 'RANKED', result: { winner: 'a', reason: 'forfeit' } });
    expect(wallets.credits.map((c) => c.playerId)).toEqual(['p1']);
  });

  /*
    Un credit rate ne fait pas echouer le match.

    Le match est fini, les joueurs l'ont vu. Lever ici transformerait une
    ecriture ratee en partie perdue pour les deux — alors que la seule chose
    qui manque est quelques pieces, reconstructibles depuis le journal.
  */
  it('laisse le match s achever meme si le credit echoue', async () => {
    wallets.failure = new Error('base injoignable');
    await expect(
      settle({ mode: 'RANKED', result: { winner: 'a', reason: 'rounds' } }),
    ).resolves.toBeDefined();
  });

  it('se passe de portefeuille', async () => {
    const sansBourse = new RatingSettlementService(lookup, writer, presence);
    await expect(
      sansBourse.settle({
        mode: 'RANKED',
        seats: SEATS,
        result: { winner: 'a', reason: 'rounds' },
        atMs: NOW,
        ghost: null,
      }),
    ).resolves.toBeDefined();
  });
});
