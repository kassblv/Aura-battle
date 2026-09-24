import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import { QUALITY_PROFILES } from '../platform/quality.js';
import { BEAM_WEIGHT_ULTIMATE } from './clash.js';
import { clamp, damp, easeOut } from './math.js';
import type { ParticleSink } from './particles.js';
import {
  type AuraLayer,
  type AuraStyle,
  FIGHTER_HEIGHT,
  type Range,
  styleForEffect,
} from './auraTheme.js';

/**
 * L aura d un combattant (port de « Particules d aura (logique) » et de
 * `fillParticles` du prototype).
 *
 * Deux moities, separees exprès :
 *
 * - `createAuraEmitter` ne connait **ni Three.js ni le DOM**. Il fait naitre,
 *   deplacer et mourir des particules, puis les pose dans un `ParticleSink`.
 *   C est la partie testee, image par image, avec un hasard injecte.
 * - `createAuraGlow` fabrique le voile lumineux et la tache au sol. Ce sont des
 *   noeuds Three.js, donc du ressort de la revue visuelle plutot que des
 *   tests — comme `renderer.ts`.
 *
 * Les valeurs visuelles ne sont pas ici mais dans `auraTheme.ts`.
 */

/** Ce que l arene doit montrer d une aura. Rien de tout cela n influe sur un score. */
export interface AuraLook {
  /** Identifiant de `@aura/content` ; inconnu ⇒ repli sur la Lueur. */
  readonly effectId: string;
  /** Couleur d aura, en `#rrggbb`. */
  readonly color: string;
  /** 0 eteinte, 1 pleine, jusqu a `AURA_PEAK` au sommet d un choc. */
  readonly intensity: number;
}

/**
 * L aura au repos, hors match.
 *
 * Assez pour qu on voie ce qu on essaie au vestiaire et ce qu on regarde en
 * boutique — c est la que la couleur d aura se vend —, pas assez pour manger
 * le personnage.
 *
 * Reglee a l oeil sur l accueil en 844x390 : a 0,35 le jeu qui s appelle Aura
 * Battle n en montrait aucune, quelques etincelles isolees. C est une valeur
 * de ressenti, pas une mesure : elle demandera d etre revue sur un vrai
 * appareil, ou la luminosite et la taille de l ecran ne sont pas celles-ci.
 */
export const IDLE_INTENSITY = 0.6;

/**
 * Sommet d une aura : l Ultime au choc.
 *
 * Le prototype laissait l intensite depasser 1 — jusqu a 2,1 au choc, 1,85
 * pour le vainqueur — et c est ce depassement qui faisait du choc le moment
 * le plus charge de l ecran. Borne a 1, le choc ne montrait pas plus d aura
 * que la revelation. 1,6 garde la gradation sans sortir du budget : deux
 * auras a ce sommet tiennent encore dans `ADDITIVE_CAPACITY` (voir le test).
 */
export const AURA_PEAK = 1.6;

/**
 * Tout ce dont l aura a besoin pour savoir quelle force afficher.
 *
 * **Regle d or n°4, et elle se joue dans cette signature.** Le palier joue est
 * secret jusqu a `round:result` : une aura qui gonflerait avec lui pendant la
 * phase de choix l annoncerait a l adversaire, sans qu aucun message reseau ne
 * change — donc sans qu une relecture du serveur ou du protocole puisse le
 * voir. Rien ici n est propre a un siege avant le choc : `hype` vient de la
 * seule phase et vaut pareil des deux cotes, et `clashWeight` ne devient non
 * nul qu une fois les deux choix publics. Ce qui n entre pas ne peut pas
 * sortir.
 */
export interface AuraDrive {
  /** Hors match : un seul personnage a l ecran. */
  readonly showcase: boolean;
  /** Ferveur du public, deduite de la phase seule (`HYPE_BY_PHASE`). */
  readonly hype: number;
  /** Poids du faisceau de ce siege pendant le choc, zero le reste du temps. */
  readonly clashWeight: number;
}

