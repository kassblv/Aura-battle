import { describe, expect, it } from 'vitest';
import { CLASH_DURATION_MS, CLASH_HIT_AT, type ClashColors, type ClashEnds } from './clash.js';
import { createArenaDirector, type ArenaDirector, type DirectorFrame } from './director.js';
import type { ParticleSink } from './particles.js';
import { CLASH_AT_MS, REVEAL_FIRST_AT_MS, VICTORY_AT_MS, type RoundStory } from './round.js';

const ends: ClashEnds = {
  a: { x: -1.45, y: 1.05, z: 0 },
  b: { x: 1.45, y: 1.05, z: 0 },
};
const colors: ClashColors = { a: '#7cf2ff', b: '#ff6b81' };

const frame = (deltaMs: number): DirectorFrame => ({ deltaMs, ends, colors });

const story = (over: Partial<RoundStory> = {}): RoundStory => ({
  round: 1,
  winner: 'a',
  revealFirst: 'b',
  sides: {
    a: { score: 62, quality: 'good', ultimate: false, counters: false },
    b: { score: 40, quality: 'good', ultimate: false, counters: false },
  },
  ...over,
});

/** Avance le realisateur de `ms`, par images de 16 ms. */
function run(director: ArenaDirector, ms: number): void {
  for (let left = ms; left > 0; left -= 16) director.update(frame(Math.min(16, left)));
}

function sinkCount(director: ArenaDirector): number {
  let points = 0;
  const sink: ParticleSink = {
    add(): void {
      points++;
    },
    dark(): void {
      points++;
    },
  };
  director.draw(sink, 0);
  return points;
}

describe('createArenaDirector — le fil de la manche', () => {
  it('ne fait rien tant qu aucune manche n est jouee', () => {
    const director = createArenaDirector();
    run(director, 2_000);
    expect(director.shake).toBe(0);
    expect(director.focus).toBeNull();
    expect(director.clashing).toBe(false);
    expect(sinkCount(director)).toBe(0);
  });

  it('cadre le premier combattant qui se revele', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, REVEAL_FIRST_AT_MS + 32);
    expect(director.focus?.seat).toBe('b');
  });

  it('relache le cadrage au moment du choc : le contact se joue au centre', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + 32);
    expect(director.focus).toBeNull();
    expect(director.clashing).toBe(true);
  });

  /*
    Le cadrage du vainqueur attend la fin du choc.

    Les poses tombent a l instant du contact (le perdant chancelle parce qu il
    vient d etre touche), mais partir avec la camera au meme instant ferait
    jouer la gerbe hors champ : on verrait le vainqueur lever les bras sans
    jamais voir le coup.
  */
  it('reste au centre tant que les faisceaux brulent', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, VICTORY_AT_MS + 32);
    expect(director.clashing).toBe(true);
    expect(director.focus).toBeNull();
  });

  it('revient sur le vainqueur une fois le choc eteint', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + CLASH_DURATION_MS + 32);
    expect(director.clashing).toBe(false);
    expect(director.focus?.seat).toBe('a');
  });

  it('ne rogne pas le plan du vainqueur du temps passe sur le choc', () => {
    const director = createArenaDirector();
    director.play(story());
    // Le choc est fini depuis peu : le plan du vainqueur commence a peine.
    run(director, CLASH_AT_MS + CLASH_DURATION_MS + 200);
    expect(director.focus?.seat).toBe('a');
    run(director, 2_000);
    expect(director.focus?.seat).toBe('a');
  });

  it('ne cadre personne sur une manche nulle', () => {
    const director = createArenaDirector();
    director.play(story({ winner: null }));
    run(director, VICTORY_AT_MS + 200);
    expect(director.focus).toBeNull();
  });

  it('ne rejoue pas la manche deja mise en scene', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, VICTORY_AT_MS + CLASH_DURATION_MS + 4_000);
    director.play(story());
    run(director, 32);
    expect(director.clashing).toBe(false);
    expect(director.focus).toBeNull();
  });

  it('remet tout a plat sur la manche suivante', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, VICTORY_AT_MS);
    director.play(story({ round: 2 }));
    run(director, REVEAL_FIRST_AT_MS + 32);
    expect(director.round).toBe(2);
    expect(director.focus?.seat).toBe('b');
  });

  it('joue les temps sautes par une image trop longue', () => {
    const director = createArenaDirector();
    director.play(story());
    // Une seule image couvrant toute la choregraphie : rien ne doit etre perdu.
    director.update(frame(VICTORY_AT_MS + 50));
    expect(director.focus?.seat).toBe('a');
    expect(director.hype).toBeGreaterThan(0);
  });
});

