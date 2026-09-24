import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance.js';
import { beats } from '../counters.js';
import { evaluateRecharge, generateOrbSequence } from '../recharge.js';
import { createRng } from '../rng.js';
import { choiceCost } from '../round.js';
import { evaluateTiming, generateGaugeParams } from '../timing.js';
import type { Style } from '../types.js';
import {
  affordableChoice,
  AI_PROFILES,
  AI_PROFILE_IDS,
  decideChoice,
  decideRechargeTaps,
  decideTimingTap,
  tapAtMsForDelta,
  type AiProfileId,
} from './profiles.js';

const gauge = generateGaugeParams(createRng('jauge'));
const orbs = generateOrbSequence(createRng('orbes'));

const baseContext = {
  energy: BALANCE.match.startingEnergy,
  ultimateGauge: 0,
  previousMoves: [],
  opponentStyles: [],
  round: 1,
};

describe('AI_PROFILES — les quatre adversaires du prototype', () => {
  it('expose exactement les quatre profils', () => {
    expect(AI_PROFILE_IDS).toEqual(['rookie', 'mystery', 'calm', 'untouchable']);
  });

  it('donne un nom francais a chacun', () => {
    for (const id of AI_PROFILE_IDS) {
      expect(AI_PROFILES[id].name.length).toBeGreaterThan(0);
    }
  });

  it('range les probabilites de timing dans [0, 1]', () => {
    for (const id of AI_PROFILE_IDS) {
      const { skill } = AI_PROFILES[id];
      expect(skill.perfect).toBeGreaterThanOrEqual(0);
      expect(skill.perfect + skill.good).toBeLessThanOrEqual(1);
    }
  });

  it('ordonne les profils du plus faible au plus fort', () => {
    const adresse = AI_PROFILE_IDS.map((id) => AI_PROFILES[id].skill.perfect);
    for (let i = 1; i < adresse.length; i += 1) {
      expect(adresse[i]!).toBeGreaterThan(adresse[i - 1]!);
    }
  });

  it('ne laisse pas le debutant se servir de l Ultime', () => {
    expect(AI_PROFILES.rookie.usesUltimate).toBe(false);
    expect(AI_PROFILES.untouchable.usesUltimate).toBe(true);
  });
});

describe('decideTimingTap', () => {
  it('tape toujours dans la fenetre de charge', () => {
    // L'IA tape toujours : elle n'a aucune raison de laisser passer la jauge.
    const rng = createRng('timing');
    for (let i = 0; i < 200; i += 1) {
      const tap = decideTimingTap(AI_PROFILES.calm, gauge, rng);
      expect(tap).toBeGreaterThanOrEqual(0);
      expect(tap).toBeLessThanOrEqual(BALANCE.timing.maxChargeMs);
    }
  });

  it('atteint la qualite visee a la frequence annoncee', () => {
    const rng = createRng('frequence');
    const profile = AI_PROFILES.untouchable;
    let parfaits = 0;
    const tirages = 4_000;
    for (let i = 0; i < tirages; i += 1) {
      const tap = decideTimingTap(profile, gauge, rng);
      if (evaluateTiming(tap, gauge).quality === 'perfect') parfaits += 1;
    }
    expect(parfaits / tirages).toBeCloseTo(profile.skill.perfect, 1);
  });

  it('rate beaucoup plus souvent avec le debutant qu avec l intouchable', () => {
    const rate = (id: AiProfileId): number => {
      const rng = createRng('comparaison');
      let rates = 0;
      for (let i = 0; i < 1_000; i += 1) {
        if (
          evaluateTiming(decideTimingTap(AI_PROFILES[id], gauge, rng), gauge).quality === 'miss'
        ) {
          rates += 1;
        }
      }
      return rates;
    };
    expect(rate('rookie')).toBeGreaterThan(rate('untouchable'));
  });

  it('decide la meme chose pour une meme graine', () => {
    expect(decideTimingTap(AI_PROFILES.calm, gauge, createRng('g'))).toBe(
      decideTimingTap(AI_PROFILES.calm, gauge, createRng('g')),
    );
  });

  it('vise en deca du centre quand viser au-dela sortirait de la jauge', () => {
    // Centre a 0,98 : ajouter l ecart depasserait 1, donc il faut le retrancher.
    const bord = { ...gauge, center: 0.98 };
    const rng = createRng('bord');
    for (let i = 0; i < 100; i += 1) {
      const tap = decideTimingTap(AI_PROFILES.rookie, bord, rng);
      expect(tap).toBeGreaterThanOrEqual(0);
      expect(tap).toBeLessThanOrEqual(BALANCE.timing.maxChargeMs);
    }
  });
});

