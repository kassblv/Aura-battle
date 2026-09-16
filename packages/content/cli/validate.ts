/**
 * Validateur de contenu — `pnpm --filter @aura/content validate`.
 *
 * Hors de `src/` : il lit des fichiers sur disque, ce que la bibliotheque ne
 * fait jamais. Implementation reelle au jalon M2 (docs/07-content-pipeline.md).
 */
import { CONTENT_VERSION } from '../src/index.js';

console.log(`[content] catalogue ${CONTENT_VERSION} — validateur non implemente (jalon M2).`);
