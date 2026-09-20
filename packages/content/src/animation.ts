import type { Style, Tier } from './catalogue.js';

/**
 * Forme typee d'une animation (docs/07-content-pipeline.md).
 *
 * Le schema JSON valide a l'execution, ce type valide a la compilation. Les
 * deux vivent ici, cote a cote, parce qu'ils disent la meme chose : laisser
 * chaque consommateur redeclarer la forme garantirait qu'un jour l'un des deux
 * bouge sans l'autre, et que du code compile contre une forme que la
 * validation refuse. Un test tient les deux ensemble.
 */

/**
 * Articulations du squelette, dans l'ordre du prototype.
 *
 * `le`/`lh` : coude et main gauches ; `re`/`rh` a droite ; `lk`/`lf` genou et
 * pied gauches ; `rk`/`rf` a droite. Ces noms courts viennent du prototype et
 * sont recopies tels quels dans les fichiers de contenu — les renommer
 * demanderait de reecrire les 26 animations pour un gain nul.
 */
export const JOINT_NAMES = [
  'head',
  'neck',
  'hip',
  'le',
  'lh',
  're',
  'rh',
  'lk',
  'lf',
  'rk',
  'rf',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/** Position d'une articulation dans le plan de l'animation, en centimetres. */
export type Joint2D = readonly [number, number];

export type Expression = 'neutral' | 'smug' | 'sad' | 'angry' | 'hurt';
export type HandShape = string;
export type HandFacing = string;

export interface AnimationFrame {
  readonly joints: Readonly<Record<JointName, Joint2D>>;
  /** Profondeur par articulation. Absente vaut zero : le squelette est plan. */
  readonly z?: Readonly<Partial<Record<JointName, number>>>;
  /** Elevation du personnage, negative vers le haut. */
  readonly lift?: number;
  /** Inclinaison dans le plan, en radians. */
  readonly rot?: number;
  /** Rotation autour de l'axe vertical, en radians. */
  readonly hy?: number;
  /** Rotation de salto, en radians. */
  readonly pitch?: number;
}

/**
 * Cadrage de la previsualisation.
 *
 * Un meme ne se lit pas toujours a la meme echelle. « Mewing » ou « Chut » se
 * jouent dans le visage et les mains : cadres en pied, le geste fait quelques
 * pixels sur un telephone. Le salto arriere, lui, a besoin de toute la
 * hauteur. Le defaut (`body`) ajuste la distance a l'encombrement reel de
 * l'animation ; `bust` demande explicitement un plan rapproche.
 *
 * C'est de la donnee, pas du code : ajouter une danse qui se joue au visage ne
 * demande que cette ligne dans son fichier (regle d'or n°5).
 */
export type AnimationShot = 'body' | 'bust';

export interface AnimationFraming {
  readonly shot: AnimationShot;
}

/**
 * Accent sonore d un geste.
 *
 * `whoosh` : un membre qui fend l air. `impact` : un contact sec — une main
 * qui claque, un corps qui retombe. `hold` : le souffle d une pose tenue.
 *
 * Trois mots pour ce que le CORPS fait, jamais pour ce que le joueur a choisi
 * ni pour sa reussite. C est ce qui rend l accent jouable des deux cotes de
 * l arene sans rien trahir (regle d or n°4) : un impact d acrobatie sonne
 * pareil qu on gagne ou qu on perde la manche.
 */
export type SoundAccent = 'whoosh' | 'impact' | 'hold';

export interface AnimationAccent {
  /**
   * Instant dans la boucle, en part de la boucle (0 inclus, 1 exclu).
   *
   * Une part, pas des secondes : rallonger une danse de deux dixiemes ne doit
   * pas desynchroniser son impact.
   */
  readonly at: number;
  readonly accent: SoundAccent;
}

export interface AnimationLoop {
  /** Duree d'un cycle, en secondes. */
  readonly duration: number;
  /**
   * Part de la boucle occupee par chaque image. `null` repartit egalement.
   *
   * Ce sont des parts, pas des durees : elles se lisent relativement a leur
   * somme, ce qui rend une animation independante de sa duree.
   */
  readonly weights?: readonly number[] | null;
  /** Adoucit l'entree et la sortie de chaque image. */
  readonly ease?: boolean;
}

export interface Animation {
  readonly id: string;
  readonly version: number;
  /**
   * Noms localises. Le francais est garanti par `loadAnimation` : c'est la
   * seule langue que l'interface affiche aujourd'hui, et un nom manquant se
   * verrait a l'ecran plutot qu'au chargement.
   */
  readonly name: Readonly<Record<string, string>> & { readonly fr: string };
  readonly move: { readonly style: Style | 'system'; readonly tier: Tier | null };
  readonly rarity?: string;
  readonly loop: AnimationLoop;
  /** Cadrage de previsualisation. Absent vaut `{ shot: 'body' }`. */
  readonly framing?: AnimationFraming;
  readonly flags?: {
    readonly armsFront?: boolean;
    readonly armsBack?: boolean;
    readonly noFace?: boolean;
    readonly float?: number;
    readonly expression?: Expression;
  };
  readonly emit?: readonly unknown[];
  /** Accents sonores du geste. Absent : la danse est muette. */
  readonly sound?: readonly AnimationAccent[];
  readonly hands: readonly (readonly [HandShape, HandFacing])[];
  readonly frames: readonly AnimationFrame[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJoint2D = (value: unknown): value is Joint2D =>
  Array.isArray(value) && value.length >= 2 && value.every((n) => typeof n === 'number');

/**
 * Verifie la forme d'un document et le rend typé.
 *
 * Deliberement plus mince que `createAnimationValidator` : celui-ci est le
 * portier du pipeline de contenu et dit **tout** ce qui cloche, y compris la
 * plausibilite du squelette. Celui-la est le portier du code — il repond a
 * « puis-je traiter cet objet comme une `Animation` ? », et doit pouvoir tourner
 * dans le client, sans schema JSON ni validateur a embarquer.
 */
export function loadAnimation(document: unknown): Animation {
  if (!isRecord(document) || typeof document.id !== 'string') {
    throw new TypeError("ce document n'est pas une animation : identifiant manquant");
  }
  const id = document.id;
  const fail = (why: string): never => {
    throw new TypeError(`animation ${id} : ${why}`);
  };

  /**
   * Le nom francais est ce que le joueur lit dans la galerie de memes. Sans
   * cette verification, une danse arrive anonyme : elle se charge, se joue et
   * s'affiche sans nom, sans que rien n'ait proteste.
   */
  if (
    !isRecord(document.name) ||
    typeof document.name.fr !== 'string' ||
    document.name.fr.trim() === ''
  ) {
    fail('nom francais manquant');
  }

  if (!isRecord(document.loop) || typeof document.loop.duration !== 'number') {
    fail('duree de boucle manquante');
  }
  if (!Array.isArray(document.frames) || document.frames.length === 0) {
    fail('aucune image');
  }

  const frames = document.frames as readonly unknown[];
  for (const [index, frame] of frames.entries()) {
    if (!isRecord(frame) || !isRecord(frame.joints)) {
      fail(`image ${String(index)} sans articulations`);
      continue;
    }
    const joints = frame.joints;
    for (const name of JOINT_NAMES) {
      if (!isJoint2D(joints[name])) {
        fail(`image ${String(index)} : articulation ${name} manquante ou mal formee`);
      }
    }
  }

  const framing = document.framing;
  if (framing !== undefined) {
    if (!isRecord(framing) || (framing.shot !== 'body' && framing.shot !== 'bust')) {
      fail("cadrage inconnu : 'body' ou 'bust' attendu");
    }
  }

  /**
   * Les accents sonores, verifies sur leur FORME et pas sur leur vocabulaire.
   *
   * Un instant hors de la boucle ne se joue jamais, et une liste qui n en est
   * pas une fait planter la programmation : ces deux-la sont refuses. Le nom
   * de l accent, lui, est laisse passer tel quel — un catalogue plus recent
   * peut en inventer un que cette version du client ne connait pas, et un
   * accent inconnu doit rendre le silence, pas empecher de jouer (meme
   * raisonnement que pour `framing`).
   */
  const sound = document.sound;
  if (sound !== undefined) {
    if (!Array.isArray(sound)) {
      fail('accents sonores : une liste est attendue');
    } else {
      for (const [index, accent] of (sound as readonly unknown[]).entries()) {
        if (!isRecord(accent) || typeof accent.at !== 'number') {
          fail(`accent sonore ${String(index)} : instant manquant`);
          continue;
        }
        if (!(accent.at >= 0) || accent.at >= 1) {
          fail(`accent sonore ${String(index)} : instant ${String(accent.at)} hors de la boucle`);
        }
      }
    }
  }

  const weights = (document.loop as Record<string, unknown>).weights;
  if (weights !== undefined && weights !== null) {
    if (!Array.isArray(weights) || weights.length !== frames.length) {
      fail('autant de parts que d images, ou aucune');
    }
  }

  return document as unknown as Animation;
}
