/**
 * Les valeurs visuelles des auras (port de « Particules d aura » du prototype).
 *
 * Tout ce qui se regle a l oeil vit ici : cadences, tailles, durees, teintes.
 * `aura.ts` ne contient que le comportement, et ne connait aucun de ces
 * nombres. C est ce que demande la skill `port-prototype` — et c est ce qui
 * permet d ajouter un neuvieme effet sans toucher une ligne de simulation.
 *
 * Un effet d aura est un **cosmetique** (regle d or n°3) : rien ici ne touche
 * un score. Le catalogue vendeur est `@aura/content`, cette table n en est que
 * l habillage.
 */

export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * Les cinq facons de bouger qu une particule connait.
 *
 * - `rise`  : monte en derivant, la braise et l etincelle ;
 * - `burst` : part dans une direction quelconque, l eclat electrique ;
 * - `orbit` : tourne autour du combattant sur un disque eventuellement incline ;
 * - `ring`  : anneau qui s ouvre au sol, dessine point par point ;
 * - `smoke` : comme `rise`, mais grossit et se dessine en noir opaque.
 */
export type AuraShape = 'rise' | 'burst' | 'orbit' | 'ring' | 'smoke';

export interface AuraLayer {
  readonly shape: AuraShape;
  /** Cadence propre a la couche, en particules par seconde a intensite 1. */
  readonly rate: number;
  /** Duree de vie, en secondes. */
  readonly life: Range;
  /** Rayon dessine, en metres. */
  readonly size: Range;
  /** Hauteur de naissance, en fraction de la taille du combattant. */
  readonly height: Range;
  /** Rayon horizontal de naissance, en metres. */
  readonly spread: Range;
  /** `rise`/`burst`/`smoke` : vitesse verticale (m/s). `orbit` : vitesse angulaire (rad/s). */
  readonly speed: Range;
  /** `rise`/`smoke` : derive laterale (m/s). `orbit` : montee (fraction de hauteur par seconde). */
  readonly drift: Range;
  /** `orbit` : rayon du disque. `ring` : rayon atteint en fin de vie. En metres. */
  readonly radius: Range;
  /** `orbit` : inclinaison du disque, en radians. */
  readonly tilt: number;
  /** Opacite de depart, avant l attenuation par la duree de vie restante. */
  readonly alpha: number;
  /** Teintes possibles ; `null` reprend la couleur d aura du joueur. */
  readonly tints: readonly (string | null)[];
  /** Teinte des premiers instants — le coeur blanc d une flamme. */
  readonly coreTint: string | null;
  /** Grossissement en fin de vie : 0 = taille constante (la fumee vaut 1,3). */
  readonly grow: number;
  /** Retrecissement en fin de vie : la flamme s affine en montant. */
  readonly shrink: boolean;
  /** Scintillement : l etoile s allume et s eteint pendant sa course. */
  readonly twinkle: boolean;
  /** Faux = rendu sombre et opaque (la fumee), vrai = rendu additif. */
  readonly additive: boolean;
}

export interface AuraBolts {
  /** Eclairs par seconde a intensite 1. */
  readonly rate: number;
  /** En dessous de cette intensite, aucun eclair : la galaxie ne craque qu a fond. */
  readonly minIntensity: number;
  readonly life: number;
  /** Hauteur de depart, en fraction de la taille du combattant. */
  readonly start: Range;
  /** Portee horizontale, en metres. */
  readonly reach: number;
  readonly segments: number;
  /** Amplitude du zigzag, en metres. */
  readonly jitter: number;
}

export interface AuraStyle {
  readonly id: string;
  readonly layers: readonly AuraLayer[];
  readonly bolts: AuraBolts | null;
  /** Voile lumineux derriere le combattant : opacite a intensite 1. */
  readonly haloOpacity: number;
  /** Tache de lumiere au sol : opacite a intensite 1. */
  readonly floorOpacity: number;
}

/**
 * Taille de reference d un combattant, en metres.
 *
 * Le prototype travaillait en pixels logiques (`height: 164`) ; le rig, lui,
 * est deja en metres. Les hauteurs de naissance sont donc exprimees en
 * fraction, et cette constante fait la conversion une fois pour toutes.
 */
export const FIGHTER_HEIGHT = 1.65;

const r = (min: number, max: number): Range => Object.freeze({ min, max });

const ZERO = r(0, 0);

