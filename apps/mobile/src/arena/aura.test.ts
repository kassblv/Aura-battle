import { describe, expect, it } from 'vitest';
import { AURA_BUDGET, auraIntensity, createAuraEmitter, floorScale, haloScale } from './aura.js';
import { AURA_STYLES, styleForEffect, totalRate } from './auraTheme.js';
import { ADDITIVE_CAPACITY, type ParticleSink } from './particles.js';

/**
 * Generateur reproductible : deux auras de meme graine sont identiques.
 *
 * La simulation prend son hasard en parametre exactement pour cela — sinon un
 * test de budget deviendrait un tirage au sort et echouerait un jour sur deux.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly alpha: number;
  readonly size: number;
  readonly dark: boolean;
}

/** Puits d essai : il retient au lieu de dessiner. */
function recorder(): ParticleSink & { readonly points: Point[] } {
  const points: Point[] = [];
  return {
    points,
    add(x, y, z, color, alpha, size) {
      points.push({ x, y, z, color, alpha, size, dark: false });
    },
    dark(x, y, z, color, alpha, size) {
      points.push({ x, y, z, color, alpha, size, dark: true });
    },
  };
}

const ORIGIN = { x: 0, y: 0, z: 0 };

/** Fait tourner l aura `seconds` secondes a 60 i/s. */
function run(emitter: ReturnType<typeof createAuraEmitter>, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) emitter.update(step);
}

function settled(effectId: string, color = '#4fe3ff', intensity = 1, seed = 11) {
  const emitter = createAuraEmitter({ rng: seeded(seed) });
  emitter.set({ effectId, color, intensity });
  // Trois secondes : l intensite a rattrape sa cible et les plus longues
  // particules ont eu le temps de mourir une fois.
  run(emitter, 3);
  return emitter;
}

