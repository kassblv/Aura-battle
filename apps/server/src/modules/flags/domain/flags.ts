import { createHash } from 'node:crypto';

/**
 * Interrupteurs d'experience (spec 2026-09-26 « Bulle d'intention en test A/B »).
 *
 * **Declares en code, regles par l'environnement.** Le nom et la part par
 * defaut vivent ici : un drapeau qu'on ajouterait en base serait une porte que
 * n'importe quelle faille d'ecriture ouvrirait. La part, elle, se regle sans
 * redeployer de code (`FLAG_INTENT_BUBBLE_ROLLOUT`, `shared/config.ts`).
 *
 * Pur : aucune I/O. Le hachage vient de `node:crypto`, qui n'est ni un cadre
 * ni un depot — il rend la meme valeur partout, pour toujours.
 */

export const FLAGS = Object.freeze({
  /**
   * Bulle d'intention (docs/01 §10) : partie rapide et invitation seulement.
   * Pendant le test, la part ne fait que monter (ou tombe a 0) : le groupe
   * inscrit n'est jamais reecrit (docs/10).
   */
  intentBubble: Object.freeze({ defaultRollout: 50 }),
});

export type FlagName = keyof typeof FLAGS;

export const FLAG_NAMES: readonly FlagName[] = Object.freeze(Object.keys(FLAGS) as FlagName[]);

/** `treatment` : expose a la nouveaute. `control` : le jeu tel qu'il etait. */
export type FlagGroup = 'treatment' | 'control';

export const FLAG_GROUPS: readonly FlagGroup[] = Object.freeze(['treatment', 'control']);

/** Une part exposee : un entier de 0 a 100. */
export function isRollout(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Le « seau » d'un joueur pour un drapeau, de 0 a 99.
 *
 * `sha256(drapeau:joueur)` : le drapeau fait partie de la cle, sinon toutes
 * les experiences exposeraient les memes joueurs et se contamineraient. Les
 * 48 premiers bits suffisent a un modulo 100 sans biais mesurable, et restent
 * exacts dans un `number`.
 */
export function bucketOf(flag: FlagName, playerId: string): number {
  const digest = createHash('sha256').update(`${flag}:${playerId}`).digest();
  return digest.readUIntBE(0, 6) % 100;
}

/**
 * Le groupe d'un joueur, sans rien stocker pour le decider.
 *
 * Seau strictement sous la part : elargir la part n'ajoute que des joueurs,
 * elle ne fait jamais changer de groupe un joueur deja expose.
 */
export function groupOf(flag: FlagName, playerId: string, rollout: number): FlagGroup {
  return bucketOf(flag, playerId) < rollout ? 'treatment' : 'control';
}