describe('createArenaDirector — le choc', () => {
  it('secoue et embrase la salle au contact', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT + 16);
    expect(director.shake).toBeGreaterThan(0);
    expect(director.hype).toBeGreaterThan(0.9);
  });

  it('fait reculer le perdant, du bon cote', () => {
    const left = createArenaDirector();
    left.play(story({ winner: 'a' }));
    run(left, CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT + 120);
    // `a` gagne : c est `b`, a droite, qui part vers la droite.
    expect(left.knockback('b')).toBeGreaterThan(0.1);
    expect(left.knockback('a')).toBe(0);

    const right = createArenaDirector();
    right.play(story({ winner: 'b' }));
    run(right, CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT + 120);
    expect(right.knockback('a')).toBeLessThan(-0.1);
  });

  it('ne fait reculer personne sur une manche nulle', () => {
    const director = createArenaDirector();
    director.play(story({ winner: null }));
    run(director, CLASH_AT_MS + CLASH_DURATION_MS + 200);
    expect(director.knockback('a')).toBe(0);
    expect(director.knockback('b')).toBe(0);
  });

  it('ramene le perdant a sa place', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + CLASH_DURATION_MS + 4_000);
    expect(Math.abs(director.knockback('b'))).toBeLessThan(0.02);
  });

  it('fait naitre des particules a la revelation et au contact', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, REVEAL_FIRST_AT_MS + 32);
    const afterReveal = director.fxCount;
    expect(afterReveal).toBeGreaterThan(0);

    run(director, CLASH_AT_MS - REVEAL_FIRST_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT);
    expect(sinkCount(director)).toBeGreaterThan(0);
  });

  it('tout retombe : le budget ne fuit pas d une manche a l autre', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, 6_000);
    expect(director.fxCount).toBe(0);
    expect(director.clashing).toBe(false);
    expect(sinkCount(director)).toBe(0);
    expect(director.shake).toBe(0);
    expect(director.flash).toBe(0);
  });
});

describe('createArenaDirector — accessibilite', () => {
  it('coupe le voile plein ecran en mouvement reduit, garde la secousse a la camera', () => {
    const sober = createArenaDirector({ reducedMotion: true });
    sober.play(
      story({
        sides: {
          a: { score: 90, quality: 'perfect', ultimate: true, counters: false },
          b: { score: 40, quality: 'good', ultimate: false, counters: false },
        },
      }),
    );
    run(sober, VICTORY_AT_MS);
    expect(sober.flash).toBe(0);
    // La secousse survit ici : c est `ArenaCameraRig` qui la neutralise, pour
    // que le meme etat serve aux deux reglages.
    expect(sober.shake).toBeGreaterThan(0);
  });
});

describe('createArenaDirector — annulation', () => {
  it('coupe tout et ne laisse rien derriere', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT + 32);
    director.cancel();
    expect(director.round).toBeNull();
    expect(director.clashing).toBe(false);
    expect(director.fxCount).toBe(0);
    expect(director.focus).toBeNull();
    expect(director.knockback('a')).toBe(0);
    expect(director.knockback('b')).toBe(0);
    expect(director.shake).toBe(0);
    expect(director.timeScale).toBe(1);
    expect(sinkCount(director)).toBe(0);
  });

  it('rejoue la meme manche apres une annulation', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, 200);
    director.cancel();
    director.play(story());
    run(director, REVEAL_FIRST_AT_MS + 32);
    expect(director.focus?.seat).toBe('b');
  });
});

describe('poids d aura', () => {
  /*
    L aura des combattants lit le choc, elle ne recalcule pas le vainqueur.

    « Qui l emporte, maintenant, en un nombre » est deja exprime par
    `beamWeight` et pilote le faisceau. Une deuxieme expression du meme fait
    est ce qui a coute le plus cher a ce depot : les deux se contrediraient un
    jour, et c est le faisceau qui dirait vrai pendant que l aura mentirait.
  */
  it('vaut zero tant que rien ne se joue', () => {
    const director = createArenaDirector();
    expect(director.auraWeight('a')).toBe(0);
    expect(director.auraWeight('b')).toBe(0);
  });

  it('vaut zero hors du choc, meme pendant la manche', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, REVEAL_FIRST_AT_MS + 16);
    expect(director.auraWeight('a')).toBe(0);
  });

  it('donne aux deux le meme poids avant le contact', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + 32);
    expect(director.auraWeight('a')).toBeCloseTo(director.auraWeight('b'), 6);
    expect(director.auraWeight('a')).toBeGreaterThan(0);
  });

  it('fait ceder le perdant apres le contact', () => {
    const director = createArenaDirector();
    director.play(story({ winner: 'a' }));
    run(director, CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT + 220);
    expect(director.auraWeight('b')).toBeLessThan(director.auraWeight('a'));
  });

  it('avantage celui qui lache son Ultime', () => {
    const director = createArenaDirector();
    director.play(
      story({
        sides: {
          a: { score: 80, quality: 'good', ultimate: true, counters: false },
          b: { score: 40, quality: 'good', ultimate: false, counters: false },
        },
      }),
    );
    run(director, CLASH_AT_MS + 32);
    expect(director.auraWeight('a')).toBeGreaterThan(director.auraWeight('b'));
  });

  it('retombe a zero quand le choc est fini', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + CLASH_DURATION_MS + 64);
    expect(director.auraWeight('a')).toBe(0);
    expect(director.auraWeight('b')).toBe(0);
  });

  it('retombe a zero quand la manche est coupee', () => {
    const director = createArenaDirector();
    director.play(story());
    run(director, CLASH_AT_MS + 32);
    director.cancel();
    expect(director.auraWeight('a')).toBe(0);
  });
});