describe('createAuraEmitter', () => {
  it('rattrape l intensite demandee sans y sauter', () => {
    const emitter = createAuraEmitter({ rng: seeded(1) });
    emitter.set({ effectId: 'fx.sparks', color: '#ffcf3f', intensity: 1 });
    expect(emitter.intensity).toBe(0);

    emitter.update(1 / 60);
    const afterOneFrame = emitter.intensity;
    // Une aura qui s allume d un coup se lit comme un bug d affichage.
    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(0.15);

    run(emitter, 2);
    expect(emitter.intensity).toBeGreaterThan(0.9);
    expect(emitter.intensity).toBeLessThanOrEqual(1);
  });

  it('redescend quand l intensite retombe', () => {
    const emitter = settled('fx.sparks');
    emitter.set({ effectId: 'fx.sparks', color: '#4fe3ff', intensity: 0 });
    run(emitter, 3);
    expect(emitter.intensity).toBeLessThan(0.05);
    // Plus d intensite, plus de naissances : l aura s eteint d elle-meme.
    expect(emitter.particleCount).toBe(0);
  });

  it('borne l intensite a l intervalle 0–1', () => {
    const emitter = createAuraEmitter({ rng: seeded(2) });
    emitter.set({ effectId: 'fx.glow', color: '#ffffff', intensity: 9 });
    run(emitter, 4);
    expect(emitter.intensity).toBeLessThanOrEqual(1);

    emitter.set({ effectId: 'fx.glow', color: '#ffffff', intensity: -3 });
    run(emitter, 4);
    expect(emitter.intensity).toBeGreaterThanOrEqual(0);
  });

  it('n emet rien a intensite nulle', () => {
    const emitter = createAuraEmitter({ rng: seeded(3) });
    emitter.set({ effectId: 'fx.flames', color: '#ff3b3b', intensity: 0 });
    run(emitter, 5);
    expect(emitter.particleCount).toBe(0);
    expect(emitter.boltCount).toBe(0);
  });

  it('retombe sur la Lueur pour un effet inconnu, sans lever', () => {
    const emitter = createAuraEmitter({ rng: seeded(4) });
    expect(() => {
      emitter.set({ effectId: 'fx.venu-du-futur', color: '#b36bff', intensity: 1 });
    }).not.toThrow();
    expect(emitter.style.id).toBe('fx.glow');
    run(emitter, 2);
    // Et elle emet : un repli invisible serait un repli rate.
    expect(emitter.particleCount).toBeGreaterThan(0);
  });

  it('repart de zero quand l effet change', () => {
    const emitter = settled('fx.flames');
    expect(emitter.particleCount).toBeGreaterThan(0);

    emitter.set({ effectId: 'fx.vortex', color: '#4fe3ff', intensity: 1 });
    // Garder les flammes en changeant pour le vortex melangerait deux
    // vocabulaires pendant une seconde entiere.
    expect(emitter.particleCount).toBe(0);
    expect(emitter.style.id).toBe('fx.vortex');
  });

  it('garde ses particules quand seules la couleur ou l intensite changent', () => {
    const emitter = settled('fx.sparks');
    const before = emitter.particleCount;
    emitter.set({ effectId: 'fx.sparks', color: '#ff4fa3', intensity: 0.4 });
    expect(emitter.particleCount).toBe(before);
    expect(emitter.color).toBe('#ff4fa3');
  });

  it('tient le budget, meme apres un onglet reste une minute en arriere-plan', () => {
    for (const style of AURA_STYLES) {
      const emitter = createAuraEmitter({ rng: seeded(5) });
      emitter.set({ effectId: style.id, color: '#ffcf3f', intensity: 1 });
      run(emitter, 4);
      expect(emitter.particleCount, style.id).toBeLessThanOrEqual(AURA_BUDGET);

      // Une seule image de soixante secondes : sans borne sur l accumulateur,
      // on ferait naitre des dizaines de milliers de particules d un coup.
      emitter.update(60);
      expect(emitter.particleCount, style.id).toBeLessThanOrEqual(AURA_BUDGET);
    }
  });

  it('tient dans le tampon additif avec deux combattants a fond', () => {
    // Ce sont les anneaux et les eclairs qui comptent : un anneau vaut
    // soixante-dix points, un eclair autant.
    let worst = 0;
    for (const style of AURA_STYLES) {
      const emitter = settled(style.id, '#ffcf3f', 1, 17);
      let peak = 0;
      for (let i = 0; i < 180; i++) {
        emitter.update(1 / 60);
        const sink = recorder();
        emitter.draw(sink, ORIGIN, i / 60);
        peak = Math.max(peak, sink.points.length);
      }
      expect(peak * 2, style.id).toBeLessThanOrEqual(ADDITIVE_CAPACITY);
      worst = Math.max(worst, peak);
    }
    // Garde-fou : si un reglage double le cout, le test le dit avant l ecran.
    expect(worst).toBeLessThan(900);
  });

  it('est reproductible a graine egale', () => {
    const draw = (seed: number): Point[] => {
      const emitter = settled('fx.galaxy', '#b36bff', 1, seed);
      const sink = recorder();
      emitter.draw(sink, ORIGIN, 2);
      return sink.points;
    };
    expect(draw(21)).toEqual(draw(21));
    expect(draw(21)).not.toEqual(draw(22));
  });
});

describe('cadence et preference de mouvement', () => {
  it('emet environ la cadence annoncee par le theme', () => {
    // On mesure la population a l equilibre plutot que les naissances : au
    // bout de quelques secondes, il nait autant de particules qu il en meurt,
    // et ce palier vaut cadence x duree de vie moyenne.
    const style = styleForEffect('fx.sparks');
    const layer = style.layers[0]!;
    const expected = totalRate(style) * ((layer.life.min + layer.life.max) / 2);
    const emitter = settled('fx.sparks', '#ffcf3f', 1, 6);
    expect(emitter.particleCount).toBeGreaterThan(expected * 0.75);
    expect(emitter.particleCount).toBeLessThan(expected * 1.25);
  });

  it('emet deux fois moins quand l utilisateur demande moins d animation', () => {
    const population = (reducedMotion: boolean): number => {
      const emitter = createAuraEmitter({ rng: seeded(7), reducedMotion });
      emitter.set({ effectId: 'fx.sparks', color: '#ffcf3f', intensity: 1 });
      run(emitter, 3);
      return emitter.particleCount;
    };
    const full = population(false);
    const reduced = population(true);
    // Le vocabulaire de l effet ne change pas, sa densite oui.
    expect(reduced).toBeGreaterThan(0);
    expect(reduced / full).toBeCloseTo(0.5, 1);
  });

  it('coupe le scintillement de la Galaxie en mouvement reduit', () => {
    // Un point qui s allume et s eteint est precisement ce que la preference
    // systeme cherche a eviter ; l effet reste, son clignotement part. On
    // dessine deux fois le **meme** etat a deux instants : sans scintillement,
    // le temps ne doit rien changer aux opacites.
    const alphasAtTwoInstants = (reducedMotion: boolean): [number[], number[]] => {
      const emitter = createAuraEmitter({ rng: seeded(8), reducedMotion });
      emitter.set({ effectId: 'fx.galaxy', color: '#ffcf3f', intensity: 1 });
      run(emitter, 3);
      const first = recorder();
      const second = recorder();
      emitter.draw(first, ORIGIN, 1.234);
      emitter.draw(second, ORIGIN, 1.789);
      return [first.points.map((p) => p.alpha), second.points.map((p) => p.alpha)];
    };

    const [steadyA, steadyB] = alphasAtTwoInstants(true);
    expect(steadyA).toEqual(steadyB);
    const [flickerA, flickerB] = alphasAtTwoInstants(false);
    expect(flickerA).not.toEqual(flickerB);
  });
});

