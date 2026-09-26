import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type MatchMode } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaIndicatorsReader } from './prisma-indicators.reader.js';
import { PrismaProductEventStore } from './prisma-product-event.store.js';

/**
 * Les sept definitions des indicateurs produit, contre Postgres, sur des jeux
 * de donnees construits a la main (spec 2026-09-26-indicateurs-produit).
 *
 * **Isolement par le temps, pas par un filtre de test.** La base de test porte
 * deja d'autres lignes, ecrites par d'autres suites a l'heure reelle. Chaque
 * scenario se place a un « aujourd'hui » a lui, tire entre 1980 et 2000 et
 * distant de 400 jours de celui du scenario voisin : toutes les fenetres des
 * definitions sont bornees des deux cotes, donc aucune ligne d'une autre suite
 * — ni d'un autre scenario — n'y tombe. Le code de production n'a ainsi aucun
 * parametre reserve aux tests ; il recoit « maintenant », comme en vrai.
 *
 * Chaque scenario supprime ce qu'il a cree, dans un `finally`.
 *
 * Se saute si la base n'est pas joignable ou n'est pas locale (meme garde que
 * les autres tests d'integration).
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';

/** Jamais une base distante : ce test ecrit et supprime des lignes. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '' || !isLocalDatabase(databaseUrl)) return null;
  try {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    return null;
  }
}

const prisma = await connect();
const reachable = prisma !== null;

afterAll(async () => {
  await prisma?.$disconnect();
});

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Premier « aujourd'hui » de la suite, en jours depuis l'epoque : entre 1980 et 1998. */
const FIRST_DAY = 3_653 + Math.floor(Math.random() * 6_500);
let scenarios = 0;

/**
 * Un scenario : son propre jour, ses propres lignes, et leur nettoyage.
 *
 * `at(k, h)` : le jour `aujourd'hui + k` (k negatif : dans le passe), a `h`
 * heures UTC. « Maintenant » est aujourd'hui a 13 h : le jour en cours n'est
 * jamais complet, et les definitions doivent l'ignorer.
 */
function scenario() {
  const today = FIRST_DAY + 400 * scenarios;
  scenarios += 1;
  const players: string[] = [];
  const matches: string[] = [];

  const at = (k: number, hours = 10): number => (today + k) * DAY + hours * HOUR;

  return {
    now: at(0, 13),
    at,

    async player(createdAtMs: number): Promise<string> {
      const { id } = await prisma!.player.create({
        data: {
          displayName: `Indic ${randomUUID().slice(0, 8)}`,
          createdAt: new Date(createdAtMs),
          lastSeenAt: new Date(createdAtMs),
        },
        select: { id: true },
      });
      players.push(id);
      return id;
    },

    async match(input: {
      mode: MatchMode;
      startedAtMs: number;
      endedAtMs?: number;
      endReason?: string;
      isGhost?: boolean;
      /** Siege `a`, puis siege `b` : `null` pour un fantome. */
      seats: readonly (string | null | { playerId: string | null; queueWaitMs: number | null })[];
    }): Promise<string> {
      const id = `m_${randomUUID()}`;
      await prisma!.match.create({
        data: {
          id,
          mode: input.mode,
          rulesVersion: 'test',
          contentVersion: 'test',
          seed: 'test',
          status: 'ENDED',
          endReason: input.endReason ?? 'rounds',
          isGhost: input.isGhost ?? false,
          startedAt: new Date(input.startedAtMs),
          endedAt: new Date(input.endedAtMs ?? input.startedAtMs + 60_000),
          seats: {
            create: input.seats.map((seat, index) => {
              const { playerId, queueWaitMs } =
                seat === null || typeof seat === 'string'
                  ? { playerId: seat, queueWaitMs: null }
                  : seat;
              return { seat: index === 0 ? 'A' : 'B', playerId, queueWaitMs };
            }),
          },
        },
      });
      matches.push(id);
      return id;
    },

    /** Une affectation de test A/B ; supprimee avec le joueur (cascade). */
    async assign(
      playerId: string,
      group: 'treatment' | 'control',
      assignedAtMs: number,
      flag = 'intentBubble',
    ): Promise<void> {
      await prisma!.flagAssignment.create({
        data: { playerId, flag, group, assignedAt: new Date(assignedAtMs) },
      });
    },

    readCohort(group: 'treatment' | 'control') {
      return new PrismaIndicatorsReader(prisma as never).readCohort(this.now, {
        flag: 'intentBubble',
        group,
      });
    },

    async clip(playerId: string, matchId: string): Promise<void> {
      await prisma!.productEvent.create({ data: { playerId, matchId, kind: 'clip_shared' } });
    },

    read() {
      return new PrismaIndicatorsReader(prisma as never).read(this.now);
    },

    async cleanup(): Promise<void> {
      await prisma!.match.deleteMany({ where: { id: { in: matches } } });
      await prisma!.player.deleteMany({ where: { id: { in: players } } });
    },
  };
}

