import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance.js';
import { measureSkill, SKILL_MEASURE_IDS } from './skill.js';

/**
 * Ces tests ne fixent pas les chiffres : ils appartiennent a l'equilibrage et
 * bougeront. Ils fixent ce qui doit rester vrai quelles que soient les valeurs
 * de `balance.ts` — la mesure se reproduit, et chaque sonde mesure bien ce
 * qu'elle pretend mesurer.
 */
describe('measureSkill', () => {
  const options = { matches: 400, seed: 'test' };

  /**
   * Ces mesures jouent 400 matchs, parfois deux fois dans un meme test.
   *
   * Seules, elles tiennent en quelques centaines de millisecondes. Mais elles
   * tournent en parallele des autres paquets, et le jour ou le banc de charge
   * occupe la machine, la suite entiere a mis dix fois plus longtemps : le
   * delai par defaut de 5 s a expire ici, et le journal a annonce que le
   * determinisme etait casse. Il ne l'etait pas.
   *
   * Un delai genereux plutot qu'un echantillon reduit : c'est la taille de
   * l'echantillon qui donne son sens a la mesure, pas sa vitesse.
   */
  const LENT = { timeout: 30_000 };

  it('rend une mesure par question posee', LENT, () => {
    const report = measureSkill(options);
    expect(report.measures.map((m) => m.id)).toEqual([...SKILL_MEASURE_IDS]);
    expect(report.matches).toBe(400);
  });

  it('se reproduit a l identique a graine egale', LENT, () => {
    const rates = () => measureSkill(options).measures.map((m) => m.winRate);
    expect(rates()).toEqual(rates());
  });

  it('change de resultat quand la graine change', LENT, () => {
    const one = measureSkill(options).measures.map((m) => m.winRate);
    const two = measureSkill({ ...options, seed: 'autre' }).measures.map((m) => m.winRate);
    expect(one).not.toEqual(two);
  });

  it('rend des taux de victoire, donc bornes a 0 et 1', LENT, () => {
    for (const measure of measureSkill(options).measures) {
      expect(measure.winRate).toBeGreaterThanOrEqual(0);
      expect(measure.winRate).toBeLessThanOrEqual(1);
    }
  });

  /**
   * Le sens de chaque sonde. Si l'une de ces lignes passe sous 50 %, ce n'est
   * pas la mesure qui est cassee : c'est que mieux jouer, ou depenser plus, a
   * cesse d'etre un avantage.
   */
  it('donne l avantage au meilleur timeur', LENT, () => {
    const timing = measureSkill(options).measures.find((m) => m.id === 'timing');
    expect(timing?.winRate).toBeGreaterThan(0.5);
  });

  it('donne l avantage a qui lit un adversaire previsible', LENT, () => {
    const lecture = measureSkill(options).measures.find((m) => m.id === 'lecture');
    expect(lecture?.winRate).toBeGreaterThan(0.5);
  });

  it('donne l avantage au plus gros budget, a talent egal', LENT, () => {
    const budget = measureSkill(options).measures.find((m) => m.id === 'budget');
    expect(budget?.winRate).toBeGreaterThan(0.5);
  });

  /**
   * La mesure qui a motive la compression des amplificateurs
   * (docs/balance/2026-09-17-talent-contre-budget.md). Elle oppose un joueur
   * qui lit et vise juste avec un budget reduit a un joueur previsible et
   * maladroit qui depense le maximum.
   */
  it('mesure le talent contre le budget', LENT, () => {
    const talent = measureSkill(options).measures.find((m) => m.id === 'talent');
    expect(talent).toBeDefined();
    expect(talent?.winRate).toBeGreaterThan(0.5);
  });

  /**
   * Les sondes changent de siege a mi-parcours. Sans cela, un biais de siege du
   * moteur serait compte comme du talent — exactement l'erreur que cette
   * mesure existe pour eviter.
   */
  it('ne mesure aucun avantage entre deux sondes identiques', LENT, () => {
    const report = measureSkill({ ...options, matches: 600 });
    expect(report.seatBias).toBeGreaterThan(0.45);
    expect(report.seatBias).toBeLessThan(0.55);
  });

  it('accepte une configuration d equilibrage explicite', LENT, () => {
    expect(() => measureSkill({ ...options, config: BALANCE })).not.toThrow();
  });
});
