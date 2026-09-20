import { describe, expect, it } from 'vitest';
import { buildSeats, seatMotion, CROWD_SIZE, RING_SIZE, type CrowdSeat } from './crowdLayout.js';

/** Generateur reproductible : deux foules de meme graine sont identiques. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const seats = buildSeats(seeded(7));
const stands = seats.filter((s) => !s.ring);
const ring = seats.filter((s) => s.ring);

function at(index: number): CrowdSeat {
  const seat = seats[index];
  if (seat === undefined) throw new Error(`place ${String(index)} absente`);
  return seat;
}

describe('buildSeats — la tribune', () => {
  it('remplit la foule demandee, premier cercle compris', () => {
    expect(seats).toHaveLength(CROWD_SIZE);
    expect(ring).toHaveLength(RING_SIZE);
  });

  /**
   * Les spectateurs se tiennent sur les marches de `stage.ts`. Flottants, on
   * lit des gens suspendus au lieu d une tribune — et la profondeur du fond
   * disparait avec.
   */
  it('assied les gradins sur les marches, jamais dans le vide', () => {
    for (const seat of stands) {
      expect(seat.radius).toBeGreaterThan(4.2);
      expect(seat.radius).toBeLessThan(8.1);
      expect(seat.y).toBeGreaterThan(0);
    }
  });

  /** L arc des gradins est ouvert face a la camera : un public devant cacherait le combat. */
  it('laisse la face avant des gradins libre', () => {
    for (const seat of stands) {
      expect(seat.z < 2.6 || Math.abs(seat.x) > 3.4).toBe(true);
    }
  });

  it('se reproduit a graine egale', () => {
    expect(buildSeats(seeded(7))).toEqual(seats);
    expect(buildSeats(seeded(8))).not.toEqual(seats);
  });

  it('accepte une foule plus petite sans perdre le premier cercle', () => {
    const small = buildSeats(seeded(3), 40);
    expect(small).toHaveLength(40);
    expect(small.filter((s) => s.ring)).toHaveLength(RING_SIZE);
  });
});

describe('buildSeats — le premier cercle', () => {
  /**
   * Part de demi-largeur d image occupee par un point, camera au repos.
   *
   * Les combattants tombent a 0,31 : c est la bande centrale, et rien de ce
   * cercle-la ne doit y entrer. C est le seul endroit de la scene ou une
   * erreur de placement rend le jeu illisible plutot que laid — la camera se
   * rapproche jusqu a 2,6 m et se decale sur le vainqueur a la revelation.
   */
  const screenOffset = (seat: CrowdSeat): number => Math.abs(seat.x) / ((4.7 - seat.z) * 0.788);

  it('reste sur les bords du cadre, jamais devant les combattants', () => {
    for (const seat of ring) {
      expect(screenOffset(seat)).toBeGreaterThan(0.55);
    }
  });

  it('se serre en dedans des marches, sans les traverser', () => {
    const closest = Math.min(...stands.map((s) => s.radius));
    for (const seat of ring) {
      expect(seat.radius).toBeGreaterThan(2.9);
      expect(seat.radius).toBeLessThan(closest);
    }
  });

  it('en pose de chaque cote, pas tout un tas du meme', () => {
    expect(ring.filter((s) => s.x < 0).length).toBeGreaterThan(0);
    expect(ring.filter((s) => s.x > 0).length).toBeGreaterThan(0);
  });

  /** De pres et a contre-jour, on ne lit qu une masse sombre. */
  it('les peint plus sombres que les marches et plus grands', () => {
    const dimmest = Math.min(...stands.map((s) => s.cloth.l));
    for (const seat of ring) {
      expect(seat.cloth.l).toBeLessThan(dimmest);
      expect(seat.scale).toBeGreaterThan(1.2);
    }
  });

  /**
   * Debout sur le bitume, pas sur une marche : c est ce qui les distingue des
   * gradins, et ce qui creuse la profondeur entre le cercle et le fond.
   */
  it('les pose au sol, sous la premiere marche', () => {
    for (const seat of ring) {
      expect(seat.y).toBeLessThan(Math.min(...stands.map((s) => s.y)));
      expect(seat.y).toBeGreaterThan(-0.45);
    }
  });
});

