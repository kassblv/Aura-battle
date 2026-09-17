import { describe, expect, it } from 'vitest';
import type { ArenaEvent } from './events.js';
import { IDLE_IMPULSE, applyImpulse, decayImpulse, impulseFor } from './events.js';

const full = { reducedMotion: false };
const sober = { reducedMotion: true };

const reveal = (over: Partial<Extract<ArenaEvent, { type: 'reveal' }>> = {}): ArenaEvent => ({
  type: 'reveal',
  seat: 'a',
  local: true,
  score: 55,
  quality: 'good',
  ultimate: false,
  ...over,
});

describe('impulseFor — revelation', () => {
  it('cadre sur le combattant qui se revele', () => {
    expect(impulseFor(reveal(), full).focus).toEqual({ seat: 'a', durationMs: 1050, zoom: 1.16 });
  });

  it('chauffe la foule a proportion du score annonce par le serveur', () => {
    expect(impulseFor(reveal({ score: 55 }), full).hype).toBeCloseTo(0.5, 10);
    expect(impulseFor(reveal({ score: 200 }), full).hype).toBe(1);
  });

  it('reste calme sur un timing ordinaire', () => {
    const i = impulseFor(reveal(), full);
    expect(i.shake).toBe(0);
    expect(i.flash).toBe(0);
    expect(i.timeScale).toBe(1);
  });

  it('secoue et ralentit sur un timing parfait', () => {
    const i = impulseFor(reveal({ quality: 'perfect' }), full);
    expect(i.shake).toBe(7);
    expect(i.flash).toBeCloseTo(0.3, 10);
    expect(i.timeScale).toBeCloseTo(0.25, 10);
  });

  it('ne flashe que pour le joueur concerne', () => {
    expect(impulseFor(reveal({ quality: 'perfect', local: false }), full).flash).toBe(0);
  });

  it('pousse tout a fond sur un Ultime', () => {
    const i = impulseFor(reveal({ quality: 'good', ultimate: true }), full);
    expect(i.shake).toBe(14);
    expect(i.flash).toBeCloseTo(0.5, 10);
    expect(i.timeScale).toBeCloseTo(0.1, 10);
  });
});

describe('impulseFor — choc', () => {
  it('frappe plus fort sur un contre', () => {
    const counter = impulseFor({ type: 'clash', winner: 'a', counter: 'a' }, full);
    const plain = impulseFor({ type: 'clash', winner: 'a', counter: null }, full);
    expect(counter.shake).toBe(13);
    expect(plain.shake).toBe(8);
    expect(counter.hype).toBe(1);
    expect(plain.hype).toBe(1);
    expect(plain.timeScale).toBeCloseTo(0.15, 10);
    expect(plain.flash).toBeCloseTo(0.25, 10);
  });

  it('ne cadre personne : le choc se joue au milieu', () => {
    expect(impulseFor({ type: 'clash', winner: null, counter: null }, full).focus).toBeNull();
  });
});

describe('impulseFor — victoire', () => {
  it('cadre longuement le vainqueur', () => {
    const i = impulseFor({ type: 'victory', seat: 'b' }, full);
    expect(i.focus).toEqual({ seat: 'b', durationMs: 2600, zoom: 1.12 });
    expect(i.shake).toBe(6);
    expect(i.hype).toBe(1);
  });

  it('reste neutre sur une egalite', () => {
    expect(impulseFor({ type: 'victory', seat: null }, full)).toEqual(IDLE_IMPULSE);
  });
});

// Accessibilite : le prototype coupe le flash plein ecran sous
// prefers-reduced-motion. La secousse est coupee plus loin, par la camera.
describe('impulseFor — mouvement reduit', () => {
  it('supprime tout flash plein ecran', () => {
    expect(impulseFor(reveal({ quality: 'perfect' }), sober).flash).toBe(0);
    expect(impulseFor(reveal({ ultimate: true }), sober).flash).toBe(0);
    expect(impulseFor({ type: 'clash', winner: 'a', counter: null }, sober).flash).toBe(0);
  });

  it('garde le reste de la mise en scene', () => {
    expect(impulseFor(reveal({ quality: 'perfect' }), sober).shake).toBe(7);
  });
});

describe('applyImpulse', () => {
  it('garde le choc le plus fort plutot que le dernier recu', () => {
    const after = applyImpulse(
      { shake: 13, flash: 0.25, hype: 1, timeScale: 0.15 },
      impulseFor(reveal(), full),
    );
    expect(after).toEqual({ shake: 13, flash: 0.25, hype: 1, timeScale: 0.15 });
  });

  it('garde le ralenti le plus marque', () => {
    const after = applyImpulse(IDLE_IMPULSE, impulseFor(reveal({ ultimate: true }), full));
    expect(after.timeScale).toBeCloseTo(0.1, 10);
  });
});

describe('decayImpulse', () => {
  it('eteint la secousse en une demi-seconde', () => {
    expect(decayImpulse({ shake: 11, flash: 0, hype: 0, timeScale: 1 }, 0.5).shake).toBe(0);
    expect(decayImpulse({ shake: 14, flash: 0, hype: 0, timeScale: 1 }, 0.25).shake).toBeCloseTo(
      8.5,
      10,
    );
  });

  it('fait redescendre le flash et la ferveur, sans passer sous zero', () => {
    const state = decayImpulse({ shake: 0, flash: 0.5, hype: 1, timeScale: 1 }, 0.25);
    expect(state.flash).toBeCloseTo(0.1, 10);
    expect(state.hype).toBeCloseTo(0.9125, 10);
    expect(decayImpulse(state, 10)).toEqual({ shake: 0, flash: 0, hype: 0, timeScale: 1 });
  });

  it('ramene le ralenti vers la vitesse normale', () => {
    const state = decayImpulse({ shake: 0, flash: 0, hype: 0, timeScale: 0.1 }, 0.2);
    expect(state.timeScale).toBeGreaterThan(0.1);
    expect(state.timeScale).toBeLessThan(1);
    expect(decayImpulse(state, 10).timeScale).toBeCloseTo(1, 6);
  });
});