describe.skipIf(!reachable)('indicateurs produit, contre Postgres', () => {
  it('rend des mesures vides, jamais un zero invente, quand il n y a rien', async () => {
    const s = scenario();
    const { indicators, ghostShare } = await s.read();
    for (const measure of [...Object.values(indicators), ghostShare]) {
      expect(measure).toEqual({ value: null, n: 0 });
    }
  });

  it('retention J1 : comptes crees de J-31 a J-2, actifs en PvP le lendemain (jours UTC)', async () => {
    const s = scenario();
    try {
      const other = await s.player(s.at(-200));
      // Crees dans la fenetre.
      const bordRecent = await s.player(s.at(-2)); // J-2 : borne incluse, joue J-1
      const bordAncien = await s.player(s.at(-31)); // J-31 : borne incluse, joue J-30
      const pasLeLendemain = await s.player(s.at(-10)); // joue le jour meme et a J+2
      const soloSeul = await s.player(s.at(-5)); // ne joue qu'en solo le lendemain
      const contreFantome = await s.player(s.at(-4)); // joue contre un fantome : il a joue
      const minuit = await s.player(s.at(-3, 24) - 1); // 23:59:59.999, joue a 00:00
      // Hors fenetre.
      const hier = await s.player(s.at(-1)); // son lendemain n'est pas complet
      const tropAncien = await s.player(s.at(-32));

      await s.match({ mode: 'RANKED', startedAtMs: s.at(-1), seats: [bordRecent, other] });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-30), seats: [bordAncien, other] });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-10), seats: [pasLeLendemain, other] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-8), seats: [pasLeLendemain, other] });
      await s.match({ mode: 'SOLO', startedAtMs: s.at(-4), seats: [soloSeul, null] });
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-3),
        isGhost: true,
        seats: [contreFantome, null],
      });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-2, 0), seats: [minuit, other] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(0, 1), seats: [hier, other] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-31), seats: [tropAncien, other] });

      const { retentionD1 } = (await s.read()).indicators;
      expect(retentionD1.n).toBe(6);
      expect(retentionD1.value).toBeCloseTo(4 / 6, 10);
    } finally {
      await s.cleanup();
    }
  });

  it('retention J7 : comptes crees de J-37 a J-8, actifs en PvP sept jours apres', async () => {
    const s = scenario();
    try {
      const other = await s.player(s.at(-200));
      const bordRecent = await s.player(s.at(-8)); // joue J-1
      const bordAncien = await s.player(s.at(-37)); // joue J-30
      const aCote = await s.player(s.at(-20)); // joue a J+6 et J+8, pas a J+7
      const tropRecent = await s.player(s.at(-7)); // hors fenetre, joue J+7 = aujourd'hui
      const tropAncien = await s.player(s.at(-38)); // hors fenetre, joue J+7

      await s.match({ mode: 'RANKED', startedAtMs: s.at(-1), seats: [bordRecent, other] });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-30), seats: [bordAncien, other] });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-14), seats: [aCote, other] });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-12), seats: [aCote, other] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(0, 2), seats: [tropRecent, other] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-31), seats: [tropAncien, other] });

      const { retentionD7 } = (await s.read()).indicators;
      expect(retentionD7.n).toBe(3);
      expect(retentionD7.value).toBeCloseTo(2 / 3, 10);
    } finally {
      await s.cleanup();
    }
  });

  it('matchs PvP par actif et par jour : sieges reels / actifs quotidiens, sur J-7..J-1', async () => {
    const s = scenario();
    try {
      const [p1, p2, p3] = [
        await s.player(s.at(-100)),
        await s.player(s.at(-100)),
        await s.player(s.at(-100)),
      ];
      // J-1 : p1 joue trois fois (deux contre p2, une contre un fantome).
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-1, 8), seats: [p1, p2] });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-1, 9), seats: [p2, p1] });
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-1, 10),
        isGhost: true,
        seats: [p1, null],
      });
      // J-7 : borne incluse.
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-7, 0), seats: [p1, p3] });
      // Hors fenetre : J-8, aujourd'hui, et le solo.
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-7, 0) - 1, seats: [p1, p2] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(0, 1), seats: [p1, p2] });
      await s.match({ mode: 'SOLO', startedAtMs: s.at(-3), seats: [p3, null] });

      const { indicators, ghostShare } = await s.read();
      // Sieges : 3 + 2 (J-1) + 2 (J-7) = 7 ; actifs quotidiens : 2 + 2 = 4.
      expect(indicators.matchesPerActiveDay).toEqual({ value: 7 / 4, n: 4 });
      // Quatre matchs PvP dans la fenetre, dont un contre un fantome.
      expect(ghostShare).toEqual({ value: 1 / 4, n: 4 });
    } finally {
      await s.cleanup();
    }
  });

  it('attente mediane en file classee : sieges RANKED des 7 jours, attente connue', async () => {
    const s = scenario();
    try {
      const [p1, p2] = [await s.player(s.at(-100)), await s.player(s.at(-100))];
      const seat = (playerId: string | null, queueWaitMs: number | null) => ({
        playerId,
        queueWaitMs,
      });
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-1),
        seats: [seat(p1, 1_000), seat(p2, 5_000)],
      });
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-6),
        isGhost: true,
        seats: [seat(p1, 9_000), seat(null, null)],
      });
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-7, 0),
        seats: [seat(p2, 3_000), seat(p1, null)],
      });
      // Hors definition : partie rapide, hors fenetre, invitation.
      await s.match({
        mode: 'CASUAL',
        startedAtMs: s.at(-2),
        seats: [seat(p1, 100), seat(p2, 200)],
      });
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-8),
        seats: [seat(p1, 50_000), seat(p2, 60_000)],
      });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-1), seats: [p1, p2] });

      const { medianRankedWaitMs } = (await s.read()).indicators;
      // 1 000, 3 000, 5 000, 9 000 : mediane 4 000 (moyenne des deux du milieu).
      expect(medianRankedWaitMs).toEqual({ value: 4_000, n: 4 });
    } finally {
      await s.cleanup();
    }
  });

  it('part des matchs partages en clip : matchs PvP termines sur 7 jours', async () => {
    const s = scenario();
    try {
      const [p1, p2] = [await s.player(s.at(-100)), await s.player(s.at(-100))];
      const unClip = await s.match({ mode: 'RANKED', startedAtMs: s.at(-1), seats: [p1, p2] });
      const deuxClips = await s.match({ mode: 'CASUAL', startedAtMs: s.at(-2), seats: [p1, p2] });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-3), seats: [p1, p2] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-4), isGhost: true, seats: [p1, null] });
      // Commence a J-8, termine a J-7 : compte, c'est la FIN qui date un match termine.
      await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-7, 0) - 60_000,
        endedAtMs: s.at(-7, 0) + 60_000,
        seats: [p1, p2],
      });
      const solo = await s.match({ mode: 'SOLO', startedAtMs: s.at(-1), seats: [p1, null] });
      const ancien = await s.match({ mode: 'RANKED', startedAtMs: s.at(-8), seats: [p1, p2] });

      await s.clip(p1, unClip);
      await s.clip(p1, deuxClips);
      await s.clip(p2, deuxClips);
      await s.clip(p1, solo);
      await s.clip(p2, ancien);

      const { clipShareRate } = (await s.read()).indicators;
      expect(clipShareRate).toEqual({ value: 2 / 5, n: 5 });
    } finally {
      await s.cleanup();
    }
  });

  it('installations issues d invitations : premier match PvP des comptes de 30 jours', async () => {
    const s = scenario();
    try {
      const hote = await s.player(s.at(-100)); // hors cohorte : cree il y a 100 jours
      const invite = await s.player(s.at(-3)); // premier match : invitation
      const classeDabord = await s.player(s.at(-10)); // classe, PUIS invitation
      await s.player(s.at(-5)); // n'a jamais joue : hors effectif
      const soloSeul = await s.player(s.at(-6)); // solo seulement : hors effectif
      const tropAncien = await s.player(s.at(-31)); // hors cohorte
      const bord = await s.player(s.at(-30)); // borne incluse, premier match contre fantome
      const hier = await s.player(s.at(-1)); // invitation hier

      await s.match({ mode: 'INVITE', startedAtMs: s.at(-3, 11), seats: [hote, invite] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-2), seats: [invite, hote] });
      await s.match({ mode: 'RANKED', startedAtMs: s.at(-10, 11), seats: [classeDabord, hote] });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-9), seats: [hote, classeDabord] });
      await s.match({ mode: 'SOLO', startedAtMs: s.at(-6), seats: [soloSeul, null] });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-31, 11), seats: [hote, tropAncien] });
      await s.match({
        mode: 'CASUAL',
        startedAtMs: s.at(-30, 11),
        isGhost: true,
        seats: [bord, null],
      });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-29), seats: [hote, bord] });
      await s.match({ mode: 'INVITE', startedAtMs: s.at(-1, 11), seats: [hote, hier] });

      const { inviteInstallShare } = (await s.read()).indicators;
      expect(inviteInstallShare).toEqual({ value: 2 / 4, n: 4 });
    } finally {
      await s.cleanup();
    }
  });

  it('taux d abandon : forfait ou deconnexion parmi les matchs PvP termines sur 7 jours', async () => {
    const s = scenario();
    try {
      const [p1, p2] = [await s.player(s.at(-100)), await s.player(s.at(-100))];
      const fin = (mode: MatchMode, k: number, endReason: string, hours = 10) =>
        s.match({ mode, startedAtMs: s.at(k, hours), endReason, seats: [p1, p2] });
      await fin('RANKED', -1, 'forfeit');
      await fin('CASUAL', -2, 'disconnect');
      await fin('INVITE', -3, 'rounds');
      await fin('RANKED', -7, 'tiebreak', 0);
      // Hors definition.
      await fin('SOLO', -1, 'forfeit');
      await fin('RANKED', 0, 'forfeit', 1);
      await fin('RANKED', -8, 'forfeit');

      const { abandonRate } = (await s.read()).indicators;
      expect(abandonRate).toEqual({ value: 2 / 4, n: 4 });
    } finally {
      await s.cleanup();
    }
  });
});

