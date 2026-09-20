import type { MatchState, Seat } from '@aura/rules';
import { BALANCE, opponentOf } from '@aura/rules';
import type { BalanceConfig } from '@aura/rules';
import type { ServerMessage } from '@aura/protocol';

/**
 * Vues par siege (regle d'or n°4, ADR 0005).
 *
 * **Tout** message destine a un joueur avant la revelation passe par une de ces
 * fonctions. C'est la seule facon de tenir la regle : un schema ferme les
 * champs *en trop*, il ne dit rien des mauvaises *valeurs* dans un champ
 * legitime — envoyer au siege `a` l'energie du siege `b` reste valide pour
 * zod. La confidentialite se joue donc ici, et un test de propriete verifie
 * qu'une vue ne contient jamais une valeur propre a l'autre siege.
 *
 * Aucune construction de message ailleurs dans le module match.
 */

/** Ce que le destinataire a le droit de savoir des deux sieges. */
function publicRoundsWon(state: MatchState): { a: number; b: number } {
  return { a: state.seats.a.roundsWon, b: state.seats.b.roundsWon };
}

/** Manches deja revelees : passees, donc publiques. */
function revealedHistory(state: MatchState): ServerMessage<'match:state'>['history'] {
  return state.history.map((result, index) => ({
    round: (index + 1) as 1 | 2 | 3,
    winner: result.winner,
    scores: { a: result.seats.a.score, b: result.seats.b.score },
  }));
}

export function roundIntroFor(
  seat: Seat,
  state: MatchState,
  matchId: string,
): ServerMessage<'round:intro'> {
  return {
    matchId,
    round: state.round,
    endsAt: state.phaseEndsAtMs,
    roundsWon: publicRoundsWon(state),
    // Energie et jauge du destinataire uniquement.
    energy: state.seats[seat].energy,
    ult: state.seats[seat].ultimateGauge,
  };
}

export function rechargeStartFor(
  state: MatchState,
  matchId: string,
  config: BalanceConfig = BALANCE,
): ServerMessage<'recharge:start'> {
  const orbs = state.roundContext?.orbs ?? [];
  return {
    matchId,
    round: state.round,
    // Le client a besoin des deux bornes : il fait apparaitre les orbes a
    // partir du debut, pas de la fin.
    startsAt: state.phaseEndsAtMs - config.phases.rechargeMs,
    endsAt: state.phaseEndsAtMs,
    // La sequence d'orbes est identique pour les deux joueurs : c'est ce qui
    // rend la recharge equitable, et elle n'apprend rien de l'adversaire.
    orbs: orbs.map((orb) => ({
      index: orb.index,
      x: orb.x,
      y: orb.y,
      kind: orb.kind,
      points: orb.points,
      lifetimeMs: orb.lifetimeMs,
    })),
  };
}

export function choiceStartFor(
  seat: Seat,
  state: MatchState,
  matchId: string,
): ServerMessage<'choice:start'> {
  const gauge = state.roundContext?.gauge;
  return {
    matchId,
    round: state.round,
    endsAt: state.phaseEndsAtMs,
    // La jauge est commune : tiree une fois par manche, elle ne revele rien.
    meter: {
      period: gauge?.periodMs ?? 1,
      zone: gauge?.zoneWidth ?? 0,
      perfect: gauge?.perfectWidth ?? 0,
      center: gauge?.center ?? 0,
    },
    energy: state.seats[seat].energy,
    ult: state.seats[seat].ultimateGauge,
  };
}

export function matchStateFor(
  seat: Seat,
  state: MatchState,
  matchId: string,
  /**
   * L'adversaire de ce siege est-il un rejeu (docs/05) ?
   *
   * Le drapeau doit survivre a la reprise : sans lui, une application mobile
   * tuee en arriere-plan reviendrait par `match:rejoin` et finirait la partie
   * en croyant affronter quelqu'un.
   */
  ghostOpponent = false,
): ServerMessage<'match:state'> {
  const context = state.roundContext;
  const base: ServerMessage<'match:state'> = {
    matchId,
    seat,
    phase: state.phase,
    round: state.round,
    endsAt: state.phaseEndsAtMs,
    roundsWon: publicRoundsWon(state),
    energy: state.seats[seat].energy,
    ult: state.seats[seat].ultimateGauge,
    // Le seul fait public de la phase de choix : l'adversaire a verrouille.
    // Ni son mouvement, ni son timing, ni son cout.
    opponentLocked: state.pending[opponentOf(seat)].locked !== null,
    ghost: ghostOpponent,
    history: revealedHistory(state),
  };

  if (context === undefined || context === null) {
    return base;
  }

  return {
    ...base,
    orbs: context.orbs.map((orb) => ({
      index: orb.index,
      x: orb.x,
      y: orb.y,
      kind: orb.kind,
      points: orb.points,
      lifetimeMs: orb.lifetimeMs,
    })),
    meter: {
      period: context.gauge.periodMs,
      zone: context.gauge.zoneWidth,
      perfect: context.gauge.perfectWidth,
      center: context.gauge.center,
    },
  };
}
