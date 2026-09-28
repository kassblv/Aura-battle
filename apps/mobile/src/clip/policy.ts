import { REVEAL_FIRST_AT_MS, REVEAL_GAP_MS, VERDICT_PANEL_AT_MS } from '../arena/round.js';
import type { Side } from '../app/reveal.js';
import type { ViewPhase } from '../match/view.js';

/**
 * Quand filmer la revelation (ADR 0017), en fonction pure.
 *
 * On ne filme que ce qu on proposera : la revelation d une manche GAGNEE par
 * ce joueur, et on ne garde que la plus recente. Un enregistrement permanent
 * paierait l encodage a chaque manche pour des clips que personne ne verra.
 *
 * Solo et en ligne sont traites pareil : la revelation est publique une fois
 * `round:result` arrive, le clip ne montre rien que l ecran n ait montre
 * (regle d or n°4).
 */

/** Fin du clip : le verdict est tombe et a eu le temps d etre lu. */
export const CLIP_STOP_AT_MS = VERDICT_PANEL_AT_MS + 900;
/**
 * Au-dela, la revelation est trop entamee pour etre filmee.
 *
 * Avant la seconde carte : un clip qui rate les deux revelations n a plus de
 * sujet. Arrive en retard (onglet revenu, reconnexion), on attend la suivante.
 */
export const CLIP_LATEST_START_MS = REVEAL_FIRST_AT_MS + REVEAL_GAP_MS;

export interface ClipObservation {
  readonly phase: ViewPhase;
  readonly round: number;
  readonly inPhaseMs: number;
  /** La derniere manche tranchee, telle que la vue la porte. */
  readonly last: { readonly round: number; readonly winner: Side | null } | null;
}

/**
 * - `start` : filmer la revelation en cours ;
 * - `stop` : arreter et GARDER — c est la plus recente manche gagnee ;
 * - `cancel` : arreter et jeter ce qui est en cours ;
 * - `discard` : oublier le clip garde, il appartenait au match precedent.
 */
export type ClipCommand = 'start' | 'stop' | 'cancel' | 'discard';

export interface ClipPolicyState {
  readonly phase: ViewPhase | null;
  readonly round: number;
  /** Derniere manche examinee : on ne decide qu une fois par manche. */
  readonly seen: number | null;
  /** Manche en cours d enregistrement. */
  readonly recording: number | null;
}

export const INITIAL_CLIP_POLICY: ClipPolicyState = Object.freeze({
  phase: null,
  round: 0,
  seen: null,
  recording: null,
});

/**
 * Un nouveau match a-t-il commence depuis la derniere observation ?
 *
 * Le numero de manche qui recule, ou un ecran de fin qu on quitte : `intro`
 * seul ne suffit pas, il ouvre aussi chaque manche.
 */
function newMatch(state: ClipPolicyState, next: ClipObservation): boolean {
  if (state.phase === null) return false;
  return next.round < state.round || (state.phase === 'ended' && next.phase !== 'ended');
}

export function clipPolicy(
  state: ClipPolicyState,
  next: ClipObservation,
): { readonly state: ClipPolicyState; readonly commands: readonly ClipCommand[] } {
  const commands: ClipCommand[] = [];
  let { seen, recording } = state;

  if (newMatch(state, next)) {
    if (recording !== null) commands.push('cancel');
    commands.push('discard');
    recording = null;
    seen = null;
  }

  if (
    recording !== null &&
    (next.phase !== 'reveal' || next.inPhaseMs >= CLIP_STOP_AT_MS || next.last?.round !== recording)
  ) {
    commands.push('stop');
    recording = null;
  }

  const last = next.last;
  if (next.phase === 'reveal' && last !== null && last.round !== seen) {
    seen = last.round;
    if (last.winner === 'moi' && next.inPhaseMs < CLIP_LATEST_START_MS) {
      commands.push('start');
      recording = last.round;
    }
  }

  return { state: { phase: next.phase, round: next.round, seen, recording }, commands };
}
