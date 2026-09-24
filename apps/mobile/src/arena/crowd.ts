import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three';
import { RING_SIZE, buildSeats, seatMotion, type CrowdSeat, type HeadWear } from './crowdLayout.js';
import { createRimUniforms, withRim } from './rim.js';

/**
 * Le public qui entoure le duel.
 *
 * Un spectateur n est pas une gelule : il a une tete, un buste, deux bras qui
 * bougent separement, et — pour pres de la moitie d entre eux — un telephone
 * braque sur les combattants. Chaque partie du corps vit dans son propre
 * `InstancedMesh` : sept appels de dessin pour deux cent dix personnes, la ou
 * deux cent dix groupes en couteraient des milliers. Les bras ont leurs
 * propres instances parce qu une matrice d instance ne peut pas animer un
 * sous-objet.
 *
 * Les places sont calees sur les gradins de `stage.ts` : meme arc, memes
 * rayons, memes hauteurs de marche. Un public qui flotte se lit comme des gens
 * suspendus, et la profondeur du fond disparait avec lui.
 *
 * Tout ce qui se **decide** ici est dans `crowdLayout.ts`, sans Three.js.
 */

export { CROWD_SIZE, RING_SIZE } from './crowdLayout.js';

/** Demi-longueur d un bras : c est la que se tient la main, donc le telephone. */
const ARM_REACH = 0.175;

/**
 * Ce qu il reste d un teint de peau une fois la nuit tombee.
 *
 * La foule est eclairee par les memes lumieres que les combattants ; sans ce
 * coup de frein, deux cent dix visages clairs tiennent le fond de l ecran et
 * l oeil ne trouve plus les deux seules choses a lire.
 */
const FACE_LIGHT = 0.16;

/**
 * Taille du halo d ecran, en metres.
 *
 * Un ecran de telephone a six metres fait trois pixels : ce n est pas l ecran
 * qu on dessine, c est la lueur qu il jette. Le halo est donc plus large que
 * l appareil — et **debout**, dans les proportions d un telephone tenu a la
 * verticale. Un halo carre donne une boule de coton ; c est la forme qui dit
 * qu il y a un ecran dessous.
 */
const SCREEN_GLOW_W = 0.2;
const SCREEN_GLOW_H = 0.34;

/**
 * Liseré de la foule (`rim.ts`), dans la teinte froide des projecteurs.
 *
 * Sans lui, les spectateurs d un meme rang se fondent en une seule masse
 * floue : meme valeur, meme brouillard. Un trait de lumiere sur le haut de
 * chaque tete et de chaque epaule les separe sans eclaircir la foule — la
 * valeur moyenne reste sous celle des combattants. Il monte avec la ferveur :
 * la salle s allume quand il se passe quelque chose.
 */
const RIM_COLOR = '#8f7bff';
const RIM_CALM = 0.13;
const RIM_ROUSED = 0.42;

/**
 * Forme de chaque coiffure, posee sur la meme calotte.
 *
 * Echelle (largeur, hauteur) et hauteur du centre au-dessus de celui de la
 * tete, en metres a l echelle 1. `bald` ne dessine rien.
 */
const HEAD_WEAR: Readonly<Record<HeadWear, readonly [number, number, number]>> = {
  short: [1.04, 0.72, 0.008],
  volume: [1.22, 1.12, 0.0],
  beanie: [1.06, 1.22, 0.014],
  bald: [0, 0, 0],
};

export interface CrowdResources {
  readonly gradientMap: Texture;
  /** Degrade radial blanc, partage : il fait la lueur des ecrans. */
  readonly glow: Texture;
}

export interface Crowd {
  readonly group: Group;
  /**
   * `hype` entre 0 et 1 : la ferveur leve les bras et fait sauter la foule.
   *
   * `showcase` efface le premier cercle : hors match un seul personnage est a
   * l ecran et on tourne autour, jusqu a passer la camera la ou ces gens-la se
   * tiennent. Ils masqueraient alors ce qu on vient inspecter.
   */
  update(elapsedSeconds: number, hype: number, showcase?: boolean): void;
  /**
   * Combien de places on dessine, sur les `CROWD_SIZE` construites.
   *
   * Les places sont triees par importance a l ecran (`crowdLayout`) : baisser
   * ce nombre retire les derniers rangs et garde le premier cercle. Rien n est
   * alloue ni libere — c est le `count` des `InstancedMesh` qui change, et
   * Three.js le relit a chaque image. Le premier cercle n est jamais retire :
   * c est la couche proche, celle qui donne sa profondeur a l arene.
   */
  setVisibleSeats(count: number): void;
  dispose(): void;
}

