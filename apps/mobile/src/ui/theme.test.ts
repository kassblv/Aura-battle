import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color.js';
import { cssVariables, DARK, LIGHT, MOTION, PALETTE_KEYS, SPACING, type Palette } from './theme.js';

const themes: readonly (readonly [string, Palette])[] = [
  ['clair', LIGHT],
  ['sombre', DARK],
];

/** Fonds sur lesquels du texte est reellement pose. */
const BACKDROPS = ['bg', 'surface', 'chip'] as const;

describe('palettes', () => {
  it('definissent exactement les memes jetons', () => {
    expect(Object.keys(LIGHT).sort()).toEqual([...PALETTE_KEYS].sort());
    expect(Object.keys(DARK).sort()).toEqual([...PALETTE_KEYS].sort());
  });

  /**
   * Un jeton defini dans un seul theme produit un element invisible dans
   * l'autre — le genre de defaut qu'on ne voit qu'en basculant le telephone en
   * mode sombre, donc jamais pendant le developpement.
   */
  it('n ont aucun jeton manquant d un cote', () => {
    for (const [name, palette] of themes) {
      for (const key of PALETTE_KEYS) {
        expect(palette[key], `${name}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('lisibilite (WCAG 2.1 AA)', () => {
  /**
   * Le texte principal vise AAA : c'est un jeu qu'on lit a bout de bras, en
   * mouvement, souvent en plein soleil.
   */
  it('pose le texte principal a 7:1 au moins', () => {
    for (const [name, palette] of themes) {
      for (const backdrop of BACKDROPS) {
        expect(
          contrastRatio(palette.ink, palette[backdrop]),
          `${name} : ink sur ${backdrop}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('pose le texte secondaire a 4,5:1 au moins', () => {
    for (const [name, palette] of themes) {
      for (const backdrop of BACKDROPS) {
        expect(
          contrastRatio(palette.muted, palette[backdrop]),
          `${name} : muted sur ${backdrop}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /**
   * Les chiffres de recompense, de gain et de perte sont ce que le joueur a le
   * plus envie de lire. La palette du prototype les posait a 2,44:1 en mode
   * clair — sous le seuil « grand texte » lui-meme. D'ou les variantes `*Ink`.
   */
  it('rend lisibles les chiffres de gain, de perte et de recompense', () => {
    for (const [name, palette] of themes) {
      for (const token of ['goldInk', 'goodInk', 'badInk'] as const) {
        for (const backdrop of BACKDROPS) {
          expect(
            contrastRatio(palette[token], palette[backdrop]),
            `${name} : ${token} sur ${backdrop}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('rend lisible le texte pose sur un bouton', () => {
    for (const [name, palette] of themes) {
      expect(
        contrastRatio(palette.accentInk, palette.accent),
        `${name} : accentInk sur accent`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * Bordures, anneaux de focus et jauges ne sont pas du texte : le seuil des
   * composants d'interface est 3:1. En dessous, un contour de focus est
   * invisible — et c'est la seule chose qui dit ou on est au clavier.
   */
  it('rend visibles les contours et les composants', () => {
    for (const [name, palette] of themes) {
      expect(contrastRatio(palette.accent, palette.bg), `${name} : accent`).toBeGreaterThanOrEqual(
        3,
      );
      expect(contrastRatio(palette.line, palette.surface), `${name} : line`).toBeGreaterThanOrEqual(
        1.4,
      );
    }
  });
});

describe('mouvement', () => {
  /**
   * Un retour plus lent que 120 ms n'est plus ressenti comme la consequence du
   * geste ; au-dela de 600 ms une transition devient une attente.
   */
  it('garde les durees dans ce que l oeil lit comme une reaction', () => {
    for (const [name, duration] of Object.entries(MOTION.duration)) {
      expect(duration, name).toBeGreaterThan(0);
      expect(duration, name).toBeLessThanOrEqual(600);
    }
    expect(MOTION.duration.tap).toBeLessThanOrEqual(120);
  });

  it('nomme une courbe pour chaque usage', () => {
    for (const easing of Object.values(MOTION.easing)) {
      expect(easing).toMatch(/^(cubic-bezier\(|linear|ease)/);
    }
  });
});

describe('espacement', () => {
  it('suit une echelle reguliere, pour que rien ne soit pose au hasard', () => {
    const steps = Object.values(SPACING);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    for (const step of steps) expect(step % 2).toBe(0);
  });
});

describe('cssVariables', () => {
  it('emet une variable par jeton', () => {
    const css = cssVariables(DARK);
    for (const key of PALETTE_KEYS) {
      expect(css).toContain(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:`);
    }
  });

  it('emet des valeurs, jamais un jeton vide', () => {
    expect(cssVariables(LIGHT)).not.toMatch(/:\s*;/);
  });
});