describe('dessin', () => {
  it('place les particules autour du combattant, jamais sous le plancher', () => {
    const origin = { x: -1.45, y: 0, z: 0 };
    for (const style of AURA_STYLES) {
      const emitter = settled(style.id, '#ffcf3f', 1, 31);
      const sink = recorder();
      emitter.draw(sink, origin, 1);
      for (const point of sink.points) {
        expect(Math.abs(point.x - origin.x), style.id).toBeLessThan(3);
        expect(point.y, style.id).toBeGreaterThan(-0.6);
        expect(point.y, style.id).toBeLessThan(4);
        expect(Math.abs(point.z), style.id).toBeLessThan(3);
      }
    }
  });

  it('suit le combattant quand il se deplace ou decolle', () => {
    const emitter = settled('fx.vortex');
    const here = recorder();
    const there = recorder();
    emitter.draw(here, { x: 0, y: 0, z: 0 }, 1);
    emitter.draw(there, { x: 1.45, y: 0.5, z: 0 }, 1);
    expect(there.points).toHaveLength(here.points.length);
    there.points.forEach((point, i) => {
      const reference = here.points[i]!;
      expect(point.x - reference.x).toBeCloseTo(1.45, 6);
      expect(point.y - reference.y).toBeCloseTo(0.5, 6);
    });
  });

  it('peint les particules a la couleur d aura du joueur', () => {
    const emitter = settled('fx.vortex', '#ff4fa3');
    const sink = recorder();
    emitter.draw(sink, ORIGIN, 1);
    expect(sink.points.length).toBeGreaterThan(0);
    for (const point of sink.points) expect(point.color).toBe('#ff4fa3');
  });

  it('melange du blanc aux etincelles et un coeur clair aux flammes', () => {
    const sparks = recorder();
    settled('fx.sparks', '#4fe3ff').draw(sparks, ORIGIN, 1);
    const tints = new Set(sparks.points.map((p) => p.color));
    expect(tints).toEqual(new Set(['#4fe3ff', '#ffffff']));

    const flames = recorder();
    settled('fx.flames', '#4fe3ff').draw(flames, ORIGIN, 1);
    // Le coeur clair n existe qu au debut de la vie de la flamme : les deux
    // teintes doivent coexister dans la meme image.
    expect(new Set(flames.points.map((p) => p.color))).toEqual(new Set(['#4fe3ff', '#fff4c2']));
  });

  it('envoie la fumee de l Aura noire dans le tampon opaque, pas dans la lumiere', () => {
    const sink = recorder();
    settled('fx.dark', '#b36bff').draw(sink, ORIGIN, 1);
    const smoke = sink.points.filter((p) => p.dark);
    expect(smoke.length).toBeGreaterThan(0);
    for (const point of smoke) expect(point.color).toBe('#07020f');
    // Les braises, elles, restent lumineuses et a la couleur du joueur.
    const embers = sink.points.filter((p) => !p.dark);
    expect(embers.length).toBeGreaterThan(0);
    for (const point of embers) expect(point.color).toBe('#b36bff');
  });

  it('ne fait craquer que les Éclairs et la Galaxie', () => {
    for (const style of AURA_STYLES) {
      const emitter = settled(style.id, '#ffcf3f', 1, 41);
      const expected = style.id === 'fx.lightning' || style.id === 'fx.galaxy';
      // Un eclair ne vit que 0,14 s : on regarde sur une seconde entiere.
      let seen = 0;
      for (let i = 0; i < 60; i++) {
        emitter.update(1 / 60);
        seen = Math.max(seen, emitter.boltCount);
      }
      expect(seen > 0, style.id).toBe(expected);
    }
  });

  it('dessine un eclair avec un coeur blanc dans le halo colore', () => {
    const emitter = settled('fx.lightning', '#ffcf3f', 1, 41);
    let points: Point[] = [];
    for (let i = 0; i < 60 && points.length === 0; i++) {
      emitter.update(1 / 60);
      if (emitter.boltCount === 0) continue;
      const sink = recorder();
      emitter.draw(sink, ORIGIN, i / 60);
      points = sink.points.filter((p) => p.color === '#ffffff' && p.size === 0.03);
    }
    expect(points.length).toBeGreaterThan(0);
  });

  it('ouvre les anneaux de l Onde de choc au lieu de les figer', () => {
    const emitter = createAuraEmitter({ rng: seeded(9) });
    emitter.set({ effectId: 'fx.shock', color: '#ffcf3f', intensity: 1 });
    run(emitter, 3);

    const spread = (): number => {
      const sink = recorder();
      emitter.draw(sink, ORIGIN, 0);
      // Le plus grand ecart au centre, au ras du sol : le rayon de l onde.
      return Math.max(...sink.points.filter((p) => p.y < 0.1).map((p) => Math.abs(p.x)), 0);
    };

    emitter.clear();
    emitter.set({ effectId: 'fx.shock', color: '#ffcf3f', intensity: 1 });
    run(emitter, 0.6);
    const young = spread();
    run(emitter, 0.4);
    expect(spread()).toBeGreaterThan(young);
  });

  it('vide tout sur demande', () => {
    const emitter = settled('fx.galaxy');
    emitter.clear();
    expect(emitter.particleCount).toBe(0);
    expect(emitter.boltCount).toBe(0);
    expect(emitter.intensity).toBe(0);
    const sink = recorder();
    emitter.draw(sink, ORIGIN, 0);
    expect(sink.points).toHaveLength(0);
  });

  it('ignore une image de duree nulle ou negative', () => {
    // `requestAnimationFrame` peut livrer deux fois le meme instant.
    const emitter = settled('fx.sparks');
    const before = emitter.particleCount;
    emitter.update(0);
    emitter.update(-1);
    expect(emitter.particleCount).toBe(before);
  });
});

