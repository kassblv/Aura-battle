/**
 * Garder les bras hors du buste.
 *
 * Les danses sont dessinees a plat. Un bras qui passe d'un cote a l'autre —
 * bras croises, floss, epaules epoussetees, dos tourne — le fait donc dans le
 * plan du corps, et les ecartements de `animation/layout` ne l'eloignent que
 * sur le cote. Rien ne le mettait devant ou derriere : il traversait le tronc.
 * Mesure avant correction : bras croises dans le buste 100 % du temps, floss
 * 87 % et jusqu'a son axe.
 *
 * Le remede est geometrique et general, pas une retouche par danse : une
 * danse ajoutee demain (regle d'or n°5) en profite sans qu'on y pense. Le coude
 * puis la main sont avances — ou reculés, s'ils etaient deja derriere — juste
 * assez pour que l'axe du bras longe le buste a la distance d'un avant-bras.
 * Rien ne bouge quand le bras est deja dehors, ce qui est le cas de trente-deux
 * animations sur trente-huit.
 *
 * Pur, sans allocation : il tourne a chaque image, pour deux bras.
 */

/** Un point modifiable : `Vector3` convient. */
export interface MutablePoint {
  x: number;
  y: number;
  z: number;
}

/** Demi-profondeur du buste (x, vers l'avant), en metres. `rig.ts` la pose. */
export const TORSO_FORWARD = 0.105;
/** Demi-largeur du buste (z, sur le cote), en metres. */
export const TORSO_SIDE = 0.125;
/** Rayon relatif du buste aux hanches ; il vaut 1 aux epaules. */
export const TORSO_HIP_SCALE = 0.8;
/** Le tronc part un peu sous la hanche et monte un peu au-dessus du cou. */
export const TORSO_BELOW_HIP = 0.03;
export const TORSO_ABOVE_NECK = 0.01;

/**
 * Distance a garder entre l'axe du bras et la peau du buste.
 *
 * Le rayon d'un avant-bras avec son contour, plus un peu d'air : un bras
 * pose contre la poitrine doit la toucher, pas s'y enfoncer.
 */
export const ARM_CLEARANCE = 0.062;

/**
 * Le haut du bras colle a l'epaule : ses tout premiers points sont couverts par
 * le deltoide.
 */
const UPPER_ARM_FROM = 0.35;

/**
 * De combien une epaule peut s'avancer (ou reculer) pour laisser passer son
 * bras, en metres.
 *
 * Un bras tendu en travers de la poitrine — le floss — ne peut pas degager le
 * buste pres de l'epaule en ne bougeant que le coude : il faudrait l'avancer de
 * 45 cm. Dans la realite, c'est l'epaule qui vient devant. Cinq centimetres,
 * c'est ce qu'une epaule gagne sans que la silhouette change de nature.
 */
export const SHOULDER_PROTRACTION = 0.05;

const SAMPLES = 10;

/** Une main a plus de 3 cm derriere l'axe est dans le dos : on y reste. */
const BEHIND_THRESHOLD = 0.03;

/** Hauteur relative d'un point le long du tronc, et l'axe du tronc a cette hauteur. */
interface Section {
  along: number;
  axisX: number;
  axisZ: number;
}

function sectionAt(py: number, hip: MutablePoint, neck: MutablePoint, out: Section): boolean {
  const bottom = hip.y - TORSO_BELOW_HIP;
  const top = neck.y + TORSO_ABOVE_NECK;
  const height = top - bottom;
  if (height <= 0) return false;
  const along = (py - bottom) / height;
  // Au-dessus des epaules ou sous le bassin, il n'y a rien a traverser.
  if (along < 0 || along > 1) return false;
  // Le tronc est quasi vertical : son axe suit la ligne hanche-cou.
  out.along = along;
  out.axisX = hip.x + (neck.x - hip.x) * along;
  out.axisZ = hip.z + (neck.z - hip.z) * along;
  return true;
}

const section: Section = { along: 0, axisX: 0, axisZ: 0 };

/**
 * De combien avancer (direction +1) ou reculer (-1) ce point pour qu'il
 * longe le buste ; 0 s'il est deja dehors de ce cote.
 */
function shiftFor(
  px: number,
  py: number,
  pz: number,
  hip: MutablePoint,
  neck: MutablePoint,
  direction: 1 | -1,
): number {
  if (!sectionAt(py, hip, neck, section)) return 0;
  const scale = TORSO_HIP_SCALE + (1 - TORSO_HIP_SCALE) * section.along;
  const reachX = TORSO_FORWARD * scale + ARM_CLEARANCE;
  const reachZ = TORSO_SIDE * scale + ARM_CLEARANCE;
  const lateral = (pz - section.axisZ) / reachZ;
  if (Math.abs(lateral) >= 1) return 0;
  // Sur l'ellipse gonflee, a cette hauteur laterale, le bras doit passer a
  // `needed` devant (ou derriere) l'axe.
  const needed = reachX * Math.sqrt(1 - lateral * lateral);
  const offset = (px - section.axisX) * direction;
  return offset >= needed ? 0 : needed - offset;
}

/**
 * Sort un bras du buste en deplacant son coude et sa main en x — et, un peu,
 * son epaule.
 *
 * **Une seule direction pour tout le bras**, lue sur la main : devant par
 * defaut — c'est la que la camera regarde, et un bras croise se porte devant
 * soi —, derriere seulement si la main y est deja nettement (mains dans le
 * dos). Choisir point par point envoyait le coude d'un bras croise en
 * arriere pendant que son avant-bras repassait devant : il traversait quand
 * meme.
 *
 * Le coude et la main bougent ensemble, d'un seul deplacement : l'epaule
 * etant fixe, un point du haut du bras a la fraction `f` ne se deplace que de
 * `f` fois ce deplacement, d'ou la division.
 */
export function clearArmFromTorso(
  hip: MutablePoint,
  neck: MutablePoint,
  shoulder: MutablePoint,
  elbow: MutablePoint,
  hand: MutablePoint,
): void {
  const handAxis = sectionAt(hand.y, hip, neck, section) ? section.axisX : neck.x;
  const direction: 1 | -1 = hand.x - handAxis < -BEHIND_THRESHOLD ? -1 : 1;

  /*
    Le haut du bras d'abord. Un point a la fraction `f` bouge de
    `protraction + f × (shift - protraction)` quand l'epaule avance de
    `protraction` et le coude de `shift` : l'epaule prend sa part (bornee),
    le coude le reste.
  */
  let protraction = 0;
  let shift = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const f = UPPER_ARM_FROM + ((1 - UPPER_ARM_FROM) * i) / SAMPLES;
    const need = shiftFor(
      shoulder.x + (elbow.x - shoulder.x) * f,
      shoulder.y + (elbow.y - shoulder.y) * f,
      shoulder.z + (elbow.z - shoulder.z) * f,
      hip,
      neck,
      direction,
    );
    if (need === 0) continue;
    protraction = Math.max(protraction, Math.min(need, SHOULDER_PROTRACTION));
    shift = Math.max(shift, protraction + (need - protraction) / f);
  }
  for (let i = 0; i <= SAMPLES; i++) {
    const f = i / SAMPLES;
    shift = Math.max(
      shift,
      shiftFor(
        elbow.x + (hand.x - elbow.x) * f,
        elbow.y + (hand.y - elbow.y) * f,
        elbow.z + (hand.z - elbow.z) * f,
        hip,
        neck,
        direction,
      ),
    );
  }
  if (shift === 0) return;
  shoulder.x += protraction * direction;
  elbow.x += shift * direction;
  hand.x += shift * direction;
}