describe('buildSeats — les telephones', () => {
  it('en fait tenir a une bonne part de la foule, sans que tout le monde filme', () => {
    const filming = seats.filter((s) => s.filming).length;
    expect(filming / seats.length).toBeGreaterThan(0.3);
    expect(filming / seats.length).toBeLessThan(0.62);
  });

  /** Le dos de l appareil regarde le duel : c est lui qu on filme. */
  it('braque le dos des telephones vers le centre', () => {
    for (const seat of seats) {
      const toCentre = Math.atan2(-seat.x, -seat.z);
      expect(seat.facing).toBeCloseTo(toCentre, 10);
    }
  });

  /**
   * Le halo, lui, doit regarder l objectif. Un plan vu par la tranche ne jette
   * aucune lueur : les spectateurs de cote seraient les seuls a ne rien
   * eclairer, alors qu ils occupent la moitie du cadre.
   */
  it('tourne le halo vers la camera, pas vers le centre', () => {
    const side = seats.find((s) => s.x < -5);
    if (side === undefined) throw new Error('personne sur le cote');
    expect(side.glowFacing).toBeCloseTo(Math.atan2(-side.x, 4.7 - side.z), 10);
    expect(side.glowFacing).not.toBeCloseTo(side.facing, 2);
  });

  /**
   * L attenuation est peinte dans la couleur parce qu un halo additif ne peut
   * pas etre mange par le brouillard : melanger vers la brume **ajoute** sa
   * couleur, et le fond du stade deviendrait plus lumineux que le premier rang.
   */
  it('eteint les ecrans avec la distance', () => {
    const near = ring[0];
    const far = [...stands].sort((a, b) => b.radius - a.radius)[0];
    if (near === undefined || far === undefined) throw new Error('foule vide');
    expect(near.reach).toBeGreaterThan(far.reach);
    for (const seat of seats) {
      expect(seat.reach).toBeGreaterThan(0);
      expect(seat.reach).toBeLessThanOrEqual(1);
    }
  });
});