describe('decideRechargeTaps', () => {
  it('tape un nombre de fois compris dans la fourchette du profil', () => {
    for (const id of AI_PROFILE_IDS) {
      const rng = createRng(`taps-${id}`);
      const [min, max] = AI_PROFILES[id].rechargeTaps;
      for (let i = 0; i < 30; i += 1) {
        const taps = decideRechargeTaps(AI_PROFILES[id], orbs, rng);
        expect(taps.length).toBeGreaterThanOrEqual(min);
        expect(taps.length).toBeLessThanOrEqual(max);
      }
    }
  });

  it('ne produit que des taps valides, jamais rejetes', () => {
    for (const id of AI_PROFILE_IDS) {
      const taps = decideRechargeTaps(AI_PROFILES[id], orbs, createRng(`valide-${id}`));
      expect(evaluateRecharge(taps, orbs).rejectedTaps).toBe(0);
    }
  });

  it('ne tape jamais dans le vide', () => {
    const taps = decideRechargeTaps(AI_PROFILES.calm, orbs, createRng('vide'));
    expect(evaluateRecharge(taps, orbs).emptyTaps).toBe(0);
  });

  it('fait marquer plus de points aux profils forts', () => {
    const points = (id: AiProfileId): number =>
      evaluateRecharge(decideRechargeTaps(AI_PROFILES[id], orbs, createRng('points')), orbs).points;
    expect(points('untouchable')).toBeGreaterThan(points('rookie'));
  });
});

describe('decideChoice — energie (§3)', () => {
  it('ne depense jamais plus que l energie disponible', () => {
    for (const id of AI_PROFILE_IDS) {
      const rng = createRng(`energie-${id}`);
      for (let energy = 0; energy <= BALANCE.match.startingEnergy; energy += 1) {
        const choice = decideChoice({ ...baseContext, profile: AI_PROFILES[id], rng, energy });
        expect(choiceCost(choice)).toBeLessThanOrEqual(energy);
      }
    }
  });

  it('joue le mouvement gratuit quand il n a plus rien', () => {
    const choice = decideChoice({
      ...baseContext,
      profile: AI_PROFILES.calm,
      rng: createRng('sec'),
      energy: 0,
    });
    expect(choice.move.tier).toBe(0);
    expect(choice.amplifier).toBe(0);
  });
});

describe('decideChoice — Ultime (§6)', () => {
  it('ne declenche jamais l Ultime avec une jauge incomplete', () => {
    for (const id of AI_PROFILE_IDS) {
      const rng = createRng(`ult-${id}`);
      for (let i = 0; i < 50; i += 1) {
        const choice = decideChoice({
          ...baseContext,
          profile: AI_PROFILES[id],
          rng,
          ultimateGauge: BALANCE.ultimate.gaugeMax - 1,
        });
        expect(choice.useUltimate).toBe(false);
      }
    }
  });

  it('declenche l Ultime a jauge pleine, sauf le debutant', () => {
    const avecJaugePleine = (id: AiProfileId): boolean =>
      decideChoice({
        ...baseContext,
        profile: AI_PROFILES[id],
        rng: createRng('plein'),
        ultimateGauge: BALANCE.ultimate.gaugeMax,
      }).useUltimate;
    expect(avecJaugePleine('untouchable')).toBe(true);
    expect(avecJaugePleine('rookie')).toBe(false);
  });
});

describe('decideChoice — lecture de l adversaire (§2)', () => {
  const contreLeDernierStyle = (id: AiProfileId, opponentStyle: Style): number => {
    const rng = createRng(`lecture-${id}`);
    let contres = 0;
    for (let i = 0; i < 500; i += 1) {
      const choice = decideChoice({
        ...baseContext,
        profile: AI_PROFILES[id],
        rng,
        opponentStyles: [opponentStyle],
      });
      if (beats(choice.move.style, opponentStyle)) contres += 1;
    }
    return contres;
  };

  it('fait contrer l intouchable bien plus souvent que le debutant', () => {
    expect(contreLeDernierStyle('untouchable', 'hype')).toBeGreaterThan(
      contreLeDernierStyle('rookie', 'hype'),
    );
  });

  it('ne fait jamais lire le debutant, qui joue au hasard', () => {
    // read = 0 : il ne contre que par accident, deux fois sur cinq dans la roue.
    const contres = contreLeDernierStyle('rookie', 'hype');
    expect(contres).toBeLessThan(250);
  });

  it('joue au hasard a la premiere manche, faute d historique', () => {
    const styles = new Set<Style>();
    const rng = createRng('premiere');
    for (let i = 0; i < 200; i += 1) {
      styles.add(
        decideChoice({ ...baseContext, profile: AI_PROFILES.untouchable, rng }).move.style,
      );
    }
    expect(styles.size).toBe(BALANCE.styles.length);
  });
});

describe('decideChoice — repetition (§7)', () => {
  it('evite de rejouer un mouvement deja joue quand il a le choix', () => {
    const rng = createRng('repetition');
    const previousMoves = [{ style: 'calme' as const, tier: 2 as const }];
    let repetitions = 0;
    for (let i = 0; i < 300; i += 1) {
      const choice = decideChoice({
        ...baseContext,
        profile: AI_PROFILES.calm,
        rng,
        previousMoves,
      });
      if (choice.move.style === 'calme' && choice.move.tier === 2) repetitions += 1;
    }
    expect(repetitions).toBe(0);
  });

  it('accepte de se repeter quand toutes les options sont deja jouees', () => {
    const previousMoves = (['calme', 'hype', 'provoc'] as const).flatMap((style) =>
      ([0, 1, 2, 3, 4] as const).map((tier) => ({ style, tier })),
    );
    const choice = decideChoice({
      ...baseContext,
      profile: AI_PROFILES.calm,
      rng: createRng('coince'),
      previousMoves,
    });
    expect(choice.move.tier).toBeGreaterThanOrEqual(0);
  });
});

