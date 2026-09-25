import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance.js';
import { RULE_VARIANTS, variantConfig, variantForWeek, weekIndexOf } from './variants.js';

describe('variantes de regles', () => {
  it('rendent la config normale pour « normal » et pour un identifiant inconnu', () => {
    expect(variantConfig('normal')).toBe(BALANCE);
    expect(variantConfig('inconnu')).toBe(BALANCE);
  });

  it('ne changent que ce qu elles annoncent', () => {
    const ultimate = variantConfig('ultime');
    expect(ultimate.ultimate.gaugeMax).toBe(60);
    expect(ultimate.ultimate.gainOnPerfect).toBe(BALANCE.ultimate.gainOnPerfect);
    expect(ultimate.shiny).toEqual(BALANCE.shiny);
    expect(variantConfig('brillance').shiny.multiplier).toBe(1.5);
    expect(variantConfig('contres').counter.winnerMultiplier).toBe(1.6);
    expect(variantConfig('contres').counter.loserMultiplier).toBe(BALANCE.counter.loserMultiplier);
  });

  /*
    Mesure (simulateur, 6 000 matchs par variante) : plus d'energie au depart
    faisait passer la strategie « toujours le plus gros » de 75 % a 81-84 % —
    choisir ne comptait plus. Aucune variante ne touche a l'energie.
  */
  it('ne touchent jamais a l energie de depart', () => {
    for (const variant of RULE_VARIANTS) {
      expect(variantConfig(variant.id).match.startingEnergy).toBe(BALANCE.match.startingEnergy);
    }
  });

  it('ont chacune un nom et une phrase pour l ecran', () => {
    for (const variant of RULE_VARIANTS) {
      expect(variant.name.length).toBeGreaterThan(0);
      expect(variant.pitch.length).toBeGreaterThan(0);
    }
  });
});

describe('rotation hebdomadaire', () => {
  it('compte les semaines UTC a partir du lundi', () => {
    const monday = Date.UTC(2026, 8, 28);
    const sunday = Date.UTC(2026, 9, 4, 23, 59);
    expect(weekIndexOf(monday)).toBe(weekIndexOf(sunday));
    expect(weekIndexOf(Date.UTC(2026, 9, 5))).toBe(weekIndexOf(monday) + 1);
  });

  // Un evenement reste un evenement : une semaine sur deux est normale.
  it('alterne semaines normales et semaines d evenement, et passe par chaque variante', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => variantForWeek(1000 + i));
    for (let i = 1; i < weeks.length; i += 1) {
      expect(weeks[i] === 'normal' || weeks[i - 1] === 'normal').toBe(true);
    }
    for (const variant of RULE_VARIANTS) expect(weeks).toContain(variant.id);
  });
});
