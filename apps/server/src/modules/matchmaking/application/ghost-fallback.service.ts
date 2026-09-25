import { randomUUID } from 'node:crypto';
import { RULES_VERSION, type Seat } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import { leagueForMmr } from '../../rating/domain/rating.js';
import { searchRange } from '../domain/pairing.js';
import {
  GHOST_DISPLAY_NAME,
  GHOST_FALLBACK_MS,
  ghostSeatId,
  selectGhost,
  shouldFallBackToGhost,
} from '../domain/ghost.js';
import type { GhostRecordingStore, MatchOpening } from '../domain/ports.js';
import { queueWaitOf, type QueueMode, type QueueTicket } from '../domain/ticket.js';
import type { GhostActions, GhostDirector } from './ghost-director.js';

/**
 * Bascule d'un ticket vers un fantome (docs/05 § « Fantomes »).
 *
 * « Objectif : aucune file vide au lancement, sans faire croire a un faux
 * humain en ligne. » Un joueur seul devant son telephone attend sinon
 * indefiniment, et c'est le pire premier match possible.
 *
 * Ce service **n'a aucune regle a lui** : quand basculer et quel enregistrement
 * choisir sont deux fonctions pures de `domain/ghost.ts`. Il ne fait
 * qu'orchestrer, dans un ordre qui compte — lire, reclamer, ouvrir — et rendre
 * son ticket a qui n'a finalement pas eu de match.
 */

/**
 * Nombre d'enregistrements rapatries pour un choix.
 *
 * La base filtre deja par version et par fourchette de MMR ; ce plafond borne
 * ce qui traverse le reseau quand la fourchette s'est elargie a +-400 et que la
 * population est dense. Le selecteur n'a besoin que du plus proche, pas de
 * l'exhaustivite.
 */
const GHOST_CANDIDATE_LIMIT = 32;

/** Ce qu'une tentative de bascule a produit. */
export type GhostFallbackResult =
  /** Un match contre un fantome est ouvert. */
  | 'opened'
  /**
   * Rien n'a ete pris a la file : pas encore l'heure, aucun enregistrement
   * utilisable, ticket deja reclame ailleurs. Il n'y a rien a rendre.
   */
  | 'skipped'
  /**
   * Le ticket a ete reclame mais le match ne s'est pas ouvert. **L'appelant
   * doit le remettre en file** — lui seul l'a encore en main, et lui seul sait
   * si son joueur est parti ou deja assis ailleurs (`QueueWorker.restore`).
   */
  | 'failed';

/** Ce que ce service attend de la file : sortir un ticket, et rien d'autre. */
export interface GhostQueueAccess {
  claimForGhost(playerId: string): Promise<boolean>;
}

export class GhostFallbackService {
  constructor(
    private readonly queue: GhostQueueAccess,
    private readonly store: GhostRecordingStore,
    private readonly opener: MatchOpening,
    private readonly director: GhostDirector,
    /**
     * Ce que le fantome sait faire, realise par le runtime : les memes
     * methodes que celles qu'appelle la passerelle pour un joueur.
     */
    private readonly actions: GhostActions,
    private readonly log: AppLog | null = null,
    private readonly rulesVersion: string = RULES_VERSION,
    /**
     * Delais de bascule. Ceux de docs/05 par defaut ; raccourcis par les tests
     * de bout en bout, qui ne peuvent pas attendre vingt-cinq secondes par
     * scenario.
     */
    private readonly fallbackMs: Readonly<Record<QueueMode, number>> = GHOST_FALLBACK_MS,
  ) {}

  /**
   * Tente d'asseoir ce ticket face a un fantome.
   *
   * L'ordre des trois etapes n'est pas negociable :
   *
   * 1. **lire d'abord** : la lecture en base est la seule attente du chemin, et
   *    le ticket doit rester en file pendant ce temps — un humain qui se
   *    presente entre-temps vaut mieux qu'un enregistrement, et l'appariement
   *    normal doit pouvoir le prendre ;
   * 2. **reclamer ensuite**, atomiquement : sans cela, deux tours qui se
   *    chevauchent ouvriraient deux matchs a la meme personne ;
   * 3. **ouvrir enfin**, par le chemin unique. Un refus rend `failed`, et le
   *    ticket revient a l'appelant.
   */
  async tryOpen(ticket: QueueTicket, nowMs: number): Promise<GhostFallbackResult> {
    if (!shouldFallBackToGhost(ticket, nowMs, this.fallbackMs)) return 'skipped';

    const range = searchRange(nowMs - ticket.enqueuedAtMs);
    let candidates;
    try {
      candidates = await this.store.candidates({
        rulesVersion: this.rulesVersion,
        mmr: ticket.mmr,
        range,
        limit: GHOST_CANDIDATE_LIMIT,
      });
    } catch (cause) {
      // Une reserve de fantomes injoignable ne casse rien : le joueur continue
      // d'attendre un humain, et le tour suivant reessaiera.
      this.log?.warn(`fantomes illisibles pour ${ticket.playerId} : ${describeCause(cause)}`);
      return 'skipped';
    }

    const recording = selectGhost(candidates, ticket, nowMs, this.rulesVersion);
    if (recording === null) return 'skipped';

    if (!(await this.queue.claimForGhost(ticket.playerId))) return 'skipped';

    /**
     * Le fantome s'assoit en `b`, le joueur en `a`.
     *
     * L'ordre n'a aucun effet de jeu — la resolution d'une manche est
     * symetrique — mais il rend les journaux et la base lisibles : le siege `a`
     * d'un match fantome est toujours la personne.
     */
    const seat: Seat = 'b';
    const ghostPlayerId = ghostSeatId(recording.id, randomUUID());

    const matchId = this.opener.open({
      playerA: ticket.playerId,
      playerB: ghostPlayerId,
      mode: ticket.mode === 'ranked' ? 'RANKED' : 'CASUAL',
      ghost: {
        seat,
        sourcePlayerId: recording.playerId,
        mmr: recording.mmr,
        recordingId: recording.id,
        displayName: GHOST_DISPLAY_NAME,
        // Le fantome n'a pas de LP a lui : on montre la ligue que son MMR
        // implique, par la conversion dont le classement se sert deja.
        league: leagueForMmr(recording.mmr),
      },
      // Le joueur a attendu ; le fantome, lui, n'a jamais fait la queue.
      queueWaitMs: { a: queueWaitOf(ticket, nowMs) },
    });

    if (matchId === null) {
      this.log?.warn(`match fantome non ouvert pour ${ticket.playerId} : retour en file`);
      return 'failed';
    }

    /**
     * Le rejeu prend la main **apres** l'ouverture, et c'est sans risque :
     * `MatchOpener.open` est synchrone par contrainte, donc aucune echeance ne
     * peut se declencher entre son retour et cette ligne. La premiere phase que
     * le fantome doit jouer est la recharge, qui n'ouvre qu'au bout de l'intro.
     */
    this.director.attach({
      ghostPlayerId,
      matchId,
      seat,
      recording,
      actions: this.actions,
    });

    return 'opened';
  }
}
