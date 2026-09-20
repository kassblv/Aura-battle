import { BALANCE, type Orb, type RechargeTap, type TimingQuality } from '@aura/rules';
import type { OnlineMatch } from './online.js';
import type { SoloMatch } from './solo.js';

/**
 * Ce que l ecran de match a besoin de savoir.
 *
 * Une seule forme pour les deux modes. L ecran ne doit ni savoir s il joue
 * contre une IA locale ou contre un serveur, ni quel siege il occupe — c est
 * exactement la ou l on finit par inverser deux scores un jour de fatigue.
 * D ou « moi » et « adversaire » plutot que `a` et `b`.
 */

export type ViewPhase = 'idle' | 'intro' | 'recharge' | 'choice' | 'reveal' | 'ended';

export interface SideView {
  /**
   * Energie restante. `null` pour l adversaire, **toujours**.
   *
   * Le protocole ne l envoie pas : `round:intro` ne porte que celle du
   * destinataire. L afficher en solo, ou le client fait tourner le moteur et
   * pourrait donc la lire, apprendrait au joueur a compter sur une information
   * qui disparait des qu il joue en ligne.
   */
  readonly energy: number | null;
  readonly roundsWon: number;
}

export interface RoundView {
  /**
   * Numero de la manche decrite.
   *
   * Le resultat d une manche survit a sa manche : sans ce numero, un
   * consommateur ne peut pas distinguer « le resultat vient d arriver » de
   * « c est encore celui d avant », et rejouerait la revelation precedente.
   */
  readonly round: number;
  readonly winner: 'moi' | 'adversaire' | null;
  readonly myScore: number;
  readonly opponentScore: number;
  /** Qualite du timing du joueur local. Publique une fois la manche revelee. */
  readonly myQuality: TimingQuality;
  /** Le joueur local a depense son Ultime. */
  readonly myUltimate: boolean;
  /** L un des deux a contre l autre : la manche s est jouee sur les styles. */
  readonly countered: boolean;
}

export interface MatchView {
  readonly phase: ViewPhase;
  readonly round: number;
  /** Fin de la phase, en heure locale. */
  readonly phaseEndsAtMs: number;
  /** Duree de la phase : le moteur dit quand elle finit, pas combien elle dure. */
  readonly phaseDurationMs: number;
  readonly me: SideView;
  readonly opponent: SideView;
  readonly orbs: readonly Orb[];
  /** Taps deja declares : ce sont eux qui decident des orbes encore affichees. */
  readonly taps: readonly RechargeTap[];
  readonly meterPeriodMs: number;
  readonly opponentLocked: boolean;
  readonly lastRound: RoundView | null;
  readonly ended: { readonly winner: 'moi' | 'adversaire' | null } | null;
}

const DURATIONS: Readonly<Record<ViewPhase, number>> = {
  idle: 1,
  intro: BALANCE.phases.introMs,
  recharge: BALANCE.recharge.durationMs,
  choice: BALANCE.phases.choiceMs,
  reveal: BALANCE.phases.revealMs,
  ended: 1,
};

export function viewOfSolo(match: SoloMatch): MatchView {
  const state = match.state;
  const context = state.roundContext;
  const last = state.history.at(-1);

  return {
    phase: state.phase,
    round: state.round,
    phaseEndsAtMs: state.phaseEndsAtMs,
    phaseDurationMs: DURATIONS[state.phase],
    me: { energy: state.seats.a.energy, roundsWon: state.seats.a.roundsWon },
    // Volontairement `null` : voir `SideView.energy`.
    opponent: { energy: null, roundsWon: state.seats.b.roundsWon },
    orbs: context?.orbs ?? [],
    taps: state.pending.a.taps,
    meterPeriodMs: context?.gauge.periodMs ?? 0,
    // Le moteur local resout la manche des que les deux ont verrouille : il n y
    // a donc pas d instant ou l un attend l autre.
    opponentLocked: false,
    lastRound:
      last === undefined
        ? null
        : {
            round: state.history.length,
            winner: last.winner === null ? null : last.winner === 'a' ? 'moi' : 'adversaire',
            myScore: last.seats.a.score,
            opponentScore: last.seats.b.score,
            myQuality: last.seats.a.timing.quality,
            myUltimate: last.seats.a.usedUltimate,
            countered: last.seats.a.countered || last.seats.b.countered,
          },
    ended:
      state.result === null
        ? null
        : {
            winner:
              state.result.winner === null
                ? null
                : state.result.winner === 'a'
                  ? 'moi'
                  : 'adversaire',
          },
  };
}

export function viewOfOnline(match: OnlineMatch): MatchView {
  const state = match.state;
  const seat = state.seat ?? 'a';
  const other = seat === 'a' ? 'b' : 'a';
  const last = state.lastRound;

  return {
    phase: state.phase,
    round: state.round,
    phaseEndsAtMs: state.phaseEndsAtMs,
    phaseDurationMs: DURATIONS[state.phase],
    me: { energy: state.energy, roundsWon: state.roundsWon[seat] },
    opponent: { energy: null, roundsWon: state.roundsWon[other] },
    orbs: state.orbs,
    taps: state.sentTaps,
    meterPeriodMs: state.meter?.period ?? 0,
    opponentLocked: state.opponentLocked,
    lastRound:
      last === null
        ? null
        : {
            round: last.round,
            winner: last.winner === null ? null : last.winner === seat ? 'moi' : 'adversaire',
            myScore: last.sides[seat].final,
            opponentScore: last.sides[other].final,
            myQuality: last.sides[seat].timing.quality,
            myUltimate: last.sides[seat].ult,
            countered: last.sides.a.counter || last.sides.b.counter,
          },
    ended:
      state.result === null
        ? null
        : {
            winner:
              state.result.winner === null
                ? null
                : state.result.winner === seat
                  ? 'moi'
                  : 'adversaire',
          },
  };
}
