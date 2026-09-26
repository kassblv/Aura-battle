import { BALANCE, RULE_VARIANTS, variantForWeek, weekIndexOf } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { matchRules, multiplierLabel, weekEvent } from './rules.js';

const WEEK_MS = 7 * 86_400_000;

/** Un instant au milieu d'une semaine qui joue `variant`. */
function aWeekOf(variant: string): number {
  const start = weekIndexOf(Date.UTC(2026, 8, 25));
  for (let week = start; week < start + 20; week += 1) {
    if (variantForWeek(week) === variant)
      return Date.UTC(1970, 0, 5) + week * WEEK_MS + WEEK_MS / 2;
  }
  throw new Error(`aucune semaine ${variant}`);
}

describe('matchRules', () => {
  it('rend les regles normales sans variante, ou pour un identifiant inconnu', () => {
    expect(matchRules(null)).toEqual({ rules: BALANCE, event: null });
    expect(matchRules('normal')).toEqual({ rules: BALANCE, event: null });
    // Un serveur plus recent qu'un client : l'ecran retombe sur la normale.
    expect(matchRules('inconnue').rules).toBe(BALANCE);
  });

  it('relit les valeurs de chaque variante dans @aura/rules', () => {
    expect(matchRules('ultime').rules.ultimate.gaugeMax).toBe(60);
    expect(matchRules('brillance').rules.shiny.multiplier).toBe(1.5);
    expect(matchRules('contres').rules.counter.winnerMultiplier).toBe(1.6);
    expect(matchRules('contres').event).toEqual({
      id: 'contres',
      name: 'Contres tranchants',
      pitch: RULE_VARIANTS.find((v) => v.id === 'contres')?.pitch,
    });
  });

  /*
    La vue est recalculee a chaque image : une config neuve a chaque appel
    relancerait tous les `useMemo` de l'ecran de match soixante fois par seconde.
  */
  it('rend la meme config d un appel a l autre', () => {
    expect(matchRules('ultime').rules).toBe(matchRules('ultime').rules);
  });
});

describe('weekEvent', () => {
  it('annonce l evenement d une semaine a variante', () => {
    expect(weekEvent(aWeekOf('brillance'))?.name).toBe('Semaine brillante');
  });

  it('ne dit rien une semaine normale', () => {
    expect(weekEvent(aWeekOf('normal'))).toBeNull();
  });
});

describe('multiplierLabel', () => {
  it('ecrit un multiplicateur a la francaise', () => {
    expect(multiplierLabel(1.35)).toBe('×1,35');
    expect(multiplierLabel(1.5)).toBe('×1,5');
  });
});
