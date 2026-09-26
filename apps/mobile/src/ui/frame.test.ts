import {
  BALANCE,
  RULE_VARIANTS,
  createRng,
  generateOrbSequence,
  liveOrbs,
  variantConfig,
  type Orb,
} from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { reachable } from '../match/reach.js';
import { countdownLabel, orbPaint, ORB_SLOTS, phaseClock, progressTransform } from './frame.js';

const sequence = (seed: string): readonly Orb[] => generateOrbSequence(createRng(seed));

describe('phaseClock', () => {
  it('deduit le debut de la phase de sa fin et de sa duree', () => {
    const clock = phaseClock(10_000, 6_000, 5_500);
    expect(clock.inPhaseMs).toBe(1_500);
    expect(clock.leftMs).toBe(4_500);
    expect(clock.progress).toBeCloseTo(0.25, 6);
  });

  it('ne rend jamais de temps negatif, avant comme apres la phase', () => {
    const before = phaseClock(10_000, 6_000, 1_000);
    expect(before.inPhaseMs).toBe(0);
    expect(before.progress).toBe(0);

    const after = phaseClock(10_000, 6_000, 12_000);
    expect(after.leftMs).toBe(0);
    expect(after.progress).toBe(1);
  });

  /**
   * La duree est nulle entre l entree en phase et le message serveur qui la
   * date. Une division y rendrait `NaN`, donc `scaleX(NaN)` : un style
   * invalide que le navigateur ignore, et une barre restee a son etat
   * precedent sans que rien ne le signale.
   */
  it('survit a une duree nulle', () => {
    const clock = phaseClock(0, 0, 0);
    expect(clock.progress).toBe(0);
    expect(Number.isNaN(clock.progress)).toBe(false);
  });
});

describe('countdownLabel', () => {
  it('affiche des dixiemes de seconde', () => {
    expect(countdownLabel(4_260)).toBe('4.3 s');
    expect(countdownLabel(0)).toBe('0.0 s');
  });

  it('ne descend pas sous zero quand la phase est depassee', () => {
    expect(countdownLabel(-500)).toBe('0.0 s');
  });

  /**
   * Le format EST le rythme : c est parce qu il ne change que dix fois par
   * seconde que la boucle peut le comparer et n ecrire que la difference. Si
   * une seconde se lisait en centiemes, il faudrait un second compteur.
   */
  it('ne change pas plus de dix fois par seconde', () => {
    let changes = 0;
    let previous = countdownLabel(0);
    // Six secondes au pas de la milliseconde : plus fin que n importe quelle
    // image, donc on voit chaque changement possible.
    for (let ms = 1; ms <= 6_000; ms += 1) {
      const label = countdownLabel(ms);
      if (label !== previous) changes += 1;
      previous = label;
    }
    expect(changes).toBeLessThanOrEqual(60);
  });
});

describe('progressTransform', () => {
  it('comprime la barre au prorata de la phase', () => {
    expect(progressTransform(0)).toBe('scaleX(0.0000)');
    expect(progressTransform(0.5)).toBe('scaleX(0.5000)');
    expect(progressTransform(1)).toBe('scaleX(1.0000)');
  });

  it('borne les valeurs hors piste', () => {
    expect(progressTransform(-1)).toBe('scaleX(0.0000)');
    expect(progressTransform(4)).toBe('scaleX(1.0000)');
  });
});

describe('orbPaint', () => {
  it('rend toujours un emplacement par emplacement du moteur', () => {
    const slots = orbPaint([], sequence('orbes-1'), 0);
    expect(slots).toHaveLength(ORB_SLOTS);
    expect(ORB_SLOTS).toBe(BALANCE.recharge.visibleOrbs);
  });

  /**
   * Le point de tout le module : l ecran peint **ce que le moteur juge**.
   * Recalculer l occupation des emplacements ici serait une seconde
   * implementation de la regle, et le joueur finirait par taper une orbe que
   * le moteur a deja retiree.
   */
  it('suit `liveOrbs`, orbe par orbe et emplacement par emplacement', () => {
    const orbs = sequence('orbes-7');
    const taps = [{ atMs: 300, orbIndex: orbs[1]?.index ?? 0 }];

    for (const at of [0, 120, 301, 900, 1_700, 3_000, 5_900]) {
      const live = liveOrbs(taps, orbs, at);
      const slots = orbPaint(taps, orbs, at);
      const painted = slots
        .map((slot, index) => ({ slot: index, orbIndex: slot.orbIndex }))
        .filter((entry) => entry.orbIndex !== null);

      expect(painted).toEqual(live.map((one) => ({ slot: one.slot, orbIndex: one.orb.index })));
    }
  });

  it('place chaque orbe la ou `reachable` la met', () => {
    const orbs = sequence('orbes-3');
    const first = orbs[0];
    if (first === undefined) throw new Error('sequence vide');

    const at = reachable(first.x, first.y);
    const slot = orbPaint([], orbs, 0)[0];
    expect(slot?.left).toBe(`${(at.left * 100).toFixed(2)}%`);
    expect(slot?.top).toBe(`${(at.top * 100).toFixed(2)}%`);
  });

  it('palit l orbe a mesure qu elle expire', () => {
    const orbs = sequence('orbes-11');
    const first = orbs[0];
    if (first === undefined) throw new Error('sequence vide');

    const fresh = orbPaint([], orbs, 0)[0];
    const old = orbPaint([], orbs, first.lifetimeMs - 1)[0];
    expect(Number(fresh?.opacity)).toBeCloseTo(1, 2);
    expect(Number(old?.opacity)).toBeLessThan(0.45);
    expect(Number(old?.opacity)).toBeGreaterThanOrEqual(0.4);
  });

  /**
   * Un emplacement vide reste dans le tableau : c est ce qui l apparie a une
   * reference DOM fixe d une image a l autre. Il porte `null`, donc la boucle
   * le masque et refuse le tap.
   */
  it('rend un emplacement vide plutot que de le retirer', () => {
    const slots = orbPaint([], [], 0);
    expect(slots).toHaveLength(ORB_SLOTS);
    expect(slots.every((slot) => slot.orbIndex === null)).toBe(true);
  });

  it('vide tout emplacement une fois la recharge terminee', () => {
    const slots = orbPaint([], sequence('orbes-5'), BALANCE.recharge.durationMs + 1);
    expect(slots.every((slot) => slot.orbIndex === null)).toBe(true);
  });

  it('distingue les orbes dorees, par le drapeau et par le nom lu a voix haute', () => {
    const orbs = sequence('orbes-2');
    const golden = orbs.findIndex((orb) => orb.kind === 'golden');
    expect(golden).toBeGreaterThanOrEqual(0);

    // On avance jusqu a ce que l orbe doree occupe un emplacement.
    const taps = orbs
      .slice(0, golden)
      .map((orb, index) => ({ atMs: 10 + index * 10, orbIndex: orb.index }));
    const slots = orbPaint(taps, orbs, 10 + golden * 10);
    const painted = slots.find((slot) => slot.orbIndex === orbs[golden]?.index);

    expect(painted?.golden).toBe(true);
    expect(painted?.label).toBe('Orbe dorée');
  });
});

describe('ORB_SLOTS', () => {
  /*
    Les emplacements sont des boutons montes une fois : une variante qui
    changerait le nombre d'orbes visibles en laisserait sans bouton.
  */
  it('vaut pour chaque evenement de la semaine', () => {
    for (const variant of RULE_VARIANTS) {
      expect(variantConfig(variant.id).recharge.visibleOrbs).toBe(ORB_SLOTS);
    }
  });
});
