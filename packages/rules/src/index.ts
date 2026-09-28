/**
 * @aura/rules — moteur de regles pur et deterministe.
 *
 * Contraintes non negociables (voir CLAUDE.md, regle d'or n°2) :
 * - aucune I/O, aucun `Date.now()`, aucun `Math.random()` ;
 * - le temps et le hasard sont passes en entree (horloge et graine) ;
 * - aucun import de Node, du DOM, de Three.js ou de NestJS.
 *
 * Ces contraintes ne sont pas seulement ecrites : `tsconfig.build.json` compile
 * `src/` sans les types Node, et ESLint bloque les globales interdites.
 */

/** Version du moteur de regles, exposee dans le handshake du protocole. */
export const RULES_VERSION = '1.0.0';

export * from './types.js';
export * from './balance.js';
export * from './counters.js';
export * from './level.js';
export * from './rng.js';
export * from './timing.js';
export * from './recharge.js';
export * from './round.js';
export * from './match.js';
export * from './ai/profiles.js';
export * from './sim/strategies.js';
export * from './sim/simulate.js';
export * from './sim/skill.js';
export * from './variants.js';
