import { AMPLIFIER_LEVELS, TIERS } from '@aura/content';
import { BALANCE } from '@aura/rules';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { betFor, levelFill } from './bet.js';
import { contrastRatio, mix, parseHex } from './color.js';
import { DARK } from './theme.js';

const FULL = BALANCE.maxRoundCost;

describe('betFor', () => {
  /**
   * La puissance misee est la tete de la formule de `round.ts`. Timing, contre
   * et Ultime viennent apres et dependent du choix d'en face : on ne les
   * affiche pas, on ne les devine pas.
   */
  it('reprend la tete de la formule du moteur', () => {
    for (const tier of TIERS) {
      for (const level of AMPLIFIER_LEVELS) {
        expect(betFor(tier, level, FULL).power).toBe(
          Math.round(BALANCE.tierPower[tier] * BALANCE.amplifierMultiplier[level]),
        );
      }
    }
  });

  it('monte avec chacun des deux crans', () => {
    const powers = TIERS.map((tier) => betFor(tier, 0, FULL).power);
    expect(powers).toEqual([...powers].sort((a, b) => a - b));
    const amplified = AMPLIFIER_LEVELS.map((level) => betFor(0, level, FULL).power);
    expect(amplified).toEqual([...amplified].sort((a, b) => a - b));
  });

  it('additionne les deux couts sur la meme reserve', () => {
    expect(betFor(3, 2, FULL).cost).toBe(5);
    expect(betFor(0, 0, FULL).cost).toBe(0);
    expect(betFor(4, 4, FULL).cost).toBe(8);
  });
});

/**
 * La lecture que le joueur devait faire de tete.
 *
 * Le cout total et la reserve restante se deduisaient d'une soustraction entre
 * deux rangees de pastilles. Ces huit points la portent en une image : ce que
 * prend le palier, ce que prend l'amplificateur, ce qui reste, et ce que la
 * reserve ne couvre pas.
 */
describe('les points d energie', () => {
  it('en comptent toujours autant que le plafond de manche', () => {
    for (const tier of TIERS) {
      for (const level of AMPLIFIER_LEVELS) {
        expect(betFor(tier, level, FULL).pips).toHaveLength(FULL);
      }
    }
  });

  it('servent le palier en premier, l amplificateur ensuite', () => {
    expect(betFor(2, 1, FULL).pips).toEqual([
      'tier',
      'tier',
      'amplifier',
      'free',
      'free',
      'free',
      'free',
      'free',
    ]);
  });

  /**
   * `locked` n'est pas `free` : c'est de l'energie que le joueur n'a pas. La
   * distinction est tout l'interet de la jauge.
   */
  it('barrent ce que la reserve ne couvre pas', () => {
    const bet = betFor(1, 1, 3);
    expect(bet.pips).toEqual([
      'tier',
      'amplifier',
      'free',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
    ]);
    expect(bet.affordable).toBe(true);
  });

  it('declarent inabordable ce qui depasse la reserve', () => {
    expect(betFor(3, 3, 4).affordable).toBe(false);
    expect(betFor(2, 2, 4).affordable).toBe(true);
  });

  it('ne perdent jamais un point en route', () => {
    for (const cap of [0, 1, 4, 8]) {
      for (const tier of TIERS) {
        for (const level of AMPLIFIER_LEVELS) {
          const { pips, cost } = betFor(tier, level, cap);
          expect(pips.filter((pip) => pip === 'tier')).toHaveLength(tier);
          expect(pips.filter((pip) => pip === 'amplifier')).toHaveLength(level);
          expect(pips.filter((pip) => pip === 'free' || pip === 'locked')).toHaveLength(
            FULL - cost,
          );
        }
      }
    }
  });
});

