import type { MatchState, Seat } from '@aura/rules';
import { effectForLevel } from '@aura/content';
import { animationFor, systemAnimation, victoryAnimation } from '../content/animations.js';
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
  /**
   * L effet d aura annonce par le serveur avec le resultat de la manche.
   *
   * **Absent tant que la manche n est pas revelee**, et c est la regle d or
   * n°4 : l effet depend du palier d amplificateur joue, donc le montrer avant
   * `round:result` dirait le choix secret de l adversaire. Il apparait a la
   * meme seconde que son animation, et sous la meme condition — les deux
   * viennent du meme message, celui ou les deux choix deviennent publics.
   */
  readonly auraEffectId?: string;
  /**
   * Le joueur regarde son propre choix : son aura s allume pour qu on la voie.
   *
   * Pose par `withChoicePreview`, sur le rig du joueur local seulement, et
   * sans rien dire du choix — voir `AuraDrive.preview`.
   */
  readonly auraPreview?: boolean;
}

export interface Presentation {
  readonly fighters: Readonly<Record<Seat, FighterPresentation>>;
  /** Ferveur du public, entre 0 et 1. */
  readonly hype: number;
  /**
   * Phase de choix : la main de cartes est a l'ecran, la camera cadre
   * au-dessus d'elle (`choiceFraming`). Absent hors match.
   */
  readonly choosing?: boolean;
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
  /**
   * Effets d aura POSSEDES, par siege — pas celui qui est equipe.
   *
   * Un skin paye habille UN palier d amplificateur (docs/01 §3), et le palier
   * n est connu qu a la revelation : il n y a donc rien a equiper d avance.
   * Absent, le siege porte l effet offert de son palier, comme tout le monde
   * avant la boutique — et c est ce que porte l IA, qui ne possede rien.
   *
   * En ligne, cette resolution appartient au SERVEUR et arrive toute faite
   * dans `round:result`. Ici il n y a personne d autre pour la faire.
   */
  readonly ownedEffects?: Readonly<Partial<Record<Seat, Iterable<string>>>>;
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
      if (lastRound.winner === seat) return victoryAnimation(looks[seat].signature).id;
      if (lastRound.winner !== null) return systemAnimation('stagger').id;
    }

    const move = state.seats[seat].moves.at(-1);
    if (move === undefined) return systemAnimation(CHARGE).id;
    return animationFor(move, options.skins?.[seat]).id;
  };

  /*
    L effet suit la meme garde que l animation, et pour la meme raison.

    L amplificateur s affiche sous le nom de son effet : le montrer avant la
    revelation reviendrait a annoncer le palier, donc une partie du choix
    secret. `revealing` gouverne les deux, en un seul endroit — deux
    conditions qui disent la meme chose finissent par diverger.
  */
  const effectOf = (seat: Seat): string | undefined => {
    if (!revealing) return undefined;
    const amplifier = state.seats[seat].amplifiers.at(-1);
    if (amplifier === undefined) return undefined;
    return effectForLevel(amplifier, options.ownedEffects?.[seat] ?? []).id;
  };

  const present1 = (seat: Seat, look: Look): FighterPresentation => {
    const auraEffectId = effectOf(seat);
    return {
      animationId: animationOf(seat),
      look,
      ...(auraEffectId === undefined ? {} : { auraEffectId }),
    };
  };

  return {
    fighters: { a: present1('a', looks.a), b: present1('b', looks.b) },
    hype: HYPE_BY_PHASE[state.phase],
    choosing: state.phase === 'choice',
  };
}
