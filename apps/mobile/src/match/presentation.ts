import type { MatchState, Seat } from '@aura/rules';
import { animationFor, systemAnimation } from '../content/animations.js';
import type { Look } from '../app/wardrobe.js';

/**
 * De l etat de match a ce que l arene doit afficher.
 *
 * Cette traduction est le dernier endroit ou le choix adverse peut fuir. Le
 * moteur, lui, ne divulgue rien : il suffirait de lire `pending` pour
 * « preparer » l animation de l adversaire, et celui-ci jouerait son mouvement
 * une fraction de seconde trop tot. Un joueur attentif y lirait le choix avant
 * la revelation — sans qu aucune regle de score n ait ete enfreinte.
 *
 * D ou une fonction pure, testee : la regle d or n°4 se verifie ici comme elle
 * se verifie sur le reseau.
 */

export interface FighterPresentation {
  readonly animationId: string;
  readonly look: Look;
}

export interface Presentation {
  readonly fighters: Readonly<Record<Seat, FighterPresentation>>;
  /** Ferveur du public, entre 0 et 1. */
  readonly hype: number;
}

export interface PresentOptions {
  /**
   * Joue la joie et l encaissement.
   *
   * La mise en scene decide **quand** : le verdict arrive apres le choc, pas au
   * meme instant, sinon le joueur lit le resultat avant d avoir vu les auras.
   */
  readonly showOutcome?: boolean;
  /** Skins d animation equipes, par siege. */
  readonly skins?: Readonly<Partial<Record<Seat, string>>>;
}

const CHARGE = 'charge';

/** Ferveur par phase : elle monte avec l enjeu, jamais avec le hasard. */
const HYPE_BY_PHASE = {
  intro: 0.18,
  recharge: 0.55,
  choice: 0.4,
  reveal: 0.95,
  ended: 0.7,
} as const;

export function present(
  state: MatchState,
  looks: Readonly<Record<Seat, Look>>,
  options: PresentOptions = {},
): Presentation {
  const revealing = state.phase === 'reveal' || state.phase === 'ended';
  const lastRound = state.history.at(-1);

  const animationOf = (seat: Seat): string => {
    // Avant la revelation, tout le monde est en garde. Y compris soi-meme : le
    // choix est secret des deux cotes, et l arene n a pas a savoir plus tot.
    if (!revealing) return systemAnimation(CHARGE).id;

    if (options.showOutcome === true && lastRound !== undefined) {
      if (lastRound.winner === seat) return systemAnimation('victory').id;
      if (lastRound.winner !== null) return systemAnimation('stagger').id;
    }

    const move = state.seats[seat].moves.at(-1);
    if (move === undefined) return systemAnimation(CHARGE).id;
    return animationFor(move, options.skins?.[seat]).id;
  };

  return {
    fighters: {
      a: { animationId: animationOf('a'), look: looks.a },
      b: { animationId: animationOf('b'), look: looks.b },
    },
    hype: HYPE_BY_PHASE[state.phase],
  };
}