describe('levelFill', () => {
  it('dessine une echelle du premier au dernier cran', () => {
    expect(levelFill(0, 5)).toBe(0);
    expect(levelFill(4, 5)).toBe(1);
    expect(levelFill(2, 5)).toBe(0.5);
  });

  it('reste borne, meme sur une echelle degeneree', () => {
    expect(levelFill(0, 1)).toBe(1);
    expect(levelFill(-3, 5)).toBe(0);
    expect(levelFill(99, 5)).toBe(1);
  });
});

/**
 * Lisibilite de la grappe de mise.
 *
 * Le cran de l'echelle eclaircit le fond du bouton : c'est un decor, mais il
 * passe sous du texte. Les valeurs testees sont celles de `styles.css`, et le
 * dernier cas verifie qu'elles n'ont pas divergé.
 */
describe('contraste de la mise', () => {
  const PANEL = DARK.surface;
  const CHIP = DARK.chip;
  const RUNG_OPACITY = 0.26;
  const RUNGS = [
    ['palier', mix(DARK.accent, DARK.chip, RUNG_OPACITY)],
    ['amplificateur', mix(DARK.goldInk, DARK.chip, RUNG_OPACITY)],
  ] as const;

  it('garde nom, chiffre et cout lisibles par-dessus la rampe', () => {
    for (const [name, rung] of RUNGS) {
      expect(contrastRatio(DARK.ink, rung), `ink sur la rampe ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * Un cout hors budget est rouge, et le rouge ne tient pas sur la rampe doree
   * (2,95:1). D'ou la regle : pas de rampe sur un cran inabordable — il n'est
   * de toute facon pas un cran qu'on peut gravir.
   */
  it('rend le cout hors budget lisible sur un bouton sans rampe', () => {
    expect(contrastRatio(DARK.badInk, CHIP)).toBeGreaterThanOrEqual(4.5);
  });

  it('pose l en-tete de mise sur un panneau opaque', () => {
    expect(contrastRatio(DARK.goldInk, PANEL), 'puissance misee').toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DARK.muted, PANEL), 'noms choisis').toBeGreaterThanOrEqual(4.5);
  });

  /**
   * Un point rempli doit se detacher du vide : c'est la que se lit le cout.
   *
   * Entre les deux couleurs remplies, en revanche, le rapport n'est que de
   * 2,2:1 — elles se distinguent par la teinte, pas par la luminance. Une
   * information portee par la seule couleur ne vaut rien pour qui la percoit
   * mal : la feuille de style la redit donc par la hauteur du point.
   */
  it('detache chaque point rempli du point vide', () => {
    const empty = DARK.chipDeep;
    expect(contrastRatio(DARK.accent, empty), 'palier').toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK.goldInk, empty), 'amplificateur').toBeGreaterThanOrEqual(3);
  });

  it('ne fait pas reposer palier et amplificateur sur la seule couleur', () => {
    const dominant = (hex: string): string => {
      const [r, g, b] = parseHex(hex);
      return r >= g && r >= b ? 'r' : g >= b ? 'g' : 'b';
    };
    expect(dominant(DARK.accent)).not.toBe(dominant(DARK.goldInk));

    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    const pip = css.slice(css.indexOf('.bet__pip--amplifier'), css.indexOf('.bet__pip--locked'));
    expect(pip).toContain('height:');
  });

  it('teste bien les valeurs que la feuille de style peint', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toContain(`opacity: ${String(RUNG_OPACITY)};`);
    expect(css).toContain('.pick__rung--tier');
    expect(css).toContain('.pick__rung--amplifier');
    // Pas de rampe sous un cran choisi ni sous un cran hors budget.
    expect(css).toContain(
      ".pick[aria-pressed='true'] .pick__rung,\n.pick[data-afford='false'] .pick__rung {\n  opacity: 0;\n}",
    );
    // Les grappes sont des panneaux : leur texte ne tombe pas sur la foule 3D.
    const cluster = css.slice(css.indexOf('.cluster {'), css.indexOf('.cluster__label'));
    expect(cluster).toContain('background: var(--surface)');
  });
});
