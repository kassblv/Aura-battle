import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Seat as SeatColumn } from '@prisma/client';
import { z } from 'zod';
import { PinoLoggerService } from '../../../shared/logger.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { MatchRecord, MatchRepository, PersistedEvent } from '../domain/ports.js';

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
const SEAT_COLUMN = { a: 'A', b: 'B' } as const satisfies Record<'a' | 'b', SeatColumn>;

/**
 * Forme de la colonne `events`, declaree plutot que deduite.
 *
 * Cette colonne est un contrat persiste : ce qu'on y ecrit aujourd'hui, une
 * autre version du serveur le relira dans six mois. Le declarer ici vaut ce que
 * vaut `serializeServerMessage` sur le reseau — le schema est le seul endroit
 * ou la forme est ecrite une fois pour toutes, et il sert autant a l'ecriture
 * qu'a la relecture.
 *
 * Le schema vit dans l'adaptateur, pas a cote du port : la disposition d'une
 * colonne Prisma est une affaire de stockage, et le domaine n'a pas a la
 * connaitre (docs/02). Une lecture de ces lignes est elle aussi un adaptateur,
 * et importera ce schema d'ici.
 *
 * Deux champs comptent des evenements perdus et leurs noms se ressemblent ;
 * c'est la raison premiere de ce schema. Ils ne disent pas la meme chose :
 * `droppedEvents` vient du runtime et compte les entrees refusees au journal
 * faute de **place au journal** ; `omittedEntries` vient de l'adaptateur et
 * compte celles refusees a l'ecriture faute de **place en octets**.
 */
const seatCountersSchema = z.object({
  /** Evenements que le moteur a refuses (hors phase, energie manquante…). */
  rejectedEvents: z.number().int().nonnegative(),
  /** Entrees que le runtime n'a pas journalisees : journal plein. */
  droppedEvents: z.number().int().nonnegative(),
  /** Instants declares qui n'ont pas pu avoir lieu : signal « Latence », docs/06. */
  impossibleTaps: z.number().int().nonnegative(),
});

export const matchEventsColumnSchema = z.object({
  /** Journal des evenements acceptes, dans l'ordre, eventuellement tronque. */
  entries: z.array(z.object({ atMs: z.number(), event: z.unknown() })),
  /** Entrees que l'adaptateur n'a pas ecrites : plafond d'octets atteint. */
  omittedEntries: z.number().int().nonnegative(),
  /** Compteurs d'anti-triche, par siege : les sanctions visent un joueur. */
  counters: z.object({ A: seatCountersSchema, B: seatCountersSchema }),
});

export type MatchEventsColumn = z.infer<typeof matchEventsColumnSchema>;

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
 * Taille maximale de la colonne `events`, en octets de JSON.
 *
 * Le runtime borne deja le journal en **nombre** d'entrees ; cette seconde
 * borne porte sur le **volume**, que le nombre d'entrees ne predit pas : une
 * seule socket au debit autorise, par lots de 72 taps sur les 18 s de recharge,
 * produit environ 610 Ko sans jamais atteindre les 500 entrees.
 *
 * Ce seuil est donc franchissable par un client parfaitement legal, et pas
 * seulement par un abus. Il faut le lire dans les deux sens : au-dela, le
 * journal est **tronque**, et `docs/06` promet un journal de litige conserve
 * 30 jours — un match dispute pourra n'en avoir qu'un debut. C'est aussi
 * pourquoi on tronque au lieu de jeter : jeter donnerait a qui veut effacer sa
 * partie un moyen simple et legal de l'obtenir.
 */
const MAX_EVENTS_BYTES = 256 * 1024;

/** Longueur maximale de la cause recopiee dans un journal d'erreur. */
const MAX_CAUSE_CHARS = 200;

/** Nombre de chemins fautifs recopies avant de se contenter de les compter. */
const MAX_LOGGED_ISSUE_PATHS = 10;

/**
 * Chemins des champs refuses par le schema, bornes.
 *
 * `z.array()` signale **chaque** element invalide : un journal de 500 entrees
 * malformees donnerait 500 chemins sur une seule ligne, emise au moment precis
 * ou le serveur va deja mal. Dix chemins disent de quoi il s'agit, le compte
 * dit l'ampleur.
 */
function describeIssues(issues: readonly { readonly path: readonly PropertyKey[] }[]): string {
  const paths = issues
    .slice(0, MAX_LOGGED_ISSUE_PATHS)
    .map((issue) => issue.path.map(String).join('.'));
  const rest = issues.length - paths.length;
  return rest > 0 ? `${paths.join(', ')} (+${String(rest)} autres)` : paths.join(', ');
}

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
 * Plus long prefixe du journal qui tient dans le budget donne.
 *
 * On mesure entree par entree, une seule fois chacune : mesurer le tableau
 * entier a chaque essai couterait un carre la ou le journal peut deja compter
 * 500 entrees de plusieurs kilo-octets.
 *
 * Une entree non serialisable arrete la coupe : elle ferait echouer l'ecriture
 * complete, et ce qui la precede reste rejouable.
 */
