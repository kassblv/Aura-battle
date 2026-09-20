import { SKIN_TONES } from '@aura/content';
import { clamp } from './math.js';

/**
 * Ce que decide la foule, sans Three.js.
 *
 * `crowd.ts` construit les noeuds et ecrit les matrices ; tout ce qui se
 * **decide** — ou se tient chacun, qui filme, quand un bras monte, quand un
 * ecran s allume — vit ici, en fonctions pures qu un test peut interroger
 * image par image sans carte graphique.
 */

/** Doit suivre `stage.ts` : c est la meme tribune. */
const TIER_COUNT = 4;
const TIER_HEIGHT = 0.42;
const FLOOR_Y = -0.45;
const STANDS_START = Math.PI * 1.5 + 0.9;
const STANDS_ARC = Math.PI * 2 - 1.8;
const TIER_INNER = 4.2;
const TIER_DEPTH = 0.9;

/** Hauteur des epaules au-dessus de la marche, a l echelle 1. */
const SHOULDER = 0.3;

export const CROWD_SIZE = 210;

/**
 * Le premier cercle : ceux qui sont debout au bord du trace.
 *
 * Une aura battle n a pas de gradins, elle a un cercle que la foule dessine
 * elle-meme en se serrant autour. Ces places-la se tiennent **au sol**, en
 * avant des marches et de part et d autre du cadre : plus grandes, plus
 * sombres, elles donnent la couche proche qui manquait entre la plateforme et
 * le fond.
 *
 * Elles ne coutent aucun appel de dessin : ce sont des places comme les autres
 * dans les memes `InstancedMesh`.
 *
 * Un vrai premier plan — quelqu un de dos entre l objectif et les combattants
 * — a ete essaye et retire. La camera se rapproche jusqu a 2,6 m et se decale
 * sur le vainqueur a la revelation : la silhouette tombait alors en travers du
 * combattant, au moment precis ou il faut le lire. Et les deux bas de cadre
 * appartiennent aux arcs de pouce (ADR 0008), donc a l interface.
 */
export const RING_SIZE = 18;

/** Ouverture du premier cercle, en radians depuis l axe de la camera. */
const RING_FROM = 1.35;
const RING_TO = 2.1;
const RING_INNER = 3.4;
const RING_SPREAD = 0.7;

/**
 * Part des spectateurs qui filment.
 *
 * C est l image signature de la tendance, et elle remplace les batons
 * lumineux du portage initial : en 2026, une foule de rue ne brandit pas des
 * batons fluorescents, elle brandit des telephones.
 */
const FILMING_SHARE = 0.46;

/** Distance de la camera au repos (`camera.ts`), vers laquelle les ecrans rayonnent. */
const CAMERA_REST_Z = 4.7;

/** Teinte d un vetement, en TSL : `crowd.ts` la pose sur une couleur. */
export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

export interface CrowdSeat {
  readonly x: number;
  readonly z: number;
  /** Hauteur des epaules au repos, en metres. */
  readonly y: number;
  /** Distance au centre : elle retarde la vague de reaction. */
  readonly radius: number;
  /** Taille relative. Le premier cercle est a l echelle des combattants. */
  readonly scale: number;
  readonly phase: number;
  readonly speed: number;
  readonly lean: number;
  /**
   * 0 a 1 : a quel point ce spectateur se leve.
   *
   * Une tribune ou tout le monde reagit pareil se lit comme une machine. Les
   * tiedes restent assis pendant que les fous montent sur leur siege.
   */
  readonly eagerness: number;
  readonly cloth: Hsl;
  readonly skin: string;
  /** Vrai s il tient son telephone braque sur le duel. */
  readonly filming: boolean;
  /** Orientation du dos du telephone : vers le centre de l arene. */
  readonly facing: number;
  /** Orientation du halo d ecran : vers la camera au repos. */
  readonly glowFacing: number;
  /** Teinte de l ecran, en TSL : des blancs bleus, quelques chauds. */
  readonly screen: Hsl;
  /**
   * Attenuation de l ecran avec la distance, entre 0 et 1.
   *
   * Un halo additif ne peut pas etre mange par le brouillard — melanger vers
   * la couleur de brume **ajoute** cette couleur au lieu de l effacer, et le
   * fond du stade deviendrait plus lumineux que le premier rang. La
   * profondeur est donc peinte dans la couleur de l instance.
   */
  readonly reach: number;
  readonly flashPhase: number;
  /** Vrai pour le premier cercle, debout au sol devant les marches. */
  readonly ring: boolean;
}

/** Vitesse de propagation de la vague, en radians par metre. */
const WAVE_SPREAD = 0.55;

/** Un spectateur qui filme garde le bras haut, ferveur ou pas. */
const FILMING_RAISE = 0.78;

/** Eclats d objectif par seconde, et part du cycle ou l eclat est visible. */
const FLASH_RATE = 0.31;
const FLASH_DUTY = 0.09;

export interface SeatMotion {
  /** Hauteur du buste, en metres. */
  readonly y: number;
  readonly lean: number;
  /** 0 a 1 : bras le long du corps, ou au-dessus de la tete. */
  readonly raiseLeft: number;
  readonly raiseRight: number;
  /** Luminosite de l ecran, entre 0 et 1. */
  readonly screen: number;
  /** Eclat d objectif en cours, entre 0 et 1 : il grossit le halo. */
  readonly flash: number;
}

