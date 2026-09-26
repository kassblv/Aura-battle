import { describe, expect, it } from 'vitest';
import {
  CLASH_DURATION_MS,
  CLASH_HIT_AT,
  beamFade,
  beamGrowth,
  beamWeight,
  clashBias,
  coreGlow,
  createClash,
  meetingFraction,
  type ClashEnds,
  type ClashSpec,
} from './clash.js';
import type { ParticleSink } from './particles.js';

const ends: ClashEnds = {
  a: { x: -1.45, y: 1.05, z: 0 },
  b: { x: 1.45, y: 1.05, z: 0 },
};

const spec = (over: Partial<ClashSpec> = {}): ClashSpec => ({
  winner: 'a',
  counter: null,
  ultimate: null,
  ...over,
});

interface Recorded {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly alpha: number;
  readonly size: number;
}

function recorder(): ParticleSink & { readonly points: Recorded[] } {
  const points: Recorded[] = [];
  return {
    points,
    add(x, y, z, color, alpha, size): void {
      points.push({ x, y, z, color, alpha, size });
    },
    dark(x, y, z, color, alpha, size): void {
      points.push({ x, y, z, color, alpha, size });
    },
  };
}

describe('clashBias', () => {
  it('pousse le point de rencontre chez le perdant', () => {
    expect(clashBias(spec({ winner: 'a' }))).toBeGreaterThan(0);
    expect(clashBias(spec({ winner: 'b' }))).toBeLessThan(0);
  });

  it('ne pousse pas sur une manche nulle', () => {
    expect(clashBias(spec({ winner: null }))).toBe(0);
  });

  // La distance parcourue est la lecture : plus l issue est forte, plus le
  // point de rencontre entre dans le camp du perdant.
  it('pousse plus loin sur un contre, plus loin encore sur un Ultime', () => {
    const plain = clashBias(spec());
    const counter = clashBias(spec({ counter: 'a' }));
    const ultimate = clashBias(spec({ ultimate: 'a' }));
    expect(counter).toBeGreaterThan(plain);
    expect(ultimate).toBeGreaterThan(counter);
  });

  it('ignore un contre porte par le perdant', () => {
    expect(clashBias(spec({ winner: 'a', counter: 'b' }))).toBe(clashBias(spec()));
  });
});

describe('meetingFraction', () => {
  it('tient le milieu jusqu au contact', () => {
    expect(meetingFraction(0, 0.17)).toBe(0.5);
    expect(meetingFraction(CLASH_HIT_AT, 0.17)).toBe(0.5);
  });

  it('glisse ensuite, et pas au-dela de la poussee demandee', () => {
    const middle = meetingFraction(0.6, 0.17);
    expect(middle).toBeGreaterThan(0.5);
    expect(meetingFraction(1, 0.17)).toBeCloseTo(0.67, 10);
  });

  it('reste au centre quand personne ne gagne', () => {
    expect(meetingFraction(1, 0)).toBe(0.5);
  });
});

describe('beamGrowth, beamFade et coreGlow', () => {
  it('fait atteindre le point de rencontre pile au contact', () => {
    expect(beamGrowth(0)).toBe(0);
    expect(beamGrowth(CLASH_HIT_AT)).toBe(1);
    expect(beamGrowth(1)).toBe(1);
  });

  it('garde les faisceaux pleins jusqu aux sept dixiemes, puis les efface', () => {
    expect(beamFade(0.7)).toBe(1);
    expect(beamFade(0.85)).toBeCloseTo(0.5, 10);
    expect(beamFade(1)).toBe(0);
  });

  it('n allume le coeur qu au contact, puis le dilate en l effacant', () => {
    expect(coreGlow(0.3).alpha).toBe(0);
    const hit = coreGlow(CLASH_HIT_AT);
    const later = coreGlow(0.8);
    expect(hit.alpha).toBeGreaterThan(later.alpha);
    expect(hit.size).toBeLessThan(later.size);
  });
});