export function auraIntensity(drive: AuraDrive): number {
  if (drive.showcase) return IDLE_INTENSITY;
  // Le choc l emporte : c est le moment que tout l ecran prepare, et le seul
  // ou les deux auras ont le droit de ne pas se ressembler.
  // Un faisceau simple pese 1 et donne une aura pleine ; seuls le contre et
  // l Ultime la poussent au-dela.
  if (drive.clashWeight > 0) {
    return clamp(drive.clashWeight / BEAM_WEIGHT_ULTIMATE, 0, 1) * AURA_PEAK;
  }
  return clamp(drive.hype, 0, 1);
}

export interface AuraOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Plafond de particules vivantes par combattant, au palier le plus haut.
 *
 * Deux auras a fond, plus les anneaux et les eclairs qui se dessinent en
 * plusieurs points chacun, doivent tenir dans `ADDITIVE_CAPACITY`. C est le
 * garde-fou qui empeche une pause de l onglet, suivie d un rattrapage, de
 * faire exploser le nombre de sommets.
 *
 * La valeur vit dans `platform/quality.ts`, avec les trois autres leviers :
 * un palier plus bas la baisse aussi.
 */
export const AURA_BUDGET = QUALITY_PROFILES.rich.auraParticles;

/** Vitesse de rattrapage de l intensite affichee, reprise du prototype. */
const INTENSITY_RATE = 3.5;

/**
 * Ce qu un nouvel effet a deja vecu quand il apparait, en secondes.
 *
 * L effet du palier joue n arrive qu avec `round:result`, et la revelation ne
 * dure qu une seconde et demie. Parti de zero, l effet mettait l essentiel de
 * ce temps a se peupler — la Galaxie, dont les etoiles vivent deux secondes,
 * n avait pas fini d apparaitre qu elle etait deja remplacee. Il nait donc
 * deja en place, comme s il tournait depuis un moment.
 */
const WARM_SECONDS = 0.9;
const WARM_STEP = 1 / 20;

/** Points dessines pour un anneau : au sol, puis en ellipse verticale. */
const RING_GROUND_POINTS = 44;
const RING_BODY_POINTS = 26;

/** Sous-points par segment d eclair : un zigzag doit se lire comme un trait. */
const BOLT_SUBDIVISIONS = 5;

interface Particle {
  layer: AuraLayer;
  /** Position locale, en metres, l origine aux pieds du combattant. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** `orbit` : angle courant et vitesse angulaire. */
  angle: number;
  spin: number;
  /** `orbit` : rayon du disque. `ring` : rayon atteint en fin de vie. */
  radius: number;
  /** `orbit` : montee, en metres par seconde. */
  climb: number;
  size: number;
  life: number;
  max: number;
  tint: string;
  phase: number;
}

/** Poser un point : la seule chose qu une particule sait faire du monde exterieur. */
type Put = (x: number, y: number, z: number, color: string, alpha: number, size: number) => void;

interface Bolt {
  /** Points du zigzag, en coordonnees locales. */
  readonly points: number[];
  z: number;
  life: number;
  max: number;
}

export interface AuraEmitterOptions {
  /** Injecte pour que les tests soient reproductibles. */
  readonly rng?: () => number;
  readonly budget?: number;
  /** `prefers-reduced-motion` : moitie moins de particules, pas de scintillement. */
  readonly reducedMotion?: boolean;
}

export interface AuraEmitter {
  /** Style effectivement joue, apres repli sur la Lueur si l effet est inconnu. */
  readonly style: AuraStyle;
  readonly color: string;
  /** Intensite affichee, qui rattrape la cible demandee. */
  readonly intensity: number;
  readonly particleCount: number;
  readonly boltCount: number;
  /** Change d effet, de couleur ou d intensite cible. */
  set(look: AuraLook): void;
  setReducedMotion(reduced: boolean): void;
  /**
   * Plafond de particules vivantes, qu un palier de qualite abaisse.
   *
   * Le surplus n est pas tue : il meurt de lui-meme et rien ne renait
   * au-dela. Effacer des particules deja a l ecran ferait un trou visible
   * juste apres la bascule.
   */
  setBudget(next: number): void;
  /** Fait naitre, bouger et mourir les particules. */
  update(deltaSeconds: number): void;
  /** Pose l etat courant dans le puits a particules. Ne modifie rien. */
  draw(sink: ParticleSink, origin: AuraOrigin, elapsedSeconds: number): void;
  /** Vide l aura d un coup : changement de manche, retour a l accueil. */
  clear(): void;
}

