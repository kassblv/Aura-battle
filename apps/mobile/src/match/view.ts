import {
  type BalanceConfig,
  type Move,
  type Orb,
  type RechargeTap,
  type TimingQuality,
} from '@aura/rules';
import type { OnlineMatch } from './online.js';
import type { SoloMatch } from './solo.js';
import { matchRules, type MatchEvent } from './rules.js';
import { matchSpoils, type MatchSpoils } from './spoils.js';

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
  /**
   * Jauge d Ultime, 0 a 100. `null` pour l adversaire, **toujours**.
   *
   * Meme discipline que l energie, et le protocole la tient deja : un test de
   * `@aura/protocol` refuse un `round:intro` qui porterait l `ult` adverse.
   * Savoir que l autre est pret a lacher son Ultime changerait tout au bluff.
   */
  readonly ultimate: number | null;
  readonly roundsWon: number;
  /**
   * Ma case brillante pour la manche, ou `null`. Toujours `null` pour
   * l'adversaire : sa brillante est secrete jusqu'a `round:result`.
   */
  readonly shiny: Move | null;
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
  /** J'ai joue ma case brillante (×1,2). */
  readonly myShiny: boolean;
  /** L'adversaire a joue la sienne : revele avec la manche. */
  readonly opponentShiny: boolean;
  /*
    Ce que la revelation raconte (chantier n°3). Tout vient de `round:result`
    en ligne, ou de l'historique du moteur en solo : rien n'est devine.
  */
  readonly myMove: Move;
  readonly opponentMove: Move;
  /** Ma pose telle que le serveur l'a jouee, en ligne ; `null` en solo (le vestiaire fait foi). */
  readonly myPoseId: string | null;
  /** La pose adverse, en ligne ; `null` en solo, ou l'IA joue l'offerte. */
  readonly opponentPoseId: string | null;
  /** Qui a applique un contre, ou `null`. */
  readonly counteredBy: 'moi' | 'adversaire' | null;
  /** Un contre a ete annule par l'Ultime. */
  readonly counterBlocked: boolean;
  readonly revealFirst: 'moi' | 'adversaire';
  readonly opponentQuality: TimingQuality;
  readonly opponentUltimate: boolean;
}

export interface MatchView {
  /**
   * Les regles du match (chantier n°7). Tout nombre de regle que l'ecran
   * montre — couts, energie, jauge d'Ultime, multiplicateurs — se lit ici,
   * jamais dans `BALANCE` : pendant un evenement, les deux different.
   */
  readonly rules: BalanceConfig;
  /** L'evenement de la semaine qui regit ce match, ou `null` (solo, classe, normal). */
  readonly event: MatchEvent | null;
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
  readonly ended: {
    readonly winner: 'moi' | 'adversaire' | null;
    /**
     * Ce que la partie a rapporte.
     *
     * `null` en solo : il n y a pas de serveur pour crediter quoi que ce soit.
     * En ligne, le serveur calcule, credite ET envoie — et le client se
     * contentait de jeter le message. Un joueur gagnait des pieces sans jamais
     * l apprendre, et decouvrait un autre total au prochain passage par
     * l accueil.
     */
    readonly spoils: MatchSpoils | null;
  } | null;
}

/** Duree d'une phase, selon les regles du match. */
function durationOf(phase: ViewPhase, rules: BalanceConfig): number {
  switch (phase) {
    case 'intro':
      return rules.phases.introMs;
    case 'recharge':
      return rules.recharge.durationMs;
    case 'choice':
      return rules.phases.choiceMs;
    case 'reveal':
      return rules.phases.revealMs;
    case 'idle':
    case 'ended':
      return 1;
  }
}

/** Le dernier mouvement joue par un siege en solo : le moteur le range dans `moves`. */
function soloMoveOf(state: SoloMatch['state'], seat: 'a' | 'b'): Move {
  return state.seats[seat].moves.at(-1) ?? { style: 'calme', tier: 0 };
}

export function viewOfSolo(match: SoloMatch): MatchView {
  const state = match.state;
  const context = state.roundContext;
  const last = state.history.at(-1);

  return {
    // Le solo joue la config que son moteur a recue : la normale, sauf test.
    rules: match.rules,
    event: null,
    phase: state.phase,
    round: state.round,
    phaseEndsAtMs: state.phaseEndsAtMs,
    phaseDurationMs: durationOf(state.phase, match.rules),
    me: {
      energy: state.seats.a.energy,
      ultimate: state.seats.a.ultimateGauge,
      roundsWon: state.seats.a.roundsWon,
      shiny: context?.shiny.a ?? null,
    },
    // Volontairement `null` : voir `SideView.energy`.
    opponent: { energy: null, ultimate: null, roundsWon: state.seats.b.roundsWon, shiny: null },
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
            myShiny: last.seats.a.shiny,
            opponentShiny: last.seats.b.shiny,
            myMove: soloMoveOf(state, 'a'),
            opponentMove: soloMoveOf(state, 'b'),
            myPoseId: null,
            opponentPoseId: null,
            counteredBy: last.seats.a.countered
              ? 'moi'
              : last.seats.b.countered
                ? 'adversaire'
                : null,
            counterBlocked: last.seats.a.counterBlocked || last.seats.b.counterBlocked,
            // En solo, l'adversaire ouvre : la revelation du joueur ferme la scene.
            revealFirst: 'adversaire',
            opponentQuality: last.seats.b.timing.quality,
            opponentUltimate: last.seats.b.usedUltimate,
          },
    ended:
      state.result === null
        ? null
        : {
            spoils: null,
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
  const { rules, event } = matchRules(state.rulesVariant);

  return {
    rules,
    event,
    phase: state.phase,
    round: state.round,
    phaseEndsAtMs: state.phaseEndsAtMs,
    phaseDurationMs: durationOf(state.phase, rules),
    me: {
      energy: state.energy,
      ultimate: state.ultimate,
      roundsWon: state.roundsWon[seat],
      shiny: state.shiny,
    },
    opponent: { energy: null, ultimate: null, roundsWon: state.roundsWon[other], shiny: null },
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
            myShiny: last.sides[seat].shiny ?? false,
            opponentShiny: last.sides[other].shiny ?? false,
            myMove: last.sides[seat].move,
            opponentMove: last.sides[other].move,
            myPoseId: last.sides[seat].cosmetic.animationId,
            opponentPoseId: last.sides[other].cosmetic.animationId,
            counteredBy: last.sides[seat].counter
              ? 'moi'
              : last.sides[other].counter
                ? 'adversaire'
                : null,
            counterBlocked: last.sides.a.counterBlocked || last.sides.b.counterBlocked,
            revealFirst: last.timeline.revealFirst === seat ? 'moi' : 'adversaire',
            opponentQuality: last.sides[other].timing.quality,
            opponentUltimate: last.sides[other].ult,
          },
    ended:
      state.result === null
        ? null
        : {
            spoils: matchSpoils({
              softCurrency: state.result.rewards.softCurrency,
              xp: state.result.rewards.xp,
              xpTotal: state.result.rewards.xpTotal,
              ratingBefore: state.result.rating.before,
              ratingAfter: state.result.rating.after,
              leagueBefore: state.result.rating.leagueBefore,
              leagueAfter: state.result.rating.leagueAfter,
            }),
            winner:
              state.result.winner === null
                ? null
                : state.result.winner === seat
                  ? 'moi'
                  : 'adversaire',
          },
  };
}