function fittingPrefix(
  entries: readonly PersistedEvent[],
  budgetBytes: number,
): readonly PersistedEvent[] {
  let used = 0;
  let kept = 0;
  for (const entry of entries) {
    const size = jsonSize(entry);
    if (size === null) break;
    // La virgule qui separe l'entree de la precedente compte, elle aussi.
    used += size + 1;
    if (used > budgetBytes) break;
    kept += 1;
  }
  return kept === entries.length ? entries : entries.slice(0, kept);
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
   * la graine, les sieges et les manches. On ecrit donc le plus long debut de
   * journal qui tienne sous le plafond, et on compte le reste. Graine plus
   * prefixe rejoue le match jusqu'au point de coupure ; graine plus rien ne
   * rejoue rien, et offrirait a qui veut effacer sa partie un moyen legal d'y
   * parvenir (voir MAX_EVENTS_BYTES).
   *
   * Les compteurs, eux, ne sont jamais tronques : ils ne pesent rien et disent
   * a l'anti-triche ce que le journal ne dit plus.
   */
  private eventsColumn(
    record: MatchRecord,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    const counters = this.countersColumn(record);
    // Le budget des entrees est ce que l'enveloppe laisse : compteurs et
    // `omittedEntries` partent dans la meme colonne et comptent dans le total.
    // Une enveloppe qu'on ne sait pas peser ne laisse aucun budget : un repli
    // genereux accorderait le plafond entier aux entrees, soit exactement le
    // depassement que ce calcul existe pour empecher.
    const overhead = jsonSize({ entries: [], counters, omittedEntries: record.events.length });
    const kept = fittingPrefix(record.events, overhead === null ? 0 : MAX_EVENTS_BYTES - overhead);
    const omittedEntries = record.events.length - kept.length;

    if (omittedEntries > 0) {
      this.logger.warn(
        `journal du match ${record.matchId} tronque a l'ecriture : ${String(kept.length)} entrees conservees, ${String(omittedEntries)} ecartees`,
        'PrismaMatchRepository',
      );
    }

    const checked = matchEventsColumnSchema.safeParse({
      entries: [...kept],
      omittedEntries,
      counters,
    });
    if (checked.success) return toJson(checked.data);

    /**
     * Repli en deux temps, parce que les deux moities de l'enveloppe n'ont pas
     * la meme solidite.
     *
     * `atMs` est la seule valeur ici qui sorte d'un calcul sur des horloges :
     * c'est la ou une aberration est plausible. Les compteurs, eux, sortent
     * d'un `+= 1` sur des champs initialises a zero — s'ils sont faux, le
     * runtime a un probleme bien plus grave que cette colonne. On abandonne
     * donc le journal, jamais les compteurs, tant que ceux-ci se tiennent : le
     * signal « Latence » de docs/06 ne vaut qu'agrege sur des milliers de
     * matchs, et une entree horodatee de travers ne doit pas l'eteindre.
     */
    const withoutEntries = matchEventsColumnSchema.safeParse({
      entries: [],
      omittedEntries: record.events.length,
      counters,
    });

    /**
     * Seuls les **chemins** fautifs sont journalises : un message de zod
     * recopie les valeurs refusees, donc potentiellement le journal entier.
     */
    this.logger.error(
      new Error(
        `colonne events du match ${record.matchId} hors schema (${withoutEntries.success ? 'journal abandonne, compteurs conserves' : 'colonne nulle'}) : ${describeIssues(checked.error.issues)}`,
      ),
      undefined,
      'PrismaMatchRepository',
    );

    // Les compteurs eux-memes sont en cause : plus rien de cette colonne n'est
    // croyable. Le reste de la ligne — graine, sieges, manches — part quand meme.
    return withoutEntries.success ? toJson(withoutEntries.data) : Prisma.JsonNull;
  }

  /**
   * Compteurs d'anti-triche, **par siege**.
   *
   * Les sanctions de docs/06 visent un joueur et les premieres sont
   * automatiques : un compteur commun aux deux sieges attribuerait a un
   * innocent les mensonges de son adversaire, et un tricheur prolifique
   * empoisonnerait le score de suspicion de chaque personne qu'il croise.
   *
   * Les cles sont celles de l'enum Prisma (`A`/`B`), pas celles du moteur :
   * c'est la ligne `MatchSeat` correspondante qu'on voudra rapprocher de ces
   * chiffres, et c'est la que ces compteurs finiront en colonnes.
   */
  private countersColumn(record: MatchRecord): MatchEventsColumn['counters'] {
    const forSeat = (seat: 'a' | 'b'): MatchEventsColumn['counters']['A'] => ({
      rejectedEvents: record.rejectedEvents[seat],
      droppedEvents: record.droppedEvents[seat],
      impossibleTaps: record.impossibleTaps[seat],
    });
    return { [SEAT_COLUMN.a]: forSeat('a'), [SEAT_COLUMN.b]: forSeat('b') };
  }
}
