import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * La feuille de style repond-elle a ce que les ecrans lui demandent ?
 *
 * Rien ne relie `className="btn"` a une regle `.btn` (CLAUDE.md, « une classe
 * absente de la feuille de style ne casse rien »). Meme garde que
 * apps/mobile/src/app/styles.test.ts : toute classe ecrite dans le balisage
 * doit avoir un selecteur, et toute cible interactive au moins `--touch`.
 */

const TOUCH = 44;
const src = fileURLToPath(new URL('.', import.meta.url));
const css = readFileSync(join(src, 'styles.css'), 'utf8');

function tsxFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Les noms de classe ecrits dans les ecrans, en clair ou dans une expression. */
function declaredClasses(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const file of tsxFiles(src)) {
    const text = readFileSync(file, 'utf8');
    for (const [, plain, expression] of text.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
      const words =
        plain !== undefined
          ? plain.split(/\s+/)
          : [
              ...(expression ?? '')
                .replaceAll(/[!=]==?\s*['"`][^'"`]*['"`]/g, '')
                // `pill--${verdict}` : on garde le prefixe, les variantes sont verifiees plus bas.
                .replaceAll(/\$\{[^}]*\}/g, '')
                .matchAll(/['"`]([^'"`]*)['"`]/g),
            ].flatMap((match) => (match[1] ?? '').split(/\s+/));
      for (const name of words) {
        if (!/^[a-z][a-z0-9_-]*[a-z0-9]$/.test(name)) continue;
        if (!found.has(name)) found.set(name, file.slice(src.length));
      }
    }
  }
  return found;
}

const hasSelector = (name: string): boolean =>
  new RegExp(`\\.${name.replaceAll('-', '\\-')}(?![\\w-])`).test(css);

describe('styles.css', () => {
  it('trouve bien des classes a verifier (le test n examine pas du vide)', () => {
    expect(declaredClasses().size).toBeGreaterThan(60);
  });

  it('dessine chaque classe que les ecrans utilisent', () => {
    const orphans = [...declaredClasses()]
      .filter(([name]) => !hasSelector(name))
      .map(([n, f]) => `${n} (${f})`);
    expect(orphans).toEqual([]);
  });

  it('dessine chaque variante calculee (pill, dot, verdict)', () => {
    const variants = [
      ...['ok', 'warn', 'down'].flatMap((v) => [`pill--${v}`, `dot--${v}`]),
      ...['met', 'missed', 'insufficient'].map((v) => `verdict--${v}`),
    ];
    expect(variants.filter((name) => !hasSelector(name))).toEqual([]);
  });

  it('ne pose aucune cible interactive sous 44 px', () => {
    expect(Number(/--touch:\s*(\d+)px/.exec(css)?.[1])).toBe(TOUCH);
    const interactives = [
      '.btn',
      '.btn--small',
      '.field__input',
      '.shell__link',
      '.choice',
      '.results__item',
      '.back',
      '.audit__summary',
    ];
    for (const selector of interactives) {
      const block = css.slice(css.indexOf(`${selector} {`));
      expect(block.length, `${selector} : regle introuvable`).toBeLessThan(css.length + 1);
      const declared = /min-height:\s*(var\(--touch\)|\d+px)/.exec(
        block.slice(0, block.indexOf('}')),
      );
      expect(declared, `${selector} : aucune min-height declaree`).not.toBeNull();
      const value = declared?.[1] ?? '';
      const height = value === 'var(--touch)' ? TOUCH : Number.parseInt(value, 10);
      expect(height, selector).toBeGreaterThanOrEqual(TOUCH);
    }
  });

  it('montre le focus au clavier', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px/);
  });
});
