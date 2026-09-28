import { easeOut } from './math.js';
import type { ParticleSink } from './particles.js';

/**
 * Les effets ponctuels de l arene : gerbes d etincelles et ondes de choc.
 *
 * Port de la liste `fx` du prototype (`sparkBurst`, `ringFx`, `updateFx`, et la
 * boucle `for(const q of fx)` de `fillParticles`). Contrairement aux auras, ces
 * effets n appartiennent a personne : ils naissent d un evenement — une
 * revelation, un contact — et meurent seuls.
 *
 * Aucun noeud Three.js ici. Tout se pose dans un `ParticleSink`, c est-a-dire
 * dans les deux memes tampons que le reste de l arene : **zero appel de dessin
 * supplementaire**, quel que soit le nombre d effets a l ecran.
 *
 * Les longueurs du prototype sont exprimees en unites logiques, qui valent un
 * centimetre chacune (`K3 = .01`). Elles sont converties ici une fois pour
 * toutes, en metres.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Plafond d effets vivants.
 *
 * Le pire cas tient largement dessous — un Ultime revele, c est quatre-vingts
 * etincelles et deux anneaux. Ce plafond n est la que pour le cas pathologique :
 * un onglet revenu au premier plan qui livrerait plusieurs evenements d un coup.
 */
export const FX_BUDGET = 320;

/** Nombre de points dessines sur le tour d un anneau. Repris du prototype. */
const RING_POINTS = 48;
/** Taille d un point d anneau, en metres. */
const RING_POINT_SIZE = 0.05;

/** Duree de vie d une onde de choc, en secondes. */
const RING_LIFE = 0.6;

/** Freinage de l air sur une etincelle, par seconde. */
const SPARK_DRAG = 3.2;
/** Pesanteur ressentie par une etincelle, en metres par seconde carree. */
const SPARK_GRAVITY = 1.1;

interface Spark {
  readonly kind: 'spark';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  readonly size: number;
  readonly color: string;
  life: number;
  readonly max: number;
}

interface Ring {
  readonly kind: 'ring';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  /** `ground` : a plat sur la plateforme. `upright` : face a la camera. */
  readonly plane: RingPlane;
  readonly color: string;
  readonly size: number;
  life: number;
  readonly max: number;
}

export type RingPlane = 'ground' | 'upright';

type Effect = Spark | Ring;

export interface SparkBurstOptions {
  /** Nombre d etincelles. */
  readonly count: number;
  /** Couleurs parcourues a tour de role, comme dans le prototype. */
  readonly colors: readonly string[];
  /** Vitesse de depart, en metres par seconde. */
  readonly speed: number;
}

export interface RingOptions {
  readonly color: string;
  /** Rayon atteint en fin de vie, en metres. */
  readonly radius: number;
  readonly plane: RingPlane;
  /** Opacite de depart. Un anneau discret sert de rappel, pas d evenement. */
  readonly alpha?: number;
}

export interface FxPool {
  readonly count: number;
  /** Une gerbe d etincelles, projetee dans toutes les directions. */
  spark(origin: Vec3, options: SparkBurstOptions): void;
  /** Une onde de choc qui s ouvre vite puis ralentit. */
  ring(origin: Vec3, options: RingOptions): void;
  update(deltaSeconds: number): void;
  draw(sink: ParticleSink): void;
  clear(): void;
}

export interface FxPoolOptions {
  /** Injecte pour que les tests soient reproductibles. */
  readonly rng?: () => number;
  readonly budget?: number;
}

export function createFxPool(options: FxPoolOptions = {}): FxPool {
  const rng = options.rng ?? Math.random;
  const budget = options.budget ?? FX_BUDGET;
  const effects: Effect[] = [];

  const between = (min: number, max: number): number => min + rng() * (max - min);

  const push = (effect: Effect): void => {
    // On sacrifie les plus anciens : ce qui vient d arriver est ce que le
    // joueur regarde.
    if (effects.length >= budget) effects.shift();
    effects.push(effect);
  };

  return {
    get count() {
      return effects.length;
    },

    spark(origin, burst): void {
      for (let i = 0; i < burst.count; i++) {
        // Une direction tiree uniformement sur la sphere : `acos` d un tirage
        // plat, sinon les etincelles s agglutinent aux poles.
        const azimuth = between(0, Math.PI * 2);
        const polar = Math.acos(between(-1, 1));
        const speed = between(0.3, 1) * burst.speed;
        const life = between(0.4, 0.9);
        push({
          kind: 'spark',
          x: origin.x,
          y: origin.y,
          z: origin.z,
          vx: Math.sin(polar) * Math.cos(azimuth) * speed,
          vy: Math.cos(polar) * speed,
          vz: Math.sin(polar) * Math.sin(azimuth) * speed,
          size: between(0.03, 0.06),
          color: burst.colors[i % burst.colors.length] ?? '#ffffff',
          life,
          max: life,
        });
      }
    },

    ring(origin, ringOptions): void {
      push({
        kind: 'ring',
        x: origin.x,
        y: origin.y,
        z: origin.z,
        radius: ringOptions.radius,
        plane: ringOptions.plane,
        color: ringOptions.color,
        size: RING_POINT_SIZE * (ringOptions.alpha ?? 1),
        life: RING_LIFE,
        max: RING_LIFE,
      });
    },

    update(delta): void {
      if (delta <= 0) return;
      const drag = Math.exp(-SPARK_DRAG * delta);
      for (const effect of effects) {
        effect.life -= delta;
        if (effect.kind !== 'spark') continue;
        effect.x += effect.vx * delta;
        effect.y += effect.vy * delta;
        effect.z += effect.vz * delta;
        effect.vx *= drag;
        effect.vz *= drag;
        effect.vy = effect.vy * drag - SPARK_GRAVITY * delta;
      }
      // Retire en echangeant avec le dernier : pas de tableau reconstruit par
      // image, comme dans `aura.ts`.
      for (let i = effects.length - 1; i >= 0; i--) {
        if (effects[i]!.life > 0) continue;
        const last = effects.pop()!;
        if (i < effects.length) effects[i] = last;
      }
    },

    draw(sink): void {
      for (const effect of effects) {
        const k = Math.max(0, effect.life / effect.max);
        if (effect.kind === 'spark') {
          // L etincelle retrecit en mourant : sans cela, elle s eteint en
          // restant grosse et se lit comme un point qui disparait.
          sink.add(effect.x, effect.y, effect.z, effect.color, k, effect.size * (0.5 + 0.5 * k));
          continue;
        }

        const radius = easeOut(1 - k) * effect.radius;
        for (let i = 0; i < RING_POINTS; i++) {
          const angle = (i / RING_POINTS) * Math.PI * 2;
          const cos = Math.cos(angle) * radius;
          const sin = Math.sin(angle) * radius;
          /*
            L anneau dresse tient dans le plan XY plutot que face a la camera.

            Le prototype le billboardait avec les colonnes de la matrice de la
            camera ; ici la camera reste devant l arene, a quelques degres pres,
            et un plan fixe evite de lui passer son orientation a chaque image.
          */
          const x = effect.x + cos;
          const y = effect.plane === 'ground' ? effect.y : effect.y + sin;
          const z = effect.plane === 'ground' ? effect.z + sin : effect.z;
          sink.add(x, y, z, effect.color, k, effect.size);
        }
      }
    },

    clear(): void {
      effects.length = 0;
    },
  };
}