describe('decideChoice — determinisme', () => {
  it('decide la meme chose pour une meme graine', () => {
    const decision = (): unknown =>
      decideChoice({ ...baseContext, profile: AI_PROFILES.mystery, rng: createRng('meme') });
    expect(decision()).toEqual(decision());
  });
});

describe('tapAtMsForDelta — reproduire un ecart sur une autre jauge', () => {
  it('rend un instant qui produit exactement l ecart demande', () => {
    for (const graine of ['a', 'b', 'c', 'd', 'e']) {
      const params = generateGaugeParams(createRng(graine));
      for (const cible of [0, 0.02, 0.05, 0.11, 0.3]) {
        const tapAtMs = tapAtMsForDelta(cible, params);
        expect(evaluateTiming(tapAtMs, params).delta).toBeCloseTo(cible, 9);
      }
    }
  });

  it('rabat un ecart que la jauge ne peut pas produire', () => {
    // Centre a 0,5 : le curseur ne s'en ecarte jamais de plus de 0,5.
    const params = { periodMs: 1_600, center: 0.5, zoneWidth: 0.22, perfectWidth: 0.08 };
    expect(evaluateTiming(tapAtMsForDelta(0.9, params), params).delta).toBeCloseTo(0.5, 9);
  });

  it('ne rend jamais un instant au-dela de la charge maximale', () => {
    const params = { periodMs: 1_900, center: 0.7, zoneWidth: 0.22, perfectWidth: 0.08 };
    expect(tapAtMsForDelta(0.3, params)).toBeLessThanOrEqual(BALANCE.timing.maxChargeMs);
  });

  it('retrouve la qualite enregistree sur une jauge differente', () => {
    const enregistree = generateGaugeParams(createRng('jauge-enregistree'));
    const rejouee = generateGaugeParams(createRng('jauge-rejouee'));
    const tapOrigine = 640;
    const origine = evaluateTiming(tapOrigine, enregistree);

    const rejeu = evaluateTiming(tapAtMsForDelta(origine.delta, rejouee), rejouee);
    expect(rejeu.quality).toBe(origine.quality);
    expect(rejeu.delta).toBeCloseTo(origine.delta, 9);
  });
});

describe('affordableChoice — rabattre un choix impayable', () => {
  const contexte = { energy: 14, ultimateGauge: 0, previousMoves: [] };

  it('rend le choix tel quel quand l energie le couvre', () => {
    const voulu = { move: { style: 'hype', tier: 3 }, amplifier: 2, useUltimate: false } as const;
    expect(affordableChoice(voulu, contexte)).toEqual(voulu);
  });

  it('garde le style et rabat le palier quand l energie manque', () => {
    const voulu = { move: { style: 'provoc', tier: 4 }, amplifier: 4, useUltimate: false } as const;
    const rabattu = affordableChoice(voulu, { ...contexte, energy: 2 });
    expect(rabattu.move.style).toBe('provoc');
    expect(choiceCost(rabattu)).toBeLessThanOrEqual(2);
  });

  it('ne rend jamais un choix que le moteur refuserait', () => {
    const styles: readonly Style[] = BALANCE.styles;
    for (const style of styles) {
      for (const tier of [0, 1, 2, 3, 4] as const) {
        for (const amplifier of [0, 1, 2, 3, 4] as const) {
          for (const energy of [0, 1, 2, 3, 5, 8, 14]) {
            const rabattu = affordableChoice(
              { move: { style, tier }, amplifier, useUltimate: false },
              { ...contexte, energy },
            );
            expect(choiceCost(rabattu)).toBeLessThanOrEqual(energy);
          }
        }
      }
    }
  });

  it('abandonne l Ultime quand la jauge n est pas pleine', () => {
    const voulu = { move: { style: 'calme', tier: 1 }, amplifier: 0, useUltimate: true } as const;
    expect(affordableChoice(voulu, { ...contexte, ultimateGauge: 99 }).useUltimate).toBe(false);
    expect(
      affordableChoice(voulu, { ...contexte, ultimateGauge: BALANCE.ultimate.gaugeMax })
        .useUltimate,
    ).toBe(true);
  });

  it('evite de rejouer un mouvement deja joue', () => {
    const voulu = { move: { style: 'calme', tier: 2 }, amplifier: 0, useUltimate: false } as const;
    const rabattu = affordableChoice(voulu, {
      ...contexte,
      previousMoves: [{ style: 'calme', tier: 2 }],
    });
    expect(rabattu.move).not.toEqual({ style: 'calme', tier: 2 });
  });
});