/**
 * Lecture du test A/B de la bulle d'intention (spec 2026-09-26) : les memes
 * definitions que les indicateurs, restreintes aux joueurs affectes au groupe.
 */
describe.skipIf(!reachable)('experiences, contre Postgres', () => {
  it('rend des mesures vides pour un groupe sans joueur', async () => {
    const s = scenario();
    expect(await s.readCohort('treatment')).toEqual({
      players: 0,
      retentionD1: { value: null, n: 0 },
      retentionD7: { value: null, n: 0 },
      matchesPerActiveDay: { value: null, n: 0 },
      abandonRate: { value: null, n: 0 },
    });
  });

  it('restreint chaque definition aux joueurs affectes au groupe', async () => {
    const s = scenario();
    try {
      const t1 = await s.player(s.at(-5)); // traite, joue le lendemain (J1)
      const t2 = await s.player(s.at(-5)); // traite, ne joue jamais
      const t4 = await s.player(s.at(-10)); // traite, joue sept jours apres (J7)
      const c1 = await s.player(s.at(-5)); // temoin, joue le lendemain
      const u = await s.player(s.at(-5)); // jamais affecte : n'entre dans aucun groupe
      const tard = await s.player(s.at(-5)); // affecte APRES « maintenant » : pas encore
      const ailleurs = await s.player(s.at(-5)); // affecte a un autre drapeau

      for (const id of [t1, t2, t4]) await s.assign(id, 'treatment', s.at(-6));
      await s.assign(c1, 'control', s.at(-6));
      await s.assign(tard, 'treatment', s.at(1));
      await s.assign(ailleurs, 'treatment', s.at(-6), 'autreExperience');

      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-4), seats: [t1, u] });
      await s.match({
        mode: 'INVITE',
        startedAtMs: s.at(-4, 11),
        endReason: 'forfeit',
        seats: [t1, c1],
      });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-3), seats: [t4, u] });
      await s.match({ mode: 'CASUAL', startedAtMs: s.at(-4, 12), seats: [tard, ailleurs] });

      expect(await s.readCohort('treatment')).toEqual({
        players: 3,
        // t1, t2, t4 crees dans la fenetre J1 ; seul t1 joue le lendemain.
        retentionD1: { value: 1 / 3, n: 3 },
        // Seul t4 est assez ancien ; il joue a J+7.
        retentionD7: { value: 1, n: 1 },
        // Sieges de t1 (2) et t4 (1) sur deux journees-joueur.
        matchesPerActiveDay: { value: 1.5, n: 2 },
        // Les trois matchs ou un traite etait assis ; un forfait.
        abandonRate: { value: 1 / 3, n: 3 },
      });
      expect(await s.readCohort('control')).toEqual({
        players: 1,
        retentionD1: { value: 1, n: 1 },
        retentionD7: { value: null, n: 0 },
        matchesPerActiveDay: { value: 1, n: 1 },
        abandonRate: { value: 1, n: 1 },
      });
    } finally {
      await s.cleanup();
    }
  });
});