/** Complete une couche : seuls les champs qui comptent pour sa forme sont ecrits. */
function layer(
  spec: Partial<AuraLayer> & Pick<AuraLayer, 'shape' | 'rate' | 'life' | 'size'>,
): AuraLayer {
  return Object.freeze({
    height: ZERO,
    spread: ZERO,
    speed: ZERO,
    drift: ZERO,
    radius: ZERO,
    tilt: 0,
    alpha: 1,
    tints: [null],
    coreTint: null,
    grow: 0,
    shrink: false,
    twinkle: false,
    additive: true,
    ...spec,
  });
}

/** Teintes d etoiles de la galaxie : froides, pour trancher avec l aura du joueur. */
const STAR_TINTS: readonly (string | null)[] = Object.freeze([
  null,
  null,
  '#ffffff',
  '#9fd8ff',
  '#c9a8ff',
  '#ff9fd8',
]);

/**
 * Les huit effets.
 *
 * Chacun doit se reconnaitre en un coup d oeil sur un ecran de telephone, ce
 * qui veut dire : une silhouette de mouvement differente, pas seulement une
 * couleur differente. D ou le partage explicite du vocabulaire —
 *
 * | effet     | ce qu on lit                                   |
 * |-----------|------------------------------------------------|
 * | Lueur     | nuage lent et large, rien ne file              |
 * | Étincelles| grains rapides et fins qui montent             |
 * | Flammes   | langues larges au coeur blanc, depuis les pieds|
 * | Éclairs   | eclats dans tous les sens + zigzags            |
 * | Onde      | anneaux au sol qui s ouvrent, rythmes          |
 * | Vortex    | helice serree et rapide autour du corps        |
 * | Aura noire| fumee noire qui grossit, quelques braises      |
 * | Galaxie   | disque large et incline, etoiles scintillantes |
 */
