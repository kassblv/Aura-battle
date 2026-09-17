import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Seat as SeatColumn } from '@prisma/client';
import { PinoLoggerService } from '../../../shared/logger.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { MatchRecord, MatchRepository } from '../domain/ports.js';

/**
 * Adaptateur Prisma du port `MatchRepository` (docs/02, docs/04).
 *
 * Il ne contient aucune regle : traduire un `MatchRecord` en lignes, rien de
 * plus. Le moteur a deja tout decide au moment ou l'on arrive ici.
 */

/**
 * Sieges : le moteur dit `a`/`b`, l'enum Prisma dit `A`/`B` (ADR 0006).
 *
 * La conversion est explicite et centralisee ici. Une chaine du moteur passee
 * telle quelle a Prisma serait refusee a l'ecriture — donc au pire moment, en
 * fin de match, quand le resultat est deja parti chez les joueurs.
 */
const SEAT_COLUMN: Readonly<Record<'a' | 'b', SeatColumn>> = { a: 'A', b: 'B' };

/**
 * Le port garde les charges utiles opaques (`unknown`) pour que le modele de
 * donnees n'impose rien au moteur. Prisma, lui, veut du JSON : la conversion
 * est un cast assume, pas une conversion de forme — ces valeurs viennent de
 * `@aura/rules` et sont deja serialisables.
 */
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * Bornes de la transaction, choisies plutot que subies.
 *
 * `maxWait` est l'attente d'une connexion libre. Les defauts (2 s / 5 s) sont
 * tailles pour une requete au fil de l'eau ; ici les ecritures arrivent par
 * rafales — tous les matchs d'une vague de fin de partie tombent ensemble — et
 * une attente trop courte ferait echouer l'enregistrement au moment precis ou
 * le serveur est le plus charge. Cinq secondes laissent passer la rafale.
 *
 * `timeout` borne la transaction elle-meme : trois `INSERT` dont un seul porte
 * du volume. Dix secondes sont deux ordres de grandeur au-dessus du cas reel —
 * assez pour ne jamais expirer sans raison, assez court pour qu'une connexion
 * bloquee soit rendue avant de gener les matchs suivants.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * Taille maximale du journal ecrit, en octets de JSON.
 *
 * Le journal est deja borne en nombre d'entrees par le runtime ; cette seconde
 * borne porte sur le volume, que le nombre d'entrees ne predit pas. Un journal
 * plausible pese quelques dizaines de kilo-octets : 256 Ko laissent une marge
 * confortable tout en gardant l'ecriture loin de son echeance.
 */
const MAX_EVENTS_BYTES = 256 * 1024;

/** Longueur maximale de la cause recopiee dans un journal d'erreur. */
const MAX_CAUSE_CHARS = 200;

/** Poids JSON d'une valeur, ou `null` si elle n'est pas serialisable. */
function jsonSize(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? Buffer.byteLength(json) : null;
  } catch {
    return null;
  }
}

/**
 * Resume d'une erreur, sans rien recopier du match.
 *
 * Une `PrismaClientValidationError` reproduit les arguments refuses dans son
 * message **et** dans sa pile : journaliser l'un ou l'autre tel quel publierait
 * la graine et le journal d'evenements en clair. On ne garde que le nom et la
 * premiere ligne, tronquee — le detail d'une erreur ne vaut pas cette fuite.
 */
function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return 'cause inconnue';
  const firstLine = error.message.split('\n', 1)[0] ?? '';
  return `${error.name}: ${firstLine.slice(0, MAX_CAUSE_CHARS)}`;
}

@Injectable()
export class PrismaMatchRepository implements MatchRepository {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir auth.controller.ts).
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  /**
   * Ecrit le match acheve **en une seule transaction**.
   *
   * Un match sans ses sieges ne dit pas qui a joue, et une manche orpheline ne
   * dit rien du tout : ces lignes n'ont de sens qu'ensemble. Une ecriture
   * partielle laisserait en base un match qu'on ne pourrait ni rejouer ni
   * attribuer, et qui passerait pourtant pour complet.
   */
  async save(record: MatchRecord): Promise<void> {
    const events = this.eventsColumn(record);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.match.create({
          data: {
            id: record.matchId,
            mode: record.mode,
            rulesVersion: record.rulesVersion,
            contentVersion: record.contentVersion,
            seed: record.seed,
            status: 'ENDED',
            endReason: record.reason,
            winnerSeat: record.winner === null ? null : SEAT_COLUMN[record.winner],
            startedAt: new Date(record.startedAtMs),
            endedAt: new Date(record.endedAtMs),
            events,
          },
        });

        await tx.matchSeat.createMany({
          data: [
            { matchId: record.matchId, seat: SEAT_COLUMN.a, playerId: record.seats.a },
            { matchId: record.matchId, seat: SEAT_COLUMN.b, playerId: record.seats.b },
          ],
        });

        // Un forfait avant la premiere manche laisse un match sans manche.
        // On n'envoie alors aucune requete : rien a ecrire.
        if (record.rounds.length > 0) {
          await tx.matchRound.createMany({
            data: record.rounds.map((round) => ({
              matchId: record.matchId,
              round: round.round,
              result: toJson(round.result),
            })),
          });
        }
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      /**
       * On journalise l'identifiant et la cause, jamais le contenu du match :
       * choix, timings et graine n'ont pas plus leur place dans un journal que
       * sur le reseau (regle d'or n°4). L'erreur repart telle quelle — c'est au
       * runtime de decider qu'un enregistrement perdu ne tue pas le serveur.
       */
      this.logger.error(
        new Error(`enregistrement du match ${record.matchId} impossible : ${describeCause(error)}`),
        undefined,
        'PrismaMatchRepository',
      );
      throw error;
    }
  }

  /**
   * Contenu de la colonne `events`.
   *
   * Le journal part dans une seule colonne JSON : au-dela d'une certaine
   * taille, l'ecriture ne ralentit pas, elle **echoue** — et emporte avec elle
   * la graine, les sieges et les manches. On prefere donc ecrire le match sans
   * son journal. Perdre de quoi rejouer un match est regrettable ; perdre le
   * match lui-meme, qui a decide d'un classement, ne l'est pas au meme titre.
   *
   * Les compteurs restent dans tous les cas : ils ne pesent rien et disent a
   * l'anti-triche ce que le journal ne dit plus. `impossibleTaps` est le signal
   * « Latence » de docs/06 — il ne s'observe que match apres match, donc le
   * laisser tomber avec le journal reviendrait a l'eteindre pour de bon.
   */
  private eventsColumn(record: MatchRecord): Prisma.InputJsonValue {
    const counters = {
      rejectedEvents: record.rejectedEvents,
      droppedEvents: record.droppedEvents,
      impossibleTaps: record.impossibleTaps,
    };
    const size = jsonSize(record.events);
    if (size !== null && size <= MAX_EVENTS_BYTES) {
      return toJson({ entries: record.events, ...counters, omittedEntries: 0 });
    }

    this.logger.warn(
      `journal du match ${record.matchId} ecarte a l'ecriture : ${String(record.events.length)} entrees, ${size === null ? 'non serialisable' : `${String(size)} octets`}`,
      'PrismaMatchRepository',
    );
    return toJson({ entries: [], ...counters, omittedEntries: record.events.length });
  }
}
