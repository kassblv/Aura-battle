import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance.js';
import { levelFor, xpForLevel } from './level.js';

const { base, growth, maxLevel } = BALANCE.progression;

describe('xpForLevel', () => {
  it('ne demande rien pour atteindre le premier niveau', () => {
    expect(xpForLevel(1)).toBe(0);
  });

  /*
    Chaque niveau coute plus que le precedent, sinon les derniers tombent aussi
    vite que les premiers et le compteur cesse de vouloir dire quelque chose.
  */
  it('coute de plus en plus cher', () => {
    for (let level = 2; level <= maxLevel; level += 1) {
      const palier = xpForLevel(level) - xpForLevel(level - 1);
      const precedent = level === 2 ? 0 : xpForLevel(level - 1) - xpForLevel(level - 2);
      expect(palier, `niveau ${String(level)}`).toBeGreaterThan(precedent);
    }
  });

  it('croit strictement', () => {
    for (let level = 2; level <= maxLevel; level += 1) {
      expect(xpForLevel(level), `niveau ${String(level)}`).toBeGreaterThan(xpForLevel(level - 1));
    }
  });

  it('rend des entiers : une experience a la virgule ne veut rien dire', () => {
    for (let level = 1; level <= maxLevel; level += 1) {
      expect(Number.isInteger(xpForLevel(level)), `niveau ${String(level)}`).toBe(true);
    }
  });
});

describe('levelFor', () => {
  it('commence au niveau un, sans rien', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, needed: base, total: 0 });
  });

  it('monte pile au seuil, jamais avant', () => {
    const seuil = xpForLevel(2);
    expect(levelFor(seuil - 1).level).toBe(1);
    expect(levelFor(seuil).level).toBe(2);
  });

  /*
    `into` et `needed` decrivent la BARRE : ce qui est acquis dans le niveau
    courant, et ce qu il faut pour le finir. Les recalculer a l affichage
    donnerait deux endroits ou se tromper d un palier.
  */
  it('decrit la barre du niveau courant', () => {
    const seuil = xpForLevel(3);
    const state = levelFor(seuil + 5);
    expect(state.level).toBe(3);
    expect(state.into).toBe(5);
    expect(state.needed).toBe(xpForLevel(4) - seuil);
  });

  it('ne recule jamais quand l experience monte', () => {
    let last = 0;
    for (let xp = 0; xp < xpForLevel(maxLevel) + 5_000; xp += 37) {
      const { level } = levelFor(xp);
      expect(level, `xp ${String(xp)}`).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  /*
    Au plafond, la barre est pleine et le reste ne se perd pas : il s accumule.
    Afficher une barre a moitie vide apres le dernier niveau ferait croire a un
    niveau suivant qui n existe pas.
  */
  it('s arrete au dernier niveau, barre pleine', () => {
    const state = levelFor(xpForLevel(maxLevel) + 10_000);
    expect(state.level).toBe(maxLevel);
    expect(state.into).toBe(state.needed);
  });

  it('ignore une experience absurde', () => {
    for (const xp of [-50, Number.NaN]) {
      expect(levelFor(xp).level).toBe(1);
      expect(levelFor(xp).into).toBe(0);
    }
  });

  /*
    Le rythme est une decision d equilibrage, et elle se verifie : une victoire
    vaut 30, une defaite 12. Le premier niveau doit tomber dans la premiere
    session, et le dernier ne pas etre atteignable en une semaine.
  */
  it('tient le rythme annonce dans docs/01', () => {
    const parMatch = 20; // moyenne entre une victoire (30) et une defaite (12)
    expect(xpForLevel(2) / parMatch).toBeLessThanOrEqual(5);
    expect(xpForLevel(maxLevel) / parMatch).toBeGreaterThan(500);
  });

  it('nomme la croissance dans balance.ts', () => {
    // Regle du depot : toute valeur d equilibrage vit dans `balance.ts`.
    expect(base).toBeGreaterThan(0);
    expect(growth).toBeGreaterThan(1);
    expect(maxLevel).toBeGreaterThan(1);
  });
});
