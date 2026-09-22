import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOUCH } from '../ui/layout.js';

/**
 * La feuille de style repond-elle a ce que les ecrans lui demandent ?
 *
 * Rien dans TypeScript ne relie `className="mini"` a une regle `.mini`. Quand
 * la regle manque, le bouton ne disparait pas — il s'affiche avec le style par
 * defaut du navigateur, en Arial 13 px et bordure `outset`. C'est ce qui est
 * arrive au bouton « Fermer » de SIX panneaux : gris, 59x21, moitie moins haut
 * que la cible tactile que l'ADR 0008 impose, et personne ne l'a vu parce
 * qu'un bouton laid reste un bouton qui marche.
 */

const src = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(src, 'styles.css'), 'utf8');

function tsxFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Les noms de classe ecrits en clair dans les ecrans. */
function declaredClasses(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const file of tsxFiles(src)) {
    const text = readFileSync(file, 'utf8');
    for (const [, plain, expression] of text.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
      /*
        Deux formes, et il a fallu se tromper une fois pour le voir : un
        `className="mini"` est deja la chaine, un `className={...}` est une
        expression dont il faut extraire les litteraux. Ne traiter que la
        seconde rendait le test VERT en n'examinant rien — exactement le
        defaut qu'il est cense attraper.
      */
      const words =
        plain !== undefined
          ? plain.split(/\s+/)
          : [
              // Une comparaison n'est pas une classe : `winner === 'moi'` vit
              // dans la meme accolade que les deux branches du ternaire, et
              // « moi » se serait fait passer pour un nom de classe absent.
              ...(expression ?? '')
                .replaceAll(/[!=]==?\s*['"`][^'"`]*['"`]/g, '')
                .matchAll(/['"`]([^'"`]*)['"`]/g),
            ].flatMap((match) => (match[1] ?? '').split(/\s+/));
      for (const name of words) {
        /*
          Les classes du depot sont en minuscules, facon BEM. Ce filtre ecarte
          ce qu'un gabarit interpole laisse trainer — `${trimmed.length}`, la
          constante voisine, un tiret isole. Une liste bruyante finit lue en
          diagonale, c'est-a-dire pas lue, et le defaut qu'elle contenait
          passe avec le bruit.
        */
        if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
        if (!found.has(name)) found.set(name, file.slice(src.length));
      }
    }
  }
  return found;
}

describe('styles.css', () => {
  it('dessine chaque classe que les ecrans utilisent', () => {
    const orphelines: string[] = [];
    for (const [name, file] of declaredClasses()) {
      // Une classe peut etre stylee seule ou comme descendante : on cherche le
      // nom comme SELECTEUR, c'est-a-dire precede d'un point et suivi d'autre
      // chose qu'un caractere de nom de classe.
      if (!new RegExp(`\\.${name.replaceAll('-', '\\-')}(?![\\w-])`).test(css)) {
        orphelines.push(`${name} (${file})`);
      }
    }
    expect(orphelines).toEqual([]);
  });

  /*
    L'ADR 0008 pose 46 px. Une regle qui nomme explicitement une hauteur plus
    petite sur un element qu'on touche est une decision, et celles-la se
    relisent : `.ward__item` etait a 40, c'est-a-dire six pixels sous le seuil
    que le meme depot impose partout ailleurs.
  */
  it('ne pose aucune cible tactile sous le seuil de l ADR 0008', () => {
    // `--touch` vaut le seuil : l'ecrire ainsi est la forme PREFEREE, donc le
    // test doit la resoudre plutot que d'obliger a poser le nombre en dur.
    const touchVariable = /--touch:\s*(\d+)px/.exec(css);
    expect(Number(touchVariable?.[1]), '--touch dans :root').toBe(TOUCH);

    const interactives = ['.mini', '.ward__item', '.shop__item', '.rail__btn', '.launch__alt'];
    for (const selector of interactives) {
      const block = css.slice(css.indexOf(`${selector} {`));
      const declared = /min-height:\s*(var\(--touch\)|\d+px)/.exec(
        block.slice(0, block.indexOf('}')),
      );
      expect(declared, `${selector} : aucune min-height declaree`).not.toBeNull();
      const value = declared?.[1] ?? '';
      const height = value === 'var(--touch)' ? TOUCH : Number.parseInt(value, 10);
      expect(height, selector).toBeGreaterThanOrEqual(TOUCH);
    }
  });
});