describe('seatMotion', () => {
  it('leve les bras quand la ferveur monte', () => {
    const seat = at(0);
    const calm = seatMotion(seat, 0, 0);
    const roused = seatMotion(seat, 0, 1);
    expect(roused.raiseLeft).toBeGreaterThan(calm.raiseLeft);
  });

  it('fait sauter la foule sans la decoller des gradins', () => {
    const seat = at(3);
    const heights: number[] = [];
    for (let step = 0; step < 60; step++) heights.push(seatMotion(seat, step * 0.05, 1).y);
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    expect(high - low).toBeGreaterThan(0.02);
    expect(high - low).toBeLessThan(0.4);
  });

  /**
   * Celui qui filme ne baisse pas son telephone entre deux manches : son bras
   * droit reste haut, meme a ferveur nulle.
   */
  it('garde le bras du telephone leve, ferveur ou pas', () => {
    const filming = seats.find((s) => s.filming);
    if (filming === undefined) throw new Error('personne ne filme');
    expect(seatMotion(filming, 0, 0).raiseRight).toBeGreaterThan(0.7);
    expect(seatMotion(filming, 0, 0).raiseLeft).toBeLessThan(0.1);
  });

  /**
   * Une tribune ou tout le monde monte sur le meme temps se lit comme un seul
   * objet qui pulse. La reaction doit naitre chez les combattants et gagner le
   * fond.
   */
  it('propage la reaction du centre vers le fond', () => {
    const near = [...seats].sort((a, b) => a.radius - b.radius)[0];
    const far = [...seats].sort((a, b) => b.radius - a.radius)[0];
    if (near === undefined || far === undefined) throw new Error('foule vide');
    // Deux places identiques a la distance pres : seul le rayon doit decaler
    // la vague.
    const twin = (radius: number): CrowdSeat => ({ ...near, radius });
    const sameTime = 1.2;
    expect(seatMotion(twin(near.radius), sameTime, 1).y).not.toBeCloseTo(
      seatMotion(twin(far.radius), sameTime, 1).y,
      3,
    );
  });

  it('ne fait pas reagir tout le monde pareil', () => {
    const raises = seats.slice(0, 40).map((s) => seatMotion(s, 0.4, 0.8).raiseLeft);
    expect(new Set(raises.map((r) => r.toFixed(3))).size).toBeGreaterThan(20);
  });

  it('borne bras et ecrans, quelle que soit la ferveur demandee', () => {
    for (const hype of [-2, 0, 0.5, 1, 7]) {
      for (const seat of seats.slice(0, 30)) {
        const motion = seatMotion(seat, 3.7, hype);
        expect(motion.raiseLeft).toBeGreaterThanOrEqual(0);
        expect(motion.raiseLeft).toBeLessThanOrEqual(1);
        expect(motion.raiseRight).toBeGreaterThanOrEqual(0);
        expect(motion.raiseRight).toBeLessThanOrEqual(1);
        expect(motion.screen).toBeGreaterThanOrEqual(0);
        expect(motion.screen).toBeLessThanOrEqual(1);
        expect(motion.flash).toBeGreaterThanOrEqual(0);
        expect(motion.flash).toBeLessThanOrEqual(1);
      }
    }
  });

  /**
   * Les eclats d objectif sont l image de la tendance : ils n arrivent que
   * quand il se passe quelque chose, et jamais tous en meme temps.
   */
  it('ne declenche aucun eclat sur une salle calme', () => {
    for (const seat of seats) expect(seatMotion(seat, 2.5, 0).flash).toBe(0);
  });

  it('fait crepiter la salle a pleine ferveur, par a-coups', () => {
    let flashes = 0;
    let frames = 0;
    for (let step = 0; step < 240; step++) {
      const elapsed = step * (1 / 60);
      for (const seat of seats) {
        frames++;
        if (seatMotion(seat, elapsed, 1).flash > 0) flashes++;
      }
    }
    const share = flashes / frames;
    expect(share).toBeGreaterThan(0.005);
    expect(share).toBeLessThan(0.2);
  });
});

describe('ordre de dessin des places', () => {
  /*
    Un palier de qualite plus bas ne reconstruit pas la foule : il abaisse le
    nombre d instances dessinees, donc il **coupe la fin de la liste**. Cet
    ordre decide alors ce qui disparait, et la reponse ne peut pas etre le
    premier cercle : c est la couche proche, celle qui donne sa profondeur a
    l arene. Ce sont les derniers rangs qui partent, deja a moitie manges par
    le brouillard.
  */
  it('met le premier cercle en tete', () => {
    for (let i = 0; i < RING_SIZE; i++) {
      expect(at(i).ring).toBe(true);
    }
    expect(seats.slice(RING_SIZE).some((s) => s.ring)).toBe(false);
  });

  it('range ensuite les gradins du plus proche au plus lointain', () => {
    const radii = seats.slice(RING_SIZE).map((s) => s.radius);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]!).toBeGreaterThanOrEqual(radii[i - 1]!);
    }
  });

  /*
    Reordonner ne doit rien changer a la foule elle-meme : memes places, meme
    graine, meme tribune — seulement lues dans un autre ordre.
  */
  it('garde exactement les memes places', () => {
    const key = (s: CrowdSeat): string =>
      `${s.x.toFixed(6)}|${s.z.toFixed(6)}|${String(s.ring)}`;
    expect([...seats].map(key).sort()).toEqual([...buildSeats(seeded(7))].map(key).sort());
  });
});
