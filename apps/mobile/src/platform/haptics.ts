import type { AudioCue } from '../audio/cues.js';

/**
 * Le retour haptique.
 *
 * Deux moities, comme partout ailleurs dans ce dossier : `hapticFor` DECIDE,
 * en fonction pure qu un test interroge fait par fait, et le pilote EXECUTE.
 * Le pilote natif vit dans `capacitor.ts` ; ici on ne connait ni Capacitor ni
 * le navigateur.
 *
 * Le toucher **double** le son, il ne le remplace pas. On ne fait pas vibrer a
 * chaque evenement : un telephone qui bourdonne en continu pendant une
 * recharge a douze taps par seconde devient penible, et le joueur coupe le
 * retour plutot que le bruit.
 */

export type HapticStyle = 'light' | 'medium' | 'heavy';

/** Ce que le monde exterieur doit savoir faire. Une methode, rien de plus. */
export interface HapticDriver {
  impact(style: HapticStyle): void;
}

/**
 * Plancher entre deux vibrations, en millisecondes.
 *
 * Une revelation, un choc et une fin de manche tombent a quelques dizaines de
 * millisecondes d ecart. Sans plancher, le moteur du telephone les empile et
 * rend un bourdonnement continu au lieu de trois coups nets — le joueur ne
 * sent alors plus rien de precis, ce qui est pire que pas de retour du tout.
 */
export const HAPTIC_MIN_GAP_MS = 90;

/**
 * Ce que ce fait de jeu merite, ou `null`.
 *
 * **Regle d or n°4 : le toucher est un canal comme un autre.** Une vibration
 * declenchee par la revelation de l ADVERSAIRE dirait, par le doigt, quelque
 * chose que l ecran n a pas encore montre. Seul ce qui arrive au joueur de cet
 * appareil se sent.
 */
export function hapticFor(cue: AudioCue): HapticStyle | null {
  switch (cue.type) {
    case 'orbTap':
      // L orbe doree recompense, le tap rate corrige — et le rate est le seul
      // retour immediat qu on ait : son bruit se perd dans celui des orbes
      // voisines, et l oeil est occupe ailleurs.
      return cue.golden || !cue.hit ? 'light' : null;
    case 'lock':
      return 'medium';
    case 'clash':
      return cue.counter ? 'heavy' : 'medium';
    case 'reveal':
      return cue.local && cue.ultimate ? 'heavy' : null;
    case 'matchEnd':
      return cue.outcome === 'win' ? 'heavy' : 'medium';
    case 'card':
      // Le doigt sent ce qu'il vient de decider : choisir, retourner, et la
      // brillante qui arrive. La distribution et le refus passent par le son.
      return cue.action === 'pick' || cue.action === 'flip' || cue.action === 'shiny'
        ? 'light'
        : null;
    case 'reward':
      // Le gain se sent a sa mesure : des pieces effleurent, le gros lot cogne.
      return cue.size === 'jackpot' ? 'heavy' : cue.size === 'rare' ? 'medium' : 'light';
    default:
      // Combos, fin de recharge, accents de geste : le son les porte deja, et
      // ils arrivent trop souvent pour meriter le moteur.
      return null;
  }
}

export interface HapticsOptions {
  /** Injectee pour que le plancher se teste sans attendre. */
  now?: () => number;
}

export interface Haptics {
  cue(cue: AudioCue): void;
  setEnabled(enabled: boolean): void;
}

/**
 * Branche la decision sur un pilote.
 *
 * `driver` vaut `null` sur un navigateur de bureau : c est le cas **normal**,
 * pas une panne. Et un pilote qui leve — moteur occupe, permission refusee —
 * est avale : rien de ce qui se passe ici ne doit interrompre une manche.
 */
export function createHaptics(driver: HapticDriver | null, options: HapticsOptions = {}): Haptics {
  const now = options.now ?? (() => performance.now());
  let enabled = true;
  let lastAt = Number.NEGATIVE_INFINITY;

  return {
    cue(cue): void {
      if (!enabled || driver === null) return;
      const style = hapticFor(cue);
      if (style === null) return;

      const at = now();
      if (at - lastAt < HAPTIC_MIN_GAP_MS) return;
      lastAt = at;

      try {
        driver.impact(style);
      } catch {
        // Moteur indisponible ou permission refusee : le jeu continue.
      }
    },

    setEnabled(next): void {
      enabled = next;
    },
  };
}
