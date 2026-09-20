import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { GhostRecording, GhostRound } from '../domain/ghost.js';
import type { GhostRecordingStore } from '../domain/ports.js';

/**
 * Adaptateur Prisma du port `GhostRecordingStore` (docs/04, `GhostRecording`).
 *
 * Aucune regle ici : ecrire une ligne, en relire quelques-unes. Le **choix** du
 * fantome est pur et vit dans `domain/ghost.ts` ; la requete ne fait que lui
 * eviter de rapatrier la table entiere.
 */

/**
 * Manches relues depuis la colonne JSON.
 *
 * Ces octets ont pu etre ecrits par une version anterieure du serveur, ou
 * modifies a la main. Un enregistrement qui ne passe pas ce schema est traite
 * comme **absent** : il vaut mieux un fantome de moins qu'un adversaire dont
 * les choix ne veulent rien dire — `selectGhost` refuse d'ailleurs deja les
 * enregistrements sans manche, et c'est exactement le sort reserve ici a un
 * enregistrement illisible.
 *
 * Le schema est **strict** et referme chaque valeur sur son domaine : un palier
 * de 9 ou un amplificateur negatif traverserait sinon jusqu'au moteur, qui les
 * refuserait au pire moment — pendant la manche d'un joueur.
 */
const ghostRoundSchema = z.strictObject({
  move: z.strictObject({
    style: z.enum(['calme', 'hype', 'provoc']),
    tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
  amplifier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  useUltimate: z.boolean(),
  timing: z.strictObject({
    quality: z.enum(['perfect', 'good', 'miss']),
    delta: z.number().min(0).max(1),
  }),
  rechargePoints: z.number().int().nonnegative(),
  rechargeTaps: z.number().int().nonnegative(),
});

/**
 * Nombre maximal de manches conservees, a l'ecriture comme a la relecture.
 *
 * Un match fait trois manches (`BALANCE.match.maxRounds`). La borne existe pour
 * que la colonne reste petite quoi qu'il arrive : elle part dans un `Json`, et
 * une colonne qui enfle finit par faire echouer une ecriture au pire moment.
 */
const MAX_RECORDED_ROUNDS = 8;

const ghostRoundsSchema = z.array(ghostRoundSchema).max(MAX_RECORDED_ROUNDS);

/** Un `Json` de Prisma, tel quel : ces valeurs viennent du moteur, deja serialisables. */
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

@Injectable()
export class PrismaGhostStore implements GhostRecordingStore {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Enregistrements utilisables pour ce niveau.
   *
   * La fourchette de MMR et la version sont filtrees par l'index
   * (`GhostRecording_rulesVersion_mmr_idx`, docs/04). Le tri par date fait le
   * reste : a fourchette egale, on prefere ce qui vient d'etre joue, donc le
   * jeu le plus representatif de la version en cours.
   */
  async candidates(query: {
    readonly rulesVersion: string;
    readonly mmr: number;
    readonly range: number;
    readonly limit: number;
  }): Promise<readonly GhostRecording[]> {
    const rows = await this.prisma.ghostRecording.findMany({
      where: {
        rulesVersion: query.rulesVersion,
        mmr: { gte: query.mmr - query.range, lte: query.mmr + query.range },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: { id: true, playerId: true, mmr: true, rulesVersion: true, rounds: true },
    });

    const recordings: GhostRecording[] = [];
    for (const row of rows) {
      const rounds = ghostRoundsSchema.safeParse(row.rounds);
      // Illisible : on le laisse de cote sans bruit. Le tour suivant reprendra
      // les autres candidats, et `selectGhost` n'a jamais besoin de tous.
      if (!rounds.success) continue;
      recordings.push({
        id: row.id,
        playerId: row.playerId,
        mmr: row.mmr,
        rulesVersion: row.rulesVersion,
        rounds: rounds.data,
      });
    }
    return recordings;
  }

  /**
   * Ecrit l'enregistrement d'un joueur **en remplacant le precedent**.
   *
   * Une ligne par joueur, pas une par match : sans cela la table grossirait
   * d'une ligne a chaque manche classee jouee sur le serveur, pour un besoin —
   * « un adversaire credible de ce niveau » — qu'une seule ligne remplit deja.
   * La plus recente porte aussi le MMR le plus juste.
   *
   * Suppression et insertion dans **la meme transaction** : entre les deux, un
   * tour d'appariement qui cherche un fantome ne doit pas trouver ce joueur
   * sans enregistrement, sinon la reserve se troue exactement pendant les
   * vagues de fin de match, quand on en a le plus besoin.
   */
  async save(recording: {
    readonly playerId: string;
    readonly mmr: number;
    readonly rulesVersion: string;
    readonly rounds: readonly GhostRound[];
    readonly atMs: number;
  }): Promise<void> {
    const rounds = ghostRoundsSchema.parse(recording.rounds.slice(0, MAX_RECORDED_ROUNDS));

    await this.prisma.$transaction([
      this.prisma.ghostRecording.deleteMany({ where: { playerId: recording.playerId } }),
      this.prisma.ghostRecording.create({
        data: {
          playerId: recording.playerId,
          mmr: recording.mmr,
          rulesVersion: recording.rulesVersion,
          rounds: toJson(rounds),
          createdAt: new Date(recording.atMs),
        },
      }),
    ]);
  }
}