export function createAuraEmitter(options: AuraEmitterOptions = {}): AuraEmitter {
  const rng = options.rng ?? Math.random;
  let budget = options.budget ?? AURA_BUDGET;

  const between = (range: Range): number => range.min + rng() * (range.max - range.min);

  let style = styleForEffect(undefined);
  let color = '#ffcf3f';
  let target = 0;
  let intensity = 0;
  let reducedMotion = options.reducedMotion ?? false;

  const particles: Particle[] = [];
  const bolts: Bolt[] = [];
  /** Accumulateurs d emission, un par couche du style courant. */
  let accumulators: number[] = [];
  let boltAccumulator = 0;
  /** Vrai entre un changement d effet et l image qui le fait naitre deja peuple. */
  let warmPending = false;

  const spawn = (layer: AuraLayer): void => {
    if (particles.length >= budget) return;

    const life = between(layer.life);
    const angle = rng() * Math.PI * 2;
    const spread = between(layer.spread);
    const speed = between(layer.speed);
    const drift = between(layer.drift);
    const tints = layer.tints;
    const tint = tints[Math.floor(rng() * tints.length)] ?? null;

    const particle: Particle = {
      layer,
      x: Math.cos(angle) * spread,
      y: between(layer.height) * FIGHTER_HEIGHT,
      z: Math.sin(angle) * spread,
      vx: 0,
      vy: 0,
      vz: 0,
      angle,
      spin: 0,
      radius: 0,
      climb: 0,
      size: between(layer.size),
      life,
      max: life,
      tint: tint ?? color,
      phase: rng() * Math.PI * 2,
    };

    switch (layer.shape) {
      case 'rise':
      case 'smoke':
        particle.vx = drift;
        particle.vy = speed;
        particle.vz = between(layer.drift);
        break;
      case 'burst': {
        // Une direction prise au hasard sur la sphere : l eclat electrique
        // part aussi bien vers le bas que vers le haut.
        const azimuth = rng() * Math.PI * 2;
        const polar = Math.acos(2 * rng() - 1);
        particle.vx = Math.sin(polar) * Math.cos(azimuth) * speed;
        particle.vy = Math.cos(polar) * speed;
        particle.vz = Math.sin(polar) * Math.sin(azimuth) * speed;
        break;
      }
      case 'orbit':
        particle.spin = speed;
        particle.radius = between(layer.radius);
        particle.climb = drift * FIGHTER_HEIGHT;
        particle.x = 0;
        particle.z = 0;
        break;
      case 'ring':
        particle.radius = between(layer.radius);
        particle.x = 0;
        particle.y = 0;
        particle.z = 0;
        break;
    }

    particles.push(particle);
  };

  const spawnBolt = (): void => {
    const spec = style.bolts;
    if (spec === null) return;
    const points: number[] = [];
    const x0 = (rng() - 0.5) * 0.36;
    const y0 = between(spec.start) * FIGHTER_HEIGHT;
    const x1 = (rng() - 0.5) * 2 * spec.reach;
    const y1 = -0.04 + rng() * 0.44;
    for (let i = 0; i <= spec.segments; i++) {
      const u = i / spec.segments;
      const inner = i > 0 && i < spec.segments;
      points.push(x0 + (x1 - x0) * u + (inner ? (rng() - 0.5) * 2 * spec.jitter : 0));
      points.push(y0 + (y1 - y0) * u);
    }
    bolts.push({ points, z: (rng() - 0.5) * 0.4, life: spec.life, max: spec.life });
  };

  /** Retire en echangeant avec le dernier : pas de tableau reconstruit par image. */
  const prune = <T extends { life: number }>(list: T[]): void => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.life > 0) continue;
      const last = list.pop()!;
      if (i < list.length) list[i] = last;
    }
  };

  return {
    get style() {
      return style;
    },
    get color() {
      return color;
    },
    get intensity() {
      return intensity;
    },
    get particleCount() {
      return particles.length;
    },
    get boltCount() {
      return bolts.length;
    },

    set(look): void {
      const next = styleForEffect(look.effectId);
      if (next.id !== style.id) {
        // Changer d effet en gardant les particules de l ancien melangerait
        // deux vocabulaires : on repart de zero, comme `setAnim` du prototype.
        style = next;
        particles.length = 0;
        bolts.length = 0;
        accumulators = style.layers.map(() => 0);
        boltAccumulator = 0;
        warmPending = true;
      }
      color = look.color;
      target = clamp(look.intensity, 0, AURA_PEAK);
    },

    setBudget(next): void {
      budget = Math.max(0, Math.floor(next));
    },

    setReducedMotion(reduced): void {
      reducedMotion = reduced;
    },

    update(delta): void {
      if (delta <= 0) return;
      intensity += (target - intensity) * damp(INTENSITY_RATE, delta);

      if (warmPending) {
        warmPending = false;
        // Peuple a la cible, pas a l intensite affichee : c est ce que l effet
        // montrera une fois installe. L intensite affichee, elle, garde son
        // rattrapage — le voile continue de monter en douceur.
        for (let t = 0; t < WARM_SECONDS; t += WARM_STEP) simulate(WARM_STEP, target);
      }
      simulate(delta, intensity);
    },

    draw(sink, origin, elapsed): void {
      drawInto(sink, origin, elapsed);
    },

    clear(): void {
      particles.length = 0;
      bolts.length = 0;
      accumulators = style.layers.map(() => 0);
      boltAccumulator = 0;
      intensity = 0;
      target = 0;
      warmPending = false;
    },
  };

  function simulate(delta: number, emitAt: number): void {
    if (accumulators.length !== style.layers.length) {
      accumulators = style.layers.map(() => 0);
    }

    // Moins de matiere quand l utilisateur demande moins d animation ; le
    // vocabulaire de l effet reste le meme, il est juste moins dense.
    const density = reducedMotion ? 0.5 : 1;

    style.layers.forEach((layer, index) => {
      let accumulator = (accumulators[index] ?? 0) + layer.rate * emitAt * density * delta;
      // Un onglet revenu au premier plan livre un grand `delta` : sans cette
      // borne, on ferait naitre des milliers de particules d un coup.
      if (accumulator > budget) accumulator = budget;
      while (accumulator >= 1) {
        accumulator -= 1;
        spawn(layer);
      }
      accumulators[index] = accumulator;
    });

    const spec = style.bolts;
    if (spec !== null && emitAt >= spec.minIntensity) {
      boltAccumulator += spec.rate * emitAt * density * delta;
      if (boltAccumulator > 8) boltAccumulator = 8;
      while (boltAccumulator >= 1) {
        boltAccumulator -= 1;
        spawnBolt();
      }
    }

    for (const particle of particles) {
      particle.life -= delta;
      switch (particle.layer.shape) {
        case 'orbit':
          particle.angle += particle.spin * delta;
          particle.y += particle.climb * delta;
          break;
        case 'ring':
          break;
        default:
          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;
          particle.z += particle.vz * delta;
          break;
      }
    }
    prune(particles);

    for (const bolt of bolts) bolt.life -= delta;
    prune(bolts);
  }

  function drawInto(sink: ParticleSink, origin: AuraOrigin, elapsed: number): void {
    // Deux enveloppes par image, pas par particule : `sink.add` passe en
    // valeur perdrait son `this` le jour ou un puits deviendra une classe.
    const additive: Put = (x, y, z, c, a, s) => {
      sink.add(x, y, z, c, a, s);
    };
    const opaque: Put = (x, y, z, c, a, s) => {
      sink.dark(x, y, z, c, a, s);
    };

    for (const particle of particles) {
      const layer = particle.layer;
      // `k` va de 1 a la naissance a 0 a la mort : c est le fondu.
      const k = Math.max(0, particle.life / particle.max);
      const put = layer.additive ? additive : opaque;

      let size = particle.size;
      if (layer.shrink) size *= 0.35 + 0.65 * k;
      if (layer.grow > 0) size *= 1 + (1 - k) * layer.grow;

      // Une orbite garde son eclat les deux premiers tiers de sa vie, comme
      // au prototype : fondue lineairement, une etoile qui tourne passait
      // la moitie de son tour a moitie eteinte.
      let alpha = layer.alpha * (layer.shape === 'orbit' ? Math.min(1, k * 1.5) : k);
      if (layer.twinkle && !reducedMotion) {
        alpha *= 0.5 + 0.5 * Math.sin(elapsed * 6 + particle.phase);
      }

      // Le coeur d une flamme est blanc a la naissance, puis prend la
      // couleur du joueur : c est ce qui la fait lire comme du feu.
      const tint = layer.coreTint !== null && k > 0.65 ? layer.coreTint : particle.tint;

      switch (layer.shape) {
        case 'orbit': {
          const radius = particle.radius;
          const cos = Math.cos(particle.angle);
          const sin = Math.sin(particle.angle);
          put(
            origin.x + cos * radius,
            origin.y + particle.y + sin * radius * Math.sin(layer.tilt),
            origin.z + sin * radius * Math.cos(layer.tilt),
            tint,
            alpha,
            size,
          );
          break;
        }
        case 'ring': {
          // L anneau s ouvre vite puis ralentit, et se double d une ellipse
          // verticale : au sol seul, il disparait des que la camera baisse.
          const radius = easeOut(1 - k) * particle.radius;
          for (let i = 0; i < RING_GROUND_POINTS; i++) {
            const a = (i / RING_GROUND_POINTS) * Math.PI * 2;
            put(
              origin.x + Math.cos(a) * radius,
              origin.y + 0.02,
              origin.z + Math.sin(a) * radius,
              tint,
              alpha * 0.9,
              size,
            );
          }
          for (let i = 0; i < RING_BODY_POINTS; i++) {
            const a = (i / RING_BODY_POINTS) * Math.PI * 2;
            put(
              origin.x + Math.cos(a) * radius * 0.55,
              origin.y + FIGHTER_HEIGHT * 0.5 + Math.sin(a) * radius * 0.75,
              origin.z,
              tint,
              alpha * 0.35,
              size * 0.82,
            );
          }
          break;
        }
        default:
          put(
            origin.x + particle.x,
            origin.y + particle.y,
            origin.z + particle.z,
            tint,
            alpha,
            size,
          );
          break;
      }
    }

    for (const bolt of bolts) {
      const k = Math.max(0, bolt.life / bolt.max);
      for (let i = 0; i < bolt.points.length - 2; i += 2) {
        const ax = bolt.points[i]!;
        const ay = bolt.points[i + 1]!;
        const bx = bolt.points[i + 2]!;
        const by = bolt.points[i + 3]!;
        for (let s = 0; s < BOLT_SUBDIVISIONS; s++) {
          const u = s / BOLT_SUBDIVISIONS;
          const x = origin.x + ax + (bx - ax) * u;
          const y = origin.y + ay + (by - ay) * u;
          const z = origin.z + bolt.z;
          // Un halo a la couleur du joueur, un coeur blanc plus fin : sans
          // le coeur, l eclair se lit comme un trait de peinture.
          sink.add(x, y, z, color, 0.8 * k, 0.08);
          sink.add(x, y, z, '#ffffff', k, 0.03);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Voile lumineux et tache au sol
 * ------------------------------------------------------------------ */

/**
 * Au-dela, le voile cesse de grandir.
 *
 * L intensite monte jusqu a `AURA_PEAK` pour les particules ; un voile qui la
 * suivrait jusque-la ferait trois metres cinquante de haut, deux combattants
 * de haut, et avalerait l adversaire.
 */
const GLOW_GROWTH_CAP = 1.25;

/** Echelle du voile, en largeur et en hauteur. Porte du prototype. */
export function haloScale(intensity: number): readonly [number, number] {
  const i = clamp(intensity, 0, GLOW_GROWTH_CAP);
  return [1.3 + 0.75 * i, 2 + 0.95 * i];
}

export function floorScale(intensity: number): number {
  return 1.1 + 0.5 * clamp(intensity, 0, GLOW_GROWTH_CAP);
}

/**
 * Opacite du voile et de la tache au sol.
 *
 * Pleine des 1 : au-dela, c est la matiere (les particules) qui dit le choc,
 * pas un voile qui blanchirait le combattant.
 */
export function glowOpacity(base: number, intensity: number): number {
  return base * clamp(intensity, 0, 1);
}

export interface AuraGlowResources {
  /** Degrade radial blanc, peint au canvas (`textures.ts`). */
  readonly texture: Texture;
}

export interface AuraGlow {
  readonly group: Group;
  /** Suit le combattant et son intensite. `origin` est au niveau des pieds. */
  update(emitter: AuraEmitter, origin: AuraOrigin): void;
  dispose(): void;
}

/**
 * Le voile derriere le combattant et la tache de lumiere sous ses pieds.
 *
 * Deux surfaces, pas une lumiere ponctuelle : depuis r155 l attenuation en
 * inverse du carre est permanente, une `PointLight` reglee comme celle du
 * prototype brulerait tout a un metre et s eteindrait au-dela. Et surtout, une
 * lumiere de plus se paie sur **tous** les materiaux de la scene, foule de deux
 * cent dix personnes comprise. Deux quadrilateres additifs coutent deux appels
 * de dessin et donnent la meme lecture.
 *
 * Noeuds Three.js : non couverts par les tests, comme `renderer.ts`. Les
 * quelques calculs qui valaient d etre verifies sont sortis en fonctions pures
 * juste au-dessus.
 */
export function createAuraGlow(resources: AuraGlowResources): AuraGlow {
  const group = new Group();
  group.name = 'aura-glow';

  const haloMaterial = new SpriteMaterial({
    map: resources.texture,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Le voile appartient au combattant, pas a la salle : le brouillard
    // violet de la scene le ferait disparaitre dans le decor.
    fog: false,
  });
  const halo = new Sprite(haloMaterial);
  halo.name = 'aura-halo';

  const floorGeometry = new PlaneGeometry(1, 1);
  const floorMaterial = new MeshBasicMaterial({
    map: resources.texture,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = 'aura-floor';
  floor.rotation.x = -Math.PI / 2;

  group.add(halo, floor);

  let disposed = false;
  let tinted = '';

  return {
    group,

    update(emitter, origin): void {
      /*
        Le voile prend la couleur d aura, comme au prototype.

        Le portage l avait laisse blanc : une tache laiteuse derriere chaque
        combattant, la meme pour tout le monde, qui palissait l aura au lieu
        de la porter. Repeint seulement quand la couleur change.
      */
      if (emitter.color !== tinted) {
        tinted = emitter.color;
        haloMaterial.color.set(tinted);
        floorMaterial.color.set(tinted);
      }
      const intensity = emitter.intensity;
      const [width, height] = haloScale(intensity);

      /**
       * Le voile passe **derriere** le combattant.
       *
       * Le prototype le reculait le long de l axe de la camera ; ici la camera
       * reste devant l arene, et un simple recul en z suffit — sans dependre
       * d une position de camera qu il faudrait passer a chaque image.
       */
      halo.position.set(origin.x, origin.y + height * 0.42, origin.z - 0.45);
      halo.scale.set(width, height, 1);
      haloMaterial.opacity = glowOpacity(emitter.style.haloOpacity, intensity);
      halo.visible = haloMaterial.opacity > 0.01;

      const spread = floorScale(intensity) * 2.2;
      // Deux millimetres au-dessus de la plateforme : au meme niveau, les deux
      // surfaces se disputent le plan et scintillent.
      floor.position.set(origin.x, 0.006, origin.z);
      floor.scale.set(spread, spread, 1);
      floorMaterial.opacity = glowOpacity(emitter.style.floorOpacity, intensity);
      floor.visible = floorMaterial.opacity > 0.01;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      floorGeometry.dispose();
      floorMaterial.dispose();
      haloMaterial.dispose();
      group.clear();
    },
  };
}