describe('beamWeight', () => {
  it('epaissit le faisceau de celui qui contre, davantage celui qui ultime', () => {
    expect(beamWeight(spec({ counter: 'a' }), 'a', 0)).toBeGreaterThan(1);
    expect(beamWeight(spec({ ultimate: 'a' }), 'a', 0)).toBeGreaterThan(
      beamWeight(spec({ counter: 'a' }), 'a', 0),
    );
  });

  it('fait ceder le faisceau du perdant apres le contact, jamais avant', () => {
    expect(beamWeight(spec({ winner: 'a' }), 'b', CLASH_HIT_AT)).toBe(1);
    expect(beamWeight(spec({ winner: 'a' }), 'b', 0.9)).toBeLessThan(1);
  });

  it('ne fait ceder personne sur une manche nulle', () => {
    expect(beamWeight(spec({ winner: null }), 'a', 1)).toBe(1);
    expect(beamWeight(spec({ winner: null }), 'b', 1)).toBe(1);
  });
});

describe('createClash', () => {
  it('ne signale le contact qu une fois', () => {
    const clash = createClash();
    clash.start(spec());
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      if (clash.update(16, ends).hit) hits++;
    }
    expect(hits).toBe(1);
  });

  it('signale le contact au bon moment', () => {
    const clash = createClash();
    clash.start(spec());
    let elapsed = 0;
    while (!clash.update(10, ends).hit) elapsed += 10;
    expect(elapsed + 10).toBeCloseTo(CLASH_DURATION_MS * CLASH_HIT_AT, -1);
  });

  it('signale le contact meme sur une image qui saute tout le choc', () => {
    // Un onglet revenu au premier plan livre une seconde d un coup. Sans ce
    // rattrapage, le verdict tomberait sans que rien n ait explose.
    const clash = createClash();
    clash.start(spec());
    expect(clash.update(5_000, ends).hit).toBe(true);
    expect(clash.active).toBe(false);
  });

  it('place le point de rencontre entre les deux, du cote du perdant', () => {
    const clash = createClash();
    clash.start(spec({ winner: 'a' }));
    clash.update(10, ends);
    expect(clash.point?.x).toBeCloseTo(0, 10);
    clash.update(CLASH_DURATION_MS * 0.85, ends);
    expect(clash.point!.x).toBeGreaterThan(0);
    expect(clash.point!.x).toBeLessThan(ends.b.x);
  });

  it('ne dessine rien tant qu aucun choc ne tourne', () => {
    const sink = recorder();
    createClash().draw(sink, { a: '#ff0000', b: '#00ff00' }, 0);
    expect(sink.points).toHaveLength(0);
  });

  it('dessine les deux faisceaux a la couleur de chaque aura', () => {
    const clash = createClash();
    clash.start(spec());
    clash.update(200, ends);
    const sink = recorder();
    clash.draw(sink, { a: '#ff0000', b: '#00ff00' }, 0);
    const colors = new Set(sink.points.map((p) => p.color));
    expect(colors).toEqual(new Set(['#ff0000', '#00ff00', '#ffffff']));
  });

  /*
    Accessibilite : `prefers-reduced-motion` coupe le tremblement du faisceau,
    pas le faisceau. L information — qui pousse, dans quel sens — reste.
  */
  it('supprime le tremblement en mouvement reduit, sans supprimer le trait', () => {
    const draw = (reduced: boolean): Recorded[] => {
      const clash = createClash();
      clash.setReducedMotion(reduced);
      clash.start(spec());
      clash.update(200, ends);
      const sink = recorder();
      clash.draw(sink, { a: '#ff0000', b: '#00ff00' }, 1_234);
      return sink.points;
    };

    const sober = draw(true);
    const full = draw(false);
    expect(sober).toHaveLength(full.length);
    expect(new Set(sober.map((p) => p.z))).toEqual(new Set([0]));
    expect(new Set(full.map((p) => p.z)).size).toBeGreaterThan(1);
  });
});