const STYLES: readonly AuraStyle[] = Object.freeze([
  {
    id: 'fx.glow',
    // Le prototype n emettait rien pour la lueur : une aura invisible. On lui
    // donne un nuage lent et large — l effet offert doit rester le plus calme
    // de tous, pas le plus vide.
    layers: [
      layer({
        shape: 'rise',
        rate: 22,
        life: r(1.2, 2.2),
        size: r(0.1, 0.19),
        height: r(0, 1),
        spread: r(0.14, 0.4),
        speed: r(0.1, 0.3),
        drift: r(-0.05, 0.05),
        alpha: 0.3,
      }),
    ],
    bolts: null,
    haloOpacity: 0.7,
    floorOpacity: 0.45,
  },
  {
    id: 'fx.sparks',
    layers: [
      layer({
        shape: 'rise',
        rate: 40,
        life: r(0.5, 1.1),
        size: r(0.02, 0.045),
        height: r(0, 1),
        spread: r(0, 0.45),
        speed: r(0.3, 0.8),
        drift: r(-0.12, 0.12),
        // Une etincelle sur trois est blanche : c est ce qui la fait petiller.
        tints: [null, null, '#ffffff'],
      }),
    ],
    bolts: null,
    haloOpacity: 0.55,
    floorOpacity: 0.45,
  },
  {
    id: 'fx.flames',
    layers: [
      layer({
        shape: 'rise',
        rate: 70,
        life: r(0.55, 1),
        size: r(0.09, 0.18),
        height: r(0, 0.2),
        spread: r(0, 0.28),
        speed: r(0.9, 1.7),
        drift: r(-0.1, 0.1),
        alpha: 0.5,
        coreTint: '#fff4c2',
        shrink: true,
      }),
    ],
    bolts: null,
    haloOpacity: 0.55,
    floorOpacity: 0.6,
  },
  {
    id: 'fx.lightning',
    layers: [
      layer({
        shape: 'burst',
        rate: 30,
        life: r(0.15, 0.35),
        size: r(0.015, 0.03),
        height: r(0.12, 1),
        spread: r(0, 0.35),
        speed: r(0.4, 0.75),
        tints: [null, '#ffffff'],
      }),
    ],
    bolts: {
      rate: 7,
      minIntensity: 0,
      life: 0.14,
      start: r(0.6, 1.05),
      reach: 0.8,
      segments: 7,
      jitter: 0.16,
    },
    haloOpacity: 0.55,
    floorOpacity: 0.45,
  },
  {
    id: 'fx.shock',
    layers: [
      // Deux anneaux et demi par seconde : le rythme est l effet.
      layer({
        shape: 'ring',
        rate: 2.4,
        life: r(1.1, 1.1),
        size: r(0.05, 0.055),
        radius: r(1.1, 1.5),
      }),
      // Une poussiere au ras du sol entre deux ondes : sans elle, l effet
      // clignote au lieu de pulser.
      layer({
        shape: 'rise',
        rate: 14,
        life: r(0.4, 0.8),
        size: r(0.02, 0.04),
        height: r(0, 0.08),
        spread: r(0.2, 0.55),
        speed: r(0.1, 0.35),
        drift: r(-0.06, 0.06),
        alpha: 0.7,
      }),
    ],
    bolts: null,
    haloOpacity: 0.5,
    floorOpacity: 0.7,
  },
  {
    id: 'fx.vortex',
    layers: [
      layer({
        shape: 'orbit',
        rate: 60,
        life: r(1, 1.6),
        size: r(0.02, 0.045),
        height: r(0, 0.2),
        // Serre, rapide, et qui monte : une helice, pas un anneau.
        radius: r(0.38, 0.62),
        speed: r(3, 5.5),
        drift: r(0.35, 0.8),
        tilt: 0,
      }),
    ],
    bolts: null,
    haloOpacity: 0.55,
    floorOpacity: 0.5,
  },
  {
    id: 'fx.dark',
    layers: [
      layer({
        shape: 'smoke',
        rate: 34,
        life: r(1, 1.8),
        size: r(0.1, 0.18),
        height: r(0, 0.7),
        spread: r(0, 0.3),
        speed: r(0.25, 0.6),
        drift: r(-0.1, 0.1),
        alpha: 0.55,
        tints: ['#07020f'],
        grow: 1.3,
        additive: false,
      }),
      layer({
        shape: 'rise',
        rate: 11,
        life: r(0.6, 1.2),
        size: r(0.012, 0.024),
        height: r(0, 0.8),
        spread: r(0, 0.35),
        speed: r(0.3, 0.7),
        drift: r(-0.08, 0.08),
      }),
    ],
    bolts: null,
    // La fumee mange deja la lumiere : un voile fort par-dessus la ferait
    // grise. Le prototype tombait a 0,3 pour la meme raison.
    haloOpacity: 0.3,
    floorOpacity: 0.3,
  },
  {
    id: 'fx.galaxy',
    layers: [
      layer({
        shape: 'orbit',
        rate: 75,
        life: r(1.4, 2.4),
        size: r(0.012, 0.032),
        height: r(0.1, 0.95),
        // Large, lent, incline : un disque d etoiles, pas une tornade. Le
        // rayon ne recouvre jamais celui du Vortex — de loin, deux helices de
        // meme diametre se confondent quelle que soit leur vitesse.
        radius: r(0.7, 1.15),
        speed: r(1.2, 2.6),
        drift: r(-0.05, 0.05),
        tilt: 0.38,
        tints: STAR_TINTS,
        twinkle: true,
      }),
    ],
    bolts: {
      rate: 2,
      // La galaxie ne craque qu au sommet : sinon elle imite les Éclairs.
      minIntensity: 0.8,
      life: 0.14,
      start: r(0.6, 1.05),
      reach: 0.8,
      segments: 7,
      jitter: 0.16,
    },
    haloOpacity: 0.62,
    floorOpacity: 0.5,
  },
]);

const BY_ID = new Map(STYLES.map((style) => [style.id, style]));

/** L effet de repli, et l effet offert a tous : la Lueur. */
export const FALLBACK_STYLE: AuraStyle = STYLES[0]!;

export const AURA_STYLES: readonly AuraStyle[] = STYLES;

/**
 * Le style d un identifiant d effet, ou la Lueur.
 *
 * Ne leve jamais : un cosmetique absent du client — catalogue plus recent
 * cote serveur, achat d une autre version — ne doit pas couter sa manche au
 * joueur. Il voit l effet offert, et la partie continue.
 */
/** Cadence totale d un effet, en particules par seconde a intensite 1. */
export function totalRate(style: AuraStyle): number {
  return style.layers.reduce((sum, l) => sum + l.rate, 0);
}

export function styleForEffect(effectId: string | null | undefined): AuraStyle {
  if (effectId === null || effectId === undefined) return FALLBACK_STYLE;
  return BY_ID.get(effectId) ?? FALLBACK_STYLE;
}
