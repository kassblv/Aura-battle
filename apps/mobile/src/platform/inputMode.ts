import type { RechargeInputMode } from '@aura/protocol';
import { isNative } from './capacitor.js';

/**
 * Avec quoi le joueur attrape les orbes : au doigt, ou au clavier.
 *
 * Une seule detection pour deux usages : l'ecran de match s'en sert pour
 * afficher les touches (`ui/orbKeys.ts`), et le duel en ligne pour la mesure
 * d'equite clavier contre tactile (`recharge_input`, docs/10). Deux detections
 * pourraient diverger, et la mesure comparerait alors autre chose que ce que
 * les joueurs ont eu sous la main.
 */

/** Ordinateur : un pointeur fin qui survole. */
export const KEYBOARD_QUERY = '(hover: hover) and (pointer: fine)';

export interface InputEnvironment {
  readonly native: boolean;
  readonly matchMedia: ((query: string) => { readonly matches: boolean }) | null;
}

function currentEnvironment(): InputEnvironment {
  const matchMedia = (globalThis as { matchMedia?: (query: string) => { matches: boolean } })
    .matchMedia;
  return {
    native: isNative(),
    matchMedia: typeof matchMedia === 'function' ? matchMedia.bind(globalThis) : null,
  };
}

/**
 * Ordinateur, et pas l'application native. Un ecran tactile garde le doigt —
 * une tablette avec clavier aussi, tant que son pointeur principal est
 * grossier. Sans media query (tests, hors navigateur), le doigt.
 */
export function prefersKeys(env: InputEnvironment = currentEnvironment()): boolean {
  if (env.native) return false;
  return env.matchMedia?.(KEYBOARD_QUERY).matches ?? false;
}

/** Le mode de recharge, dans le vocabulaire du protocole. */
export function rechargeInputMode(env: InputEnvironment = currentEnvironment()): RechargeInputMode {
  return prefersKeys(env) ? 'keys' : 'touch';
}

/**
 * Vrai la premiere fois qu'on presente un match, faux ensuite.
 *
 * Le serveur n'inscrit deja qu'une ligne par (joueur, match, sorte) ; ceci
 * evite seulement de lui envoyer des requetes pour rien. La memoire est bornee
 * aux derniers matchs : une longue session ne la fait pas grossir.
 */
export function createOncePerMatch(limit = 32): (matchId: string) => boolean {
  const seen: string[] = [];
  return (matchId) => {
    if (seen.includes(matchId)) return false;
    seen.push(matchId);
    if (seen.length > limit) seen.shift();
    return true;
  };
}
