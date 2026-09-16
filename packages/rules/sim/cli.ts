/**
 * Simulateur d'equilibrage — `pnpm sim --matches 10000 --strategy all`.
 *
 * Ce CLI vit hors de `src/` a dessein : il a le droit de parler a Node (lire des
 * arguments, ecrire un rapport JSON), alors que `src/` doit rester pur. Il
 * consomme le moteur comme n'importe quel autre appelant.
 *
 * Implementation reelle au jalon M1 (docs/09-testing.md).
 */
import { RULES_VERSION } from '../src/index.js';

console.log(`[sim] moteur ${RULES_VERSION} — simulateur non implemente (jalon M1).`);