/**
 * Ou se tient chaque spectateur.
 *
 * Deux populations dans une seule liste : les marches, puis le premier cercle.
 * Elles partagent les memes `InstancedMesh`, donc les memes appels de dessin.
 */
export function buildSeats(rng: () => number, size = CROWD_SIZE): readonly CrowdSeat[] {
  const seats: CrowdSeat[] = [];
  const stands = Math.max(0, size - RING_SIZE);

  for (let i = 0; i < stands; i++) {
    const tier = i % TIER_COUNT;
    // Meme repere que les marches : l anneau est tourne de -90 degres autour
    // de x, donc l angle se lit en (cos, -sin) dans le plan du sol.
    const angle = STANDS_START + rng() * STANDS_ARC;
    const radius = TIER_INNER + tier * TIER_DEPTH + 0.2 + rng() * (TIER_DEPTH - 0.4);
    const x = Math.cos(angle) * radius;
    const z = -Math.sin(angle) * radius;

    seats.push(
      seat({
        x,
        z,
        y: FLOOR_Y + (tier + 1) * TIER_HEIGHT + SHOULDER,
        scale: 1,
        rng,
        ring: false,
      }),
    );
  }

  for (let i = 0; i < Math.min(RING_SIZE, size); i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const step = Math.floor(i / 2) / Math.max(1, Math.ceil(RING_SIZE / 2) - 1);
    /*
      Sur les cotes, jamais au milieu.

      L angle se compte depuis l axe de la camera : de 77 a 120 degres, le
      cercle longe les bords de l image et passe derriere les combattants sans
      jamais croiser la ligne qui va de l objectif a eux.
    */
    const angle = RING_FROM + step * (RING_TO - RING_FROM) + (rng() - 0.5) * 0.12;
    const radius = RING_INNER + rng() * RING_SPREAD;
    const scale = 1.3 + rng() * 0.22;

    seats.push({
      ...seat({
        x: side * Math.sin(angle) * radius,
        z: Math.cos(angle) * radius,
        // Debout sur le bitume, pas sur une marche : c est ce qui les
        // distingue des gradins, et ce qui creuse la profondeur.
        y: FLOOR_Y + SHOULDER * scale,
        scale,
        rng,
        ring: true,
      }),
      // Contre-jour : de pres et de dos, on ne lit qu une masse sombre.
      cloth: { h: 0.68 + rng() * 0.08, s: 0.3, l: 0.018 + rng() * 0.022 },
    });
  }

  return seats;
}

function seat(input: {
  x: number;
  z: number;
  y: number;
  scale: number;
  rng: () => number;
  ring: boolean;
}): CrowdSeat {
  const { x, z, y, scale, rng, ring } = input;
  const radius = Math.hypot(x, z);
  const warmScreen = rng() < 0.22;

  return {
    x,
    z,
    y,
    radius,
    scale,
    phase: rng() * Math.PI * 2,
    speed: 1.9 + rng() * 1.6,
    lean: (rng() - 0.5) * 0.24,
    eagerness: rng(),
    // Sombre et peu sature : la foule est un fond, pas un sujet. Le portage
    // initial la peignait aussi claire que les combattants, et deux cent dix
    // taches violettes disputaient le regard aux deux seules choses a lire.
    cloth: { h: 0.66 + rng() * 0.16, s: 0.22 + rng() * 0.24, l: 0.055 + rng() * 0.06 },
    skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)] ?? '#f3cfae',
    filming: rng() < FILMING_SHARE,
    facing: Math.atan2(-x, -z),
    glowFacing: Math.atan2(-x, CAMERA_REST_Z - z),
    screen: warmScreen
      ? { h: 0.09, s: 0.5, l: 0.72 }
      : { h: 0.56 + rng() * 0.06, s: 0.28, l: 0.82 },
    reach: clamp(1.15 - radius * 0.075, 0.28, 1),
    flashPhase: rng(),
    ring,
  };
}

/** Ce que fait un spectateur a cet instant. Fonction pure. */
export function seatMotion(seat: CrowdSeat, elapsed: number, hype: number): SeatMotion {
  const h = clamp(hype, 0, 1);
  /*
    La vague part du centre et gagne le fond.

    Un public dont les deux cent dix corps montent sur le meme temps se lit
    comme un seul objet qui pulse. Retarder la phase avec le rayon transforme
    le meme calcul en ola : la reaction nait chez les combattants et se
    propage, ce qui est exactement ce que fait une vraie foule.
  */
  const wave = Math.sin(elapsed * seat.speed + seat.phase - seat.radius * WAVE_SPREAD);
  const zeal = 0.45 + seat.eagerness * 0.85;

  const raise = clamp(h * zeal, 0, 1) * (0.55 + 0.45 * wave);
  // Celui qui filme ne baisse pas son telephone entre deux manches.
  const raiseRight = seat.filming ? Math.max(FILMING_RAISE + wave * 0.05, raise) : raise;

  const cycle = (elapsed * FLASH_RATE + seat.flashPhase) % 1;
  const flash = cycle < FLASH_DUTY ? (1 - cycle / FLASH_DUTY) * h : 0;
  const shimmer = 0.6 + 0.12 * Math.sin(elapsed * 2.3 + seat.flashPhase * Math.PI * 2);

  return {
    y: seat.y + Math.abs(wave) * (0.03 + h * 0.19 * zeal) * seat.scale,
    lean: seat.lean + wave * 0.06,
    raiseLeft: raise,
    raiseRight,
    screen: clamp(shimmer + flash * 0.4, 0, 1) * seat.reach,
    flash,
  };
}