describe.skipIf(!reachable)('evenements produit, contre Postgres', () => {
  it('inscrit le clip d un joueur assis, une seule fois, et rien pour un inconnu', async () => {
    const s = scenario();
    try {
      const [assis, adverse, etranger] = [
        await s.player(s.at(-1)),
        await s.player(s.at(-1)),
        await s.player(s.at(-1)),
      ];
      const matchId = await s.match({
        mode: 'RANKED',
        startedAtMs: s.at(-1),
        seats: [assis, adverse],
      });
      const ghostMatch = await s.match({
        mode: 'CASUAL',
        startedAtMs: s.at(-1),
        isGhost: true,
        seats: [adverse, null],
      });
      const store = new PrismaProductEventStore(prisma as never);
      const entry = (playerId: string, id: string) => ({
        playerId,
        matchId: id,
        kind: 'clip_shared' as const,
        atMs: s.now,
      });

      expect(await store.recordIfSeated(entry(assis, matchId))).toBe(true);
      // Renvoi : aucun effet, aucune erreur.
      expect(await store.recordIfSeated(entry(assis, matchId))).toBe(false);
      // Pas assis a ce match, match inconnu, match contre un fantome sans lui.
      expect(await store.recordIfSeated(entry(etranger, matchId))).toBe(false);
      expect(await store.recordIfSeated(entry(assis, `m_${randomUUID()}`))).toBe(false);
      expect(await store.recordIfSeated(entry(assis, ghostMatch))).toBe(false);

      const rows = await prisma!.productEvent.findMany({
        where: { playerId: { in: [assis, adverse, etranger] } },
      });
      expect(rows).toEqual([
        { playerId: assis, matchId, kind: 'clip_shared', createdAt: new Date(s.now) },
      ]);
    } finally {
      await s.cleanup();
    }
  });
});

describe('garde-fou de la base visee', () => {
  it('refuse une base distante, qui pourrait etre une vraie', () => {
    expect(isLocalDatabase('postgresql://u:p@db.production.example.com:5432/aura')).toBe(false);
    expect(isLocalDatabase('postgresql://aura:aura@localhost:5433/aura_task4')).toBe(true);
  });
});
