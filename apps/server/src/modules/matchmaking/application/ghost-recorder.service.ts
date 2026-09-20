import { RULES_VERSION, type Seat } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type { GhostRecorder, GhostRoundTrace } from '../../match/domain/ports.js';
import type { GhostRecordingStore, RatingReader } from '../domain/ports.js';
import { DEFAULT_MMR } from '../domain/ticket.js';

/**
 * Enregistrement des fantomes (docs/05 § « Fantomes »).
 *
 * « A la fin de chaque match classe humain contre humain, on stocke pour chaque
 * joueur ses choix, ses timings (ecart et qualite), son profil de recharge
 * (points par manche) et son MMR. »
 *
 * Le runtime fournit les quatre premiers — il les a sous la main, il vient de
 * les reveler aux deux joueurs. Le cinquieme est le seul ajout de ce service :
 * le MMR ne regarde pas le module match, et c'est le matchmaking qui sait le
 * lire. Realise `GhostRecorder`, declare a cote de son appelant : meme montage
 * que `MatchRatingSettlement`.
 *
 * **Ce qui n'est pas enregistre compte autant.** Ni graine, ni orbes, ni
 * instants de tap : un fantome rejouera sur une autre sequence et une autre
 * jauge. Ce qui se transporte est un **niveau de jeu**, pas une partie.
 */
const SEATS: readonly Seat[] = ['a', 'b'];

export class GhostRecorderService implements GhostRecorder {
  constructor(
    private readonly store: GhostRecordingStore,
    /**
     * Lecture du MMR, la meme que celle de l'entree en file : un fantome doit
     * etre choisi sur le niveau reel de son auteur, pas sur une estimation.
     */
    private readonly ratings: RatingReader,
    private readonly log: AppLog | null = null,
    private readonly rulesVersion: string = RULES_VERSION,
  ) {}

  async record(input: {
    readonly matchId: string;
    readonly seats: Readonly<Record<Seat, string>>;
    readonly rounds: Readonly<Record<Seat, readonly GhostRoundTrace[]>>;
    readonly atMs: number;
  }): Promise<void> {
    const { seats, rounds, atMs } = input;

    const mmrs = await this.mmrOf([seats.a, seats.b], atMs);

    /**
     * Les deux sieges s'ecrivent independamment.
     *
     * Un echec sur l'un ne doit pas priver l'autre de son enregistrement : il
     * n'y a aucun invariant qui lie les deux lignes — ce ne sont pas deux
     * moities d'un match, ce sont deux joueurs dont on retient le jeu.
     */
    await Promise.all(
      SEATS.map(async (seat) => {
        const played = rounds[seat];
        // Un siege qui n'a joue aucune manche — forfait immediat — ne fait pas
        // un adversaire : le rejouer offrirait la partie a qui le croiserait.
        if (played.length === 0) return;

        try {
          await this.store.save({
            playerId: seats[seat],
            mmr: mmrs.get(seats[seat]) ?? DEFAULT_MMR,
            rulesVersion: this.rulesVersion,
            rounds: played,
            atMs,
          });
        } catch (cause) {
          this.log?.warn(
            `enregistrement de fantome refuse pour le siege ${seat} du match ${input.matchId} : ${describeCause(cause)}`,
          );
        }
      }),
    );
  }

  /** MMR des deux joueurs, ou la valeur de depart si le classement est muet. */
  private async mmrOf(
    playerIds: readonly string[],
    atMs: number,
  ): Promise<ReadonlyMap<string, number>> {
    try {
      return await this.ratings.mmrOf(playerIds, atMs);
    } catch (cause) {
      // Un classement illisible ne doit pas faire perdre l'enregistrement : un
      // fantome a 1000 de MMR reste un fantome credible pour un debutant, et
      // c'est exactement la population qui souffre d'une file vide.
      this.log?.warn(`classement illisible a l'enregistrement : ${describeCause(cause)}`);
      return new Map<string, number>();
    }
  }
}