describe('voile lumineux', () => {
  it('grandit avec l intensite, et reste borne au-dela de 1', () => {
    const [restWidth, restHeight] = haloScale(0);
    const [fullWidth, fullHeight] = haloScale(1);
    expect(fullWidth).toBeGreaterThan(restWidth);
    expect(fullHeight).toBeGreaterThan(restHeight);
    expect(haloScale(4)).toEqual(haloScale(1));
    expect(haloScale(-1)).toEqual(haloScale(0));
    expect(floorScale(1)).toBeGreaterThan(floorScale(0));
    expect(floorScale(9)).toBe(floorScale(1));
  });

  it('assombrit le voile de l Aura noire, qui doit manger la lumiere', () => {
    expect(styleForEffect('fx.dark').haloOpacity).toBeLessThan(
      styleForEffect('fx.glow').haloOpacity,
    );
  });
});

describe('auraIntensity', () => {
  /*
    LA regle de ce module, et elle n est pas visuelle : regle d or n°4.

    Le palier joue est secret jusqu a `round:result`. Une aura qui gonflerait
    avec lui pendant la phase de choix l annoncerait a l adversaire — sans
    qu aucun message reseau ne change, donc sans qu une relecture du serveur ou
    du protocole puisse le voir. La parade est dans la signature : avant le
    choc, cette fonction ne recoit **aucune entree propre a un siege**. Ce qui
    n entre pas ne peut pas sortir.
  */
  it('ne lit que la ferveur avant le choc, rien d autre', () => {
    /*
      La garantie est dans le type, pas dans cette boucle : `AuraDrive` n a
      aucun champ propre a un siege, donc un appelant ne PEUT pas lui passer
      le palier joue sans modifier l interface — et modifier l interface se
      lit en relecture. Ce test tient l autre moitie : que la valeur rendue
      soit exactement la ferveur, donc qu aucune autre entree ne s y glisse.
    */
    for (const hype of [0, 0.18, 0.4, 0.55, 0.95, 1]) {
      expect(auraIntensity({ showcase: false, hype, clashWeight: 0 })).toBeCloseTo(hype, 6);
    }
  });

  it('pose une aura de repos hors match, quelle que soit la ferveur', () => {
    const calm = auraIntensity({ showcase: true, hype: 0, clashWeight: 0 });
    const loud = auraIntensity({ showcase: true, hype: 1, clashWeight: 0 });
    expect(calm).toBe(loud);
    expect(calm).toBeGreaterThan(0);
    expect(calm).toBeLessThan(1);
  });

  it('laisse le choc l emporter sur la ferveur', () => {
    const base = auraIntensity({ showcase: false, hype: 0.4, clashWeight: 0 });
    const clashing = auraIntensity({ showcase: false, hype: 0.4, clashWeight: 1 });
    expect(clashing).toBeGreaterThan(base);
  });

  it('monte avec le poids du faisceau', () => {
    const plain = auraIntensity({ showcase: false, hype: 0, clashWeight: 1 });
    const countering = auraIntensity({ showcase: false, hype: 0, clashWeight: 1.35 });
    const ultimate = auraIntensity({ showcase: false, hype: 0, clashWeight: 1.6 });
    expect(countering).toBeGreaterThan(plain);
    expect(ultimate).toBeGreaterThan(countering);
    expect(ultimate).toBeCloseTo(1, 6);
  });

  it('fait retomber l aura du perdant sous celle d un faisceau plein', () => {
    const losing = auraIntensity({ showcase: false, hype: 0, clashWeight: 0.55 });
    const plain = auraIntensity({ showcase: false, hype: 0, clashWeight: 1 });
    expect(losing).toBeLessThan(plain);
    expect(losing).toBeGreaterThan(0);
  });

  it('reste entre 0 et 1 quoi qu on lui donne', () => {
    for (const drive of [
      { showcase: false, hype: -5, clashWeight: 0 },
      { showcase: false, hype: 12, clashWeight: 0 },
      { showcase: false, hype: 0, clashWeight: 40 },
      { showcase: false, hype: 0, clashWeight: -3 },
    ]) {
      const value = auraIntensity(drive);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('budget reglable', () => {
  /** La Galaxie sature : au regime elle tient 143 particules, mesure a la main. */
  const SATURATING = { effectId: 'fx.galaxy', color: '#b36bff', intensity: 1 } as const;

  function settle(emitter: ReturnType<typeof createAuraEmitter>, frames = 900): void {
    for (let i = 0; i < frames; i++) emitter.update(1 / 60);
  }

  it('plafonne la population vivante', () => {
    const emitter = createAuraEmitter({ rng: seeded(11) });
    emitter.set(SATURATING);
    emitter.setBudget(40);
    settle(emitter);
    expect(emitter.particleCount).toBeLessThanOrEqual(40);
  });

  it('laisse repartir la population quand le budget remonte', () => {
    const emitter = createAuraEmitter({ rng: seeded(11) });
    emitter.set(SATURATING);
    emitter.setBudget(40);
    settle(emitter);
    emitter.setBudget(AURA_BUDGET);
    settle(emitter);
    expect(emitter.particleCount).toBeGreaterThan(40);
  });

  /*
    Baisser le budget ne tue rien : le surplus meurt de lui-meme. Effacer des
    particules deja a l ecran ferait un trou visible juste apres la bascule —
    et la bascule arrive precisement quand l appareil rame, donc au pire
    moment pour un defaut visuel.
  */
  it('ne vide pas l aura d un coup en baissant le budget', () => {
    const emitter = createAuraEmitter({ rng: seeded(11) });
    emitter.set(SATURATING);
    settle(emitter);
    const before = emitter.particleCount;
    emitter.setBudget(10);
    expect(emitter.particleCount).toBe(before);
  });
});
