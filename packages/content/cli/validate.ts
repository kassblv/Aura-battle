import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allAnimationIds } from '../src/catalogue.js';
import { createAnimationValidator, type ValidationIssue } from '../src/validate.js';

/**
 * Validateur de contenu — `pnpm --filter @aura/content validate`.
 *
 * Hors de `src/` : il lit des fichiers, ce que la bibliotheque ne fait jamais.
 * Sort en erreur des qu'une animation porte une **erreur** ; les
 * avertissements sont affiches sans bloquer (voir docs/07, section validation).
 */

const root = new URL('../', import.meta.url);
const animationsRoot = fileURLToPath(new URL('animations/', root));
const schema: object = JSON.parse(
  readFileSync(fileURLToPath(new URL('schema/animation.schema.json', root)), 'utf8'),
) as object;

const validate = createAnimationValidator(schema);

function listAnimationFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return listAnimationFiles(full);
    return entry.endsWith('.json') ? [full] : [];
  });
}

const show = (issues: readonly ValidationIssue[]): void => {
  for (const issue of issues) {
    console.log(
      `    ${issue.severity === 'error' ? 'erreur' : 'avertis.'} ${issue.path} — ${issue.message}`,
    );
  }
};

const files = listAnimationFiles(animationsRoot).sort();
const catalogue = new Set(allAnimationIds());
const seen = new Set<string>();

let errorCount = 0;
let warningCount = 0;

console.log(`\n  Validation de ${files.length} animations\n`);

for (const file of files) {
  const relative = file.slice(animationsRoot.length);
  let animation: unknown;
  try {
    animation = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    errorCount += 1;
    console.log(`  ${relative} : JSON illisible — ${String(cause)}`);
    continue;
  }

  const result = validate(animation);
  const id = (animation as { id?: unknown }).id;
  if (typeof id === 'string') {
    seen.add(id);
    if (!catalogue.has(id)) {
      errorCount += 1;
      console.log(`  ${relative}`);
      console.log(`    erreur   id — « ${id} » ne figure pas au catalogue (src/catalogue.ts)`);
    }
  }

  errorCount += result.errors.length;
  warningCount += result.warnings.length;
  if (result.issues.length > 0) {
    console.log(`  ${relative}`);
    show(result.issues);
  }
}

// Une animation annoncee au catalogue mais absente du disque casserait le jeu
// au moment ou un joueur l'equipe : on la traite comme une erreur.
for (const id of catalogue) {
  if (!seen.has(id)) {
    errorCount += 1;
    console.log(`  catalogue : « ${id} » est annonce mais aucun fichier ne le fournit`);
  }
}

console.log(
  `\n  ${files.length} animations, ${errorCount} erreur(s), ${warningCount} avertissement(s).\n`,
);

if (errorCount > 0) {
  process.exit(1);
}
