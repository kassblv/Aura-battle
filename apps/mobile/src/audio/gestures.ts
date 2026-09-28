import type { Animation } from '@aura/content';
import type { AudioCue } from './cues.js';

/**
 * Les accents d un geste, releves sur une tranche de temps.
 *
 * Une danse declare ses accents en parts de boucle (`sound` dans son fichier).
 * L appelant, lui, avance en secondes : il tient un temps ecoule qui grandit,
 * et demande a chaque image « qu est-ce qui vient de sonner ? ». Cette
 * fonction est le joint entre les deux.
 *
 * Pure et deterministe — aucune horloge, aucun `AudioContext`. C est ce qui
 * permet de verifier qu une roue claque une fois par tour sans carte son.
 */

/**
 * Les accents tombes dans l intervalle `]depuis, jusqu a]`, dans l ordre.
 *
 * L intervalle est ouvert a gauche et ferme a droite pour la meme raison que
 * `matchCues` compare deux instantanes : la boucle d animation repasse
 * soixante fois par seconde, et un intervalle ferme des deux cotes rejouerait
 * l impact a l image suivante.
 *
 * L ordre est chronologique et non celui du fichier : une acrobatie declare un
 * souffle **puis** un impact, et les rendre dans l ordre de declaration
 * inverserait les deux des que l intervalle enjambe la fin de la boucle.
 */
export function gestureCues(
  animation: Animation,
  fromSeconds: number,
  toSeconds: number,
): readonly AudioCue[] {
  const accents = animation.sound;
  const duration = animation.loop.duration;
  if (accents === undefined || accents.length === 0) return [];
  if (!(duration > 0) || !(toSeconds > fromSeconds)) return [];

  const fired: { readonly at: number; readonly cue: AudioCue }[] = [];
  for (const accent of accents) {
    const offset = accent.at * duration;
    /**
     * Le DERNIER passage de cet accent avant la fin de l intervalle.
     *
     * Prendre le dernier plutot que de compter tous les passages est ce qui
     * protege du retour d arriere-plan : une application suspendue trente
     * secondes revient avec un intervalle enorme, et compter les passages
     * lacherait quarante impacts d un coup. Un accent sonne au plus une fois
     * par appel, quelle que soit la duree du trou.
     */
    const time = Math.floor((toSeconds - offset) / duration) * duration + offset;
    if (time > fromSeconds) {
      fired.push({ at: time, cue: { type: 'gesture', accent: accent.accent } });
    }
  }

  return fired.sort((left, right) => left.at - right.at).map((entry) => entry.cue);
}