export function createCrowd(resources: CrowdResources, rng: () => number = Math.random): Crowd {
  const { gradientMap, glow } = resources;
  const group = new Group();
  group.name = 'crowd';

  const seats = buildSeats(rng);
  const filming: number[] = [];
  seats.forEach((seat, index) => {
    if (seat.filming) filming.push(index);
  });

  const geometries = {
    body: new CapsuleGeometry(0.16, 0.3, 3, 8),
    head: new SphereGeometry(0.125, 12, 9),
    // Une calotte, pas une sphere : posee sur la tete, elle en change le
    // contour sans la cacher.
    hair: new SphereGeometry(0.125, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.55),
    arm: new CapsuleGeometry(0.045, 0.26, 2, 6),
    phone: new BoxGeometry(0.075, 0.145, 0.012),
    screen: new PlaneGeometry(SCREEN_GLOW_W, SCREEN_GLOW_H),
  };

  const cloth = new MeshToonMaterial({ color: 0xffffff, gradientMap });
  const skin = new MeshToonMaterial({ color: 0xffffff, gradientMap });
  const hair = new MeshToonMaterial({ color: 0xffffff, gradientMap });
  const rim = createRimUniforms(RIM_COLOR, RIM_CALM);
  for (const material of [cloth, skin, hair]) withRim(material, rim, 'crowd-rim');
  // Le dos d un telephone ne renvoie rien : c est une decoupe noire sur la
  // foule, et c est le halo qui porte la lecture.
  const shell = new MeshBasicMaterial({ color: 0x0b0a14 });
  const screen = new MeshBasicMaterial({
    map: glow,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Un halo additif melange au brouillard **ajoute** la couleur de brume :
    // le fond deviendrait plus clair que le premier rang. La distance est
    // peinte dans la couleur de l instance (`seat.reach`).
    fog: false,
  });

  const parts = {
    body: new InstancedMesh(geometries.body, cloth, seats.length),
    head: new InstancedMesh(geometries.head, skin, seats.length),
    hair: new InstancedMesh(geometries.hair, hair, seats.length),
    armLeft: new InstancedMesh(geometries.arm, cloth, seats.length),
    armRight: new InstancedMesh(geometries.arm, cloth, seats.length),
    phone: new InstancedMesh(geometries.phone, shell, filming.length),
    screen: new InstancedMesh(geometries.screen, screen, filming.length),
  };

  for (const [name, mesh] of Object.entries(parts)) {
    mesh.name = name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // La foule entoure la camera : la faire sortir du champ par morceaux
    // couterait un test d englobement par partie, pour rien.
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const tint = new Color();
  const hidden = new Matrix4().makeScale(0, 0, 0);

  seats.forEach((seat, i) => {
    tint.setHSL(seat.cloth.h, seat.cloth.s, seat.cloth.l);
    parts.body.setColorAt(i, tint);
    parts.armLeft.setColorAt(i, tint);
    parts.armRight.setColorAt(i, tint);
    /*
      Les visages sont eteints, pas eclaires.

      Un teint de peau pose tel quel fait deux cent dix taches claires en fond
      d ecran — et l oeil va aux taches claires, donc partout sauf sur les deux
      combattants. Ceux du premier cercle, vus de dos et a contre-jour, n ont
      meme pas de visage a montrer : ils prennent la couleur de leur manteau.
    */
    parts.head.setColorAt(i, seat.ring ? tint : tint.set(seat.skin).multiplyScalar(FACE_LIGHT));
    // Le premier cercle reste une masse : sa coiffure prend son manteau.
    if (!seat.ring) tint.setHSL(seat.headTone.h, seat.headTone.s, seat.headTone.l);
    parts.hair.setColorAt(i, tint);
  });
  filming.forEach((seatIndex, i) => {
    const seat = seats[seatIndex];
    if (seat === undefined) return;
    tint.setHSL(seat.screen.h, seat.screen.s, seat.screen.l);
    parts.screen.setColorAt(i, tint);
  });

  for (const mesh of Object.values(parts)) {
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);
  const euler = new Euler();
  const glowTint = new Color();

  /**
   * Derniere image calculee.
   *
   * Reenvoyer deux cent dix matrices au GPU alors que rien n a bouge est
   * exactement le genre de depense qu une image a 60 Hz ne peut pas se
   * permettre — et la foule ne bouge pas pendant une pause ou un ralenti.
   */
  let lastElapsed = Number.NaN;
  let lastHype = Number.NaN;
  let lastShowcase: boolean | null = null;
  let disposed = false;

  /** Ou en est le telephone du siege `index`, s il en tient un. */
  const phoneSlot = new Map<number, number>();
  filming.forEach((seatIndex, i) => phoneSlot.set(seatIndex, i));

  let visible = seats.length;

  return {
    group,

    setVisibleSeats(count): void {
      const next = Math.max(RING_SIZE, Math.min(seats.length, Math.floor(count)));
      if (next === visible) return;
      visible = next;

      for (const mesh of [parts.body, parts.head, parts.hair, parts.armLeft, parts.armRight]) {
        mesh.count = visible;
      }
      /*
        Les places qui filment sont un sous-ensemble de la liste triee, donc
        celles des `visible` premieres places sont les `n` premiers telephones.
        Compter suffit : aucun slot n est a deplacer.
      */
      let phones = 0;
      for (const seatIndex of filming) {
        if (seatIndex < visible) phones++;
      }
      parts.phone.count = phones;
      parts.screen.count = phones;

      // Les places redevenues visibles portent des matrices perimees : la
      // prochaine image doit les reecrire, meme si le temps n a pas bouge.
      lastElapsed = Number.NaN;
    },

    update(elapsed, hype, showcase = false): void {
      if (elapsed === lastElapsed && hype === lastHype && showcase === lastShowcase) return;
      lastElapsed = elapsed;
      lastHype = hype;
      lastShowcase = showcase;
      rim.rimStrength.value = RIM_CALM + (RIM_ROUSED - RIM_CALM) * Math.min(1, Math.max(0, hype));

      for (let i = 0; i < visible; i++) {
        const seat = seats[i];
        if (seat === undefined) continue;
        const slot = phoneSlot.get(i);

        if (seat.ring && showcase) {
          parts.body.setMatrixAt(i, hidden);
          parts.head.setMatrixAt(i, hidden);
          parts.hair.setMatrixAt(i, hidden);
          parts.armLeft.setMatrixAt(i, hidden);
          parts.armRight.setMatrixAt(i, hidden);
          if (slot !== undefined) {
            parts.phone.setMatrixAt(slot, hidden);
            parts.screen.setMatrixAt(slot, hidden);
          }
          continue;
        }

        const motion = seatMotion(seat, elapsed, hype);
        const s = seat.scale;
        const { width, height } = seat.build;

        euler.set(0, 0, motion.lean);
        rotation.setFromEuler(euler);

        position.set(seat.x, motion.y, seat.z);
        scale.set(s * width, s * height, s * width);
        matrix.compose(position, rotation, scale);
        parts.body.setMatrixAt(i, matrix);

        /*
          La tete regarde le centre et hoche.

          Une sphere nue ne montrerait ni l un ni l autre ; c est la coiffure,
          asymetrique, qui les rend visibles. Les deux partagent donc la meme
          rotation.
        */
        const neckY = motion.y + 0.33 * s * height;
        euler.set(motion.nod, seat.facing, motion.lean, 'YXZ');
        rotation.setFromEuler(euler);
        position.set(seat.x, neckY, seat.z);
        scale.setScalar(s);
        matrix.compose(position, rotation, scale);
        parts.head.setMatrixAt(i, matrix);

        const [wearWidth, wearHeight, wearLift] = HEAD_WEAR[seat.headWear];
        if (wearWidth === 0) parts.hair.setMatrixAt(i, hidden);
        else {
          position.set(seat.x, neckY + wearLift * s, seat.z);
          scale.set(s * wearWidth, s * wearHeight, s * wearWidth);
          matrix.compose(position, rotation, scale);
          parts.hair.setMatrixAt(i, matrix);
          scale.setScalar(s);
        }
        euler.set(0, 0, motion.lean, 'XYZ');
        rotation.setFromEuler(euler);

        /*
          Le bras pend au repos et monte avec la ferveur.

          L angle **decroit** quand le bras se leve : une gelule tournee de
          zero autour de z pointe deja vers le haut. Le portage initial faisait
          croitre cet angle avec la ferveur, ce qui rabattait les bras le long
          du corps au moment precis ou la salle explosait — le buste montait, la
          position du bras aussi, mais la gelule, elle, basculait vers le bas.
        */
        writeArm(i, seat, motion.y, motion.raiseLeft, -1, s);
        writeArm(i, seat, motion.y, motion.raiseRight, 1, s);

        if (slot !== undefined) {
          const swing = armSwing(motion.raiseRight);
          const hand = handAt(seat, motion.y, motion.raiseRight, swing, s);

          // Le dos du telephone regarde le centre : c est le duel qu on filme.
          euler.set(-0.22, seat.facing, 0);
          rotation.setFromEuler(euler);
          position.copy(hand);
          matrix.compose(position, rotation, scale);
          parts.phone.setMatrixAt(slot, matrix);

          // Le halo, lui, est tourne vers l objectif : un plan vu par la
          // tranche ne jette aucune lueur.
          euler.set(0, seat.glowFacing, 0);
          rotation.setFromEuler(euler);
          // Legerement devant l appareil, sinon la plaque et le halo se
          // disputent le meme plan et scintillent.
          position.set(hand.x, hand.y, hand.z + 0.02);
          scale.setScalar(s * (1 + motion.flash * 1.4));
          matrix.compose(position, rotation, scale);
          parts.screen.setMatrixAt(slot, matrix);
          scale.setScalar(s);

          glowTint
            .setHSL(seat.screen.h, seat.screen.s, seat.screen.l)
            .multiplyScalar(motion.screen);
          parts.screen.setColorAt(slot, glowTint);
        }
      }

      for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
      if (parts.screen.instanceColor !== null) parts.screen.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of Object.values(geometries)) geometry.dispose();
      cloth.dispose();
      skin.dispose();
      hair.dispose();
      shell.dispose();
      screen.dispose();
      for (const mesh of Object.values(parts)) mesh.dispose();
      group.clear();
    },
  };

  function writeArm(
    index: number,
    seat: CrowdSeat,
    bodyY: number,
    raise: number,
    side: -1 | 1,
    s: number,
  ): void {
    const swing = armSwing(raise);
    euler.set(0, 0, -side * swing);
    rotation.setFromEuler(euler);
    position.set(
      seat.x + side * shoulderOffset(seat, raise),
      bodyY + (0.1 + raise * 0.22) * s * seat.build.height,
      seat.z + 0.05 * s,
    );
    matrix.compose(position, rotation, scale);
    (side === -1 ? parts.armLeft : parts.armRight).setMatrixAt(index, matrix);
  }
}

/** Angle du bras avec la verticale : grand au repos, petit bras leve. */
export function armSwing(raise: number): number {
  return 2.3 - raise * 1.85;
}

const HAND = new Vector3();

/** Ecart de l epaule a l axe du corps : il suit la carrure. */
function shoulderOffset(seat: CrowdSeat, raise: number): number {
  return (0.17 * seat.build.width + raise * 0.03) * seat.scale;
}

/** Position de la main droite, ou se tient le telephone. */
function handAt(seat: CrowdSeat, bodyY: number, raise: number, swing: number, s: number): Vector3 {
  return HAND.set(
    seat.x + shoulderOffset(seat, raise) + Math.sin(swing) * ARM_REACH * s,
    bodyY + (0.1 + raise * 0.22) * s * seat.build.height + Math.cos(swing) * ARM_REACH * s,
    seat.z + 0.05 * s,
  );
}
