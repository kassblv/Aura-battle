import { BALANCE, liveOrbs, type BalanceConfig, type Orb, type RechargeTap } from '@aura/rules';
import { reachable } from '../match/reach.js';
import { percent } from './gauge.js';

/**
 * Ce qu une image change, et rien d autre.
 *
 * L ecran de match melangeait deux rythmes dans le meme rendu React : une
 * aiguille et un compte a rebours qui bougent soixante fois par seconde, et
 * une trentaine de boutons qui ne bougent qu au doigt du joueur. Comme tout
 * partait du meme arbre, deplacer l aiguille redessinait les boutons — mesure
 * a l appui, la phase de choix tombait a 25 i/s sous ralenti x4.
 *
 * Ce module tient la moitie mobile, et il la tient **en fonctions pures** :
 * l ecran leur donne une horloge, elles rendent des chaines de style que la
 * boucle d animation pose sur des references. Rien ici ne touche le DOM, donc
 * tout se teste sans navigateur — c est la seule facon de verrouiller ce qui
 * est, par nature, invisible dans un instantane.
 *
 * Regle de propriete, a ne pas perdre de vue : **une propriete appartient a
 * React ou a la boucle, jamais aux deux**. Une valeur ecrite ici sur une
 * propriete que React rend aussi serait effacee au prochain rendu, et le
 * symptome serait un tremblement, pas une erreur.
 */

/**
 * Emplacements d orbes affiches. Il ne change pas en cours de manche.
 *
 * Fixe, meme pendant un evenement : ce sont des boutons montes une fois.
 * Aucune variante n y touche, et `frame.test.ts` le verifie pour chacune.
 */
export const ORB_SLOTS = BALANCE.recharge.visibleOrbs;

/** Ce que l horloge de phase dit a l image courante. */
export interface PhaseClock {
  /** Temps ecoule depuis le debut de la phase, jamais negatif. */
  readonly inPhaseMs: number;
  /** Temps restant avant sa fin, jamais negatif. */
  readonly leftMs: number;
  /** Avancement dans [0, 1], pour la barre du bandeau. */
  readonly progress: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Horloge de la phase courante.
 *
 * `view.ts` publie une **fin** et une **duree**, pas un debut : le debut s en
 * deduit, et le deduire a un seul endroit evite que deux appelants ne le
 * deduisent differemment. La duree nulle est possible entre deux messages
 * serveur, ou une division rendrait `NaN` puis un style invalide.
 */
export function phaseClock(endsAtMs: number, durationMs: number, nowMs: number): PhaseClock {
  const inPhaseMs = Math.max(0, nowMs - (endsAtMs - durationMs));
  return {
    inPhaseMs,
    leftMs: Math.max(0, endsAtMs - nowMs),
    progress: durationMs > 0 ? clamp01(inPhaseMs / durationMs) : 0,
  };
}

/**
 * Le compte a rebours, en dixiemes de seconde.
 *
 * Il n a jamais eu besoin de soixante images par seconde : il n affiche qu un
 * dixieme, donc il ne change dix fois par seconde qu au maximum. La boucle
 * compare la chaine rendue a celle deja posee et n ecrit que si elle differe —
 * inutile de programmer un second rythme, le format s en charge.
 */
export function countdownLabel(leftMs: number): string {
  return `${(Math.max(0, leftMs) / 1000).toFixed(1)} s`;
}

/**
 * Avancement de la barre de phase, en transformation.
 *
 * Elle etait peinte en `width` : une largeur qui change relance la mise en page
 * a chaque image. `scaleX` se compose, donc elle ne coute rien de plus que la
 * composition deja faite.
 */
export function progressTransform(progress: number): string {
  return `scaleX(${clamp01(progress).toFixed(4)})`;
}

/** Un emplacement d orbe, tel que la boucle doit le poser. */
export interface OrbPaint {
  /**
   * Orbe occupant l emplacement, ou `null`.
   *
   * Les emplacements restent montes du debut a la fin de la recharge : c est ce
   * qui permet a la boucle de les repeindre sans que React ne remonte rien. Un
   * emplacement vide est donc masque, pas absent — et il ne doit pas etre
   * tapable, sans quoi le joueur enverrait un tap dans le vide en touchant du
   * decor.
   */
  readonly orbIndex: number | null;
  readonly golden: boolean;
  /** Position en part de la largeur du terrain, deja formatee en pourcentage. */
  readonly left: string;
  readonly top: string;
  /** Opacite, qui dit le temps qu il reste a l orbe. */
  readonly opacity: string;
  readonly label: string;
}

const EMPTY_SLOT: OrbPaint = Object.freeze({
  orbIndex: null,
  golden: false,
  left: '0%',
  top: '0%',
  opacity: '0',
  label: 'Orbe',
});

/**
 * Les orbes a poser a un instant donne, un par emplacement.
 *
 * Le tableau fait **toujours** `ORB_SLOTS` cases, dans l ordre des
 * emplacements du moteur : c est ce qui apparie une case a une reference DOM
 * fixe. `liveOrbs` reste seul juge de ce qui est affiche — le refaire ici
 * serait une seconde implementation de la regle, et le jour ou les deux
 * divergent le joueur tape une orbe que le moteur a deja retiree.
 */
export function orbPaint(
  taps: readonly RechargeTap[],
  orbs: readonly Orb[],
  inPhaseMs: number,
  /** Les regles du match : duree de vie et emplacements des orbes. */
  rules: BalanceConfig = BALANCE,
): readonly OrbPaint[] {
  const slots: OrbPaint[] = Array.from({ length: ORB_SLOTS }, () => EMPTY_SLOT);

  for (const live of liveOrbs(taps, orbs, inPhaseMs, rules)) {
    if (live.slot < 0 || live.slot >= ORB_SLOTS) continue;
    const at = reachable(live.orb.x, live.orb.y);
    const golden = live.orb.kind === 'golden';
    slots[live.slot] = {
      orbIndex: live.orb.index,
      golden,
      left: percent(at.left),
      top: percent(at.top),
      // Meme fondu qu avant la separation des rythmes : une orbe pale est une
      // orbe qui va partir, et c est la seule facon de le voir venir.
      opacity: (0.4 + live.remaining * 0.6).toFixed(3),
      label: golden ? 'Orbe dorée' : 'Orbe',
    };
  }

  return slots;
}
