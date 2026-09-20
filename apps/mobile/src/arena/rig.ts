import { type Animation, HAIRSTYLES, OUTFITS, type JointName, type Outfit } from '@aura/content';
import {
  BackSide,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Quaternion,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector3,
} from 'three';
import {
  CM,
  DELTOID_LENGTH,
  DELTOID_OFFSET,
  DELTOID_RADIUS,
  FLIP_PIVOT,
  SHOULDER_DROP,
  skeletonDepths,
  YOKE_DEPTH,
  YOKE_THICKNESS,
} from '../animation/layout.js';
import type { Pose } from '../animation/pose.js';
import { createHand, type Hand, type HandSpec } from './hands.js';

/**
 * Le combattant (port de `buildRig` / `rigLook` / `updateRig` du prototype).
 *
 * Un personnage n est pas un squelette de batons : c est un buste, des membres
 * en deux segments, des articulations, des pieds, des mains et un visage. Trois
 * choses le rendent lisible a distance, et aucune n est une affaire de nombre
 * de polygones — le contour, la separation en profondeur des membres, et
 * l assombrissement du cote eloigne.
 */

const HAIR_COLOR = '#1b1426';

/**
 * Galbe des membres : rayon a l extremite, en part du rayon a la racine.
 *
 * Un cylindre de rayon constant se lit comme un tuyau, pas comme un bras. Le
 * bras s affine du deltoide au coude, l avant-bras du coude au poignet, et le
 * meme raisonnement vaut pour la cuisse et le mollet. Le rapport est porte par
 * la geometrie plutot que par l echelle : trois nombres passes a
 * `CylinderGeometry` coutent zero appel de dessin supplementaire, la ou une
 * mise a l echelle non uniforme ne sait pas faire de cone.
 */
const TAPER = {
  upperArm: 0.77,
  foreArm: 0.7,
  thigh: 0.76,
  shin: 0.68,
} as const;

/**
 * Rayons des membres a leur racine, en metres.
 *
 * Volontairement plus epais que le prototype a la racine et plus fins a
 * l extremite : a volume egal, c est le galbe qui fait la difference entre un
 * membre et un tuyau.
 */
const LIMB_RADIUS = {
  upperArm: 0.056,
  foreArm: 0.0435,
  thigh: 0.068,
  shin: 0.0515,
  neck: 0.036,
} as const;

/**
 * Rayons des articulations, en metres.
 *
 * Chaque bille doit **contenir** la section des deux os qu elle relie,
 * contour compris : c est elle qui ferme le raccord quand le membre plie
 * fort. Une bille plus petite que l os laisse voir une marche, et le pli d un
 * coude serre laisse apparaitre un trou entre les deux cylindres.
 */
const JOINT_RADIUS = {
  elbow: 0.048,
  hip: 0.063,
  knee: 0.054,
} as const;

/**
 * Dilatation du contour d un membre.
 *
 * Le contour est une copie dilatee : sur un volume plus epais, le meme facteur
 * donne un trait plus gros. 1,28 garde le trait du prototype (environ un
 * centimetre et demi) sur des membres devenus plus larges — et, surtout, garde
 * la section du bras a l interieur du deltoide qui la recouvre.
 */
const WIDE_OUTLINE = 1.28;

/** Repli quand une animation ne declare pas ses mains. */
const DEFAULT_HANDS: readonly HandSpec[] = Object.freeze([
  ['relax', 'in'],
  ['relax', 'in'],
] as const);

type PartName =
  | 'torso'
  | 'neck'
  | 'upperArmLeft'
  | 'foreArmLeft'
  | 'upperArmRight'
  | 'foreArmRight'
  | 'thighLeft'
  | 'shinLeft'
  | 'thighRight'
  | 'shinRight'
  | 'shoulderLeft'
  | 'shoulderRight'
  | 'shoulderYoke'
  | 'elbowLeft'
  | 'elbowRight'
  | 'hipLeft'
  | 'hipRight'
  | 'kneeLeft'
  | 'kneeRight'
  | 'footLeft'
  | 'footRight'
  | 'skull';

/** Chaque os et la geometrie galbee qui lui va. */
const BONES = [
  ['neck', 'neck'],
  ['upperArmLeft', 'upperArm'],
  ['foreArmLeft', 'foreArm'],
  ['upperArmRight', 'upperArm'],
  ['foreArmRight', 'foreArm'],
  ['thighLeft', 'thigh'],
  ['shinLeft', 'shin'],
  ['thighRight', 'thigh'],
  ['shinRight', 'shin'],
] as const satisfies readonly (readonly [PartName, string])[];

const KNOTS: readonly PartName[] = [
  'shoulderLeft',
  'shoulderRight',
  'elbowLeft',
  'elbowRight',
  'hipLeft',
  'hipRight',
  'kneeLeft',
  'kneeRight',
  'footLeft',
  'footRight',
];

export interface FighterLook {
  /** Identifiant d une tenue de `@aura/content`. */
  readonly outfit: string;
  readonly hair: string;
  /** Teinte de peau, en hexadecimal. */
  readonly skin: string;
  /** Couleur d aura : un cosmetique, jamais une information de jeu. */
  readonly aura: string;
}

export interface RigResources {
  readonly gradientMap: Texture;
}

export interface RigPlacement {
  /** Rotation de repos autour de l axe vertical : un trois-quarts, pas un profil. */
  readonly turn: number;
  /** 1 pour le siege de gauche, -1 pour celui de droite. */
  readonly facing: 1 | -1;
}

export interface FighterRig {
  readonly root: Group;
  /** Pivot de salto, a mi-hauteur. */
  readonly flip: Group;
  readonly body: Group;
  readonly head: Group;
  readonly parts: Readonly<Record<PartName, Group>>;
  readonly hands: readonly Hand[];
  readonly hair: {
    readonly cap: Mesh;
    readonly hood: Mesh;
    readonly spikes: Group;
    readonly long: Group;
    readonly band: Mesh;
  };
  dress(look: FighterLook): void;
  pose(pose: Pose, animation: Animation, elapsedSeconds: number, deltaSeconds: number): void;
  /**
   * Dessine ou non les mains articulees — dernier levier des paliers de
   * qualite (`platform/quality.ts`).
   *
   * Les cacher ne suffit pas : `pose` cesse aussi de les mettre en pose, sinon
   * on paierait encore l interpolation de huit doigts par combattant et par
   * image pour des noeuds que personne ne voit.
   */
  setHandsVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Contour toon : une copie dilatee du volume, rendue en `BackSide` et en noir.
 *
 * Seules ses faces arriere sont visibles, donc elle n apparait qu en bordure de
 * la forme. Sans ce trait, un personnage toon d une seule teinte devient une
 * silhouette plate des qu il s eloigne de la camera.
 */
const OUTLINE_COLOR = 0x0d0819;

export function createFighterRig(resources: RigResources, placement: RigPlacement): FighterRig {
  const { gradientMap } = resources;
  const geometries: { dispose(): void }[] = [];
  const materials: Material[] = [];

  const outline = new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide });
  materials.push(outline);

  const cache = new Map<string, MeshToonMaterial>();
  const toon = (hex: string): MeshToonMaterial => {
    let material = cache.get(hex);
    if (material === undefined) {
      material = new MeshToonMaterial({ color: new Color(hex), gradientMap });
      cache.set(hex, material);
      materials.push(material);
    }
    return material;
  };

  /**
   * Un tronc de cone unitaire : rayon 1 a la base (`a`), `taper` au sommet
   * (`b`). `setBone` envoie l axe +Y sur `b`, donc le sommet est l extremite.
   */
  const limb = (taper: number): CylinderGeometry => new CylinderGeometry(taper, 1, 1, 12);

  const shapes = {
    cylinder: new CylinderGeometry(1, 1, 1, 12),
    neck: limb(0.92),
    upperArm: limb(TAPER.upperArm),
    foreArm: limb(TAPER.foreArm),
    thigh: limb(TAPER.thigh),
    shin: limb(TAPER.shin),
    torso: new CylinderGeometry(1, 0.8, 1, 16),
    sphere: new SphereGeometry(1, 18, 12),
    box: new BoxGeometry(1, 1, 1),
    cone: new ConeGeometry(1, 1, 6),
    cap: new SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
    hood: new SphereGeometry(1, 20, 12, Math.PI + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.72),
    torus: new TorusGeometry(1, 0.12, 8, 28),
    belt: new CylinderGeometry(1, 1, 1, 18, 1, true),
    finger: new CylinderGeometry(1, 1, 1, 7),
  };
  geometries.push(...Object.values(shapes));

  const root = new Group();
  root.name = 'fighter';
  const flip = new Group();
  flip.position.y = FLIP_PIVOT;
  root.add(flip);
  const body = new Group();
  body.position.y = -FLIP_PIVOT;
  flip.add(body);

  /** Un volume et son contour, dans un groupe qu on peut poser et etirer. */
  const outlined = (parent: Group, geometry: keyof typeof shapes, wide: boolean): Group => {
    const group = new Group();
    const inner = new Mesh(shapes[geometry], outline);
    const border = new Mesh(shapes[geometry], outline);
    if (wide) border.scale.set(WIDE_OUTLINE, 1.02, WIDE_OUTLINE);
    else border.scale.setScalar(1.17);
    group.add(inner, border);
    parent.add(group);
    return group;
  };

  const parts = {} as Record<PartName, Group>;
  for (const [name, shape] of BONES) parts[name] = outlined(body, shape, true);
  parts.torso = outlined(body, 'torso', true);
  // La ligne d epaules : un seul volume, donc deux appels de dessin de plus.
  // Sans elle, les deltoides sont deux billes accrochees a un buste etroit et
  // la silhouette descend du cou vers les bras au lieu de s elargir.
  parts.shoulderYoke = outlined(body, 'cylinder', true);
  for (const name of KNOTS) parts[name] = outlined(body, 'sphere', false);

  let handsVisible = true;

  const hands = [
    createHand((parent, geometry) => outlined(parent, geometry, false)),
    createHand((parent, geometry) => outlined(parent, geometry, false)),
  ];
  for (const hand of hands) body.add(hand.group);

  const head = new Group();
  body.add(head);
  parts.skull = outlined(head, 'sphere', false);
  parts.skull.scale.setScalar(0.13);

  const ink = new MeshBasicMaterial({ color: 0x1b1426 });
  const eyeMaterial = new MeshBasicMaterial({ color: 0x1b1426 });
  materials.push(ink, eyeMaterial);

  const eyes = [-1, 1].map((sign) => {
    const eye = new Mesh(shapes.sphere, eyeMaterial);
    eye.scale.set(0.016, 0.022, 0.016);
    eye.position.set(0.118, 0.015, sign * 0.046);
    head.add(eye);
    return eye;
  });
  const brows = [-1, 1].map((sign) => {
    const brow = new Mesh(shapes.box, ink);
    brow.scale.set(0.012, 0.011, 0.046);
    brow.position.set(0.121, 0.058, sign * 0.046);
    head.add(brow);
    return brow;
  });
  const mouth = new Mesh(shapes.box, ink);
  mouth.scale.set(0.01, 0.009, 0.05);
  mouth.position.set(0.123, -0.06, 0);
  head.add(mouth);

  // --- coiffures : une seule visible a la fois
  // Annotes `Mesh` : l habillage leur pose un materiau toon la ou ils naissent
  // avec le materiau de contour, et un type infere trop etroit l interdirait.
  const cap: Mesh = new Mesh(shapes.cap, outline);
  cap.scale.setScalar(0.136);
  cap.rotation.z = 0.35;
  cap.position.set(-0.022, 0.016, 0);
  head.add(cap);

  const spikes = new Group();
  head.add(spikes);
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < 8; i++) {
    const azimuth = (i / 7 - 0.5) * 2.4;
    const elevation = 0.45 + (i % 2) * 0.5;
    const direction = new Vector3(
      -Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    ).normalize();
    const spike = new Mesh(shapes.cone, outline);
    spike.position.copy(direction).multiplyScalar(0.13);
    spike.quaternion.setFromUnitVectors(up, direction);
    spike.scale.set(0.035, 0.14, 0.035);
    spikes.add(spike);
  }

  const hoodMaterial = new MeshToonMaterial({ color: 0xffffff, gradientMap });
  materials.push(hoodMaterial);
  const hood = new Mesh(shapes.hood, hoodMaterial);
  hood.scale.setScalar(0.185);
  hood.position.set(-0.012, -0.01, 0);
  head.add(hood);

  const auraMaterial = new MeshBasicMaterial({ color: 0xffffff });
  materials.push(auraMaterial);
  const band = new Mesh(shapes.torus, auraMaterial);
  band.scale.setScalar(0.143);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.035;
  head.add(band);

  const tails = [-1, 1].map((sign) => {
    const pivot = new Group();
    pivot.position.set(-0.13, 0.035, sign * 0.025);
    head.add(pivot);
    const tail = new Mesh(shapes.box, auraMaterial);
    tail.scale.set(0.2, 0.028, 0.012);
    tail.position.set(-0.1, 0, 0);
    pivot.add(tail);
    return pivot;
  });

  const long = new Group();
  long.position.set(-0.07, 0, 0);
  head.add(long);
  const longMesh: Mesh = new Mesh(shapes.box, outline);
  longMesh.scale.set(0.07, 0.28, 0.22);
  longMesh.position.set(-0.02, -0.13, 0);
  long.add(longMesh);

  // --- details de tenue, portes par l orientation du buste
  const tie: Mesh = new Mesh(shapes.box, ink);
  const shirt: Mesh = new Mesh(shapes.box, ink);
  const zip = new Mesh(
    shapes.box,
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  const beltMaterial = new MeshToonMaterial({ color: 0x1b1426, gradientMap });
  materials.push(zip.material, beltMaterial);
  const belt = new Mesh(shapes.belt, beltMaterial);
  body.add(tie, shirt, zip, belt);

  // --- vecteurs de travail, alloues une fois
  /** Vecteurs de travail, alloues une fois : la pose tourne soixante fois par seconde. */
  const v = {
    neck: new Vector3(),
    hip: new Vector3(),
    head: new Vector3(),
    shL: new Vector3(),
    shR: new Vector3(),
    elL: new Vector3(),
    elR: new Vector3(),
    hL: new Vector3(),
    hR: new Vector3(),
    hpL: new Vector3(),
    hpR: new Vector3(),
    knL: new Vector3(),
    knR: new Vector3(),
    ftL: new Vector3(),
    ftR: new Vector3(),
    a: new Vector3(),
    b: new Vector3(),
    forward: new Vector3(),
    upward: new Vector3(),
  };
  const direction = new Vector3();
  const rotation = new Quaternion();
  const axisX = new Vector3(1, 0, 0);
  const axisY = new Vector3(0, 1, 0);

  const setMaterial = (group: Group, material: Material): void => {
    const inner = group.children[0];
    if (inner instanceof Mesh) inner.material = material;
  };

  const setBone = (group: Group, a: Vector3, b: Vector3, radius: number, depth = radius): void => {
    direction.subVectors(b, a);
    const length = Math.max(0.0001, direction.length());
    group.position.addVectors(a, b).multiplyScalar(0.5);
    rotation.setFromUnitVectors(axisY, direction.divideScalar(length));
    group.quaternion.copy(rotation);
    group.scale.set(radius, length, depth);
  };

  const setKnot = (group: Group, at: Vector3, radius: number): void => {
    group.position.copy(at);
    group.quaternion.identity();
    group.scale.setScalar(radius);
  };

  /**
   * Le deltoide : une masse allongee le long du bras, pas une bille.
   *
   * Une sphere posee au point d epaule donne une articulation de pantin. Ce
   * qui fait lire une epaule, c est un volume qui **suit l humerus** : il
   * monte quand le bras se leve, part en avant quand le bras pointe, et
   * recouvre toujours la section haute du bras — c est lui qui ferme le
   * raccord quand le bras passe derriere le dos.
   */
  const setDeltoid = (group: Group, shoulder: Vector3, elbow: Vector3): void => {
    direction.subVectors(elbow, shoulder);
    const length = Math.max(0.0001, direction.length());
    direction.divideScalar(length);
    group.position.copy(shoulder).addScaledVector(direction, DELTOID_OFFSET);
    rotation.setFromUnitVectors(axisY, direction);
    group.quaternion.copy(rotation);
    group.scale.set(DELTOID_RADIUS, DELTOID_LENGTH, DELTOID_RADIUS);
  };

  /**
   * La ligne d epaules, d un deltoide a l autre.
   *
   * L orientation est posee explicitement plutot que deduite des deux points :
   * `setFromUnitVectors` laisse le roulis libre autour de l axe, et ce volume
   * n est pas rond — il est large d avant en arriere et plat en hauteur, ce
   * qui n a de sens que si le roulis est connu. Un quart de tour autour de x
   * envoie l axe du tube de y vers z.
   */
  const setYoke = (group: Group, at: Vector3, span: number): void => {
    group.position.copy(at);
    group.quaternion.setFromAxisAngle(axisX, Math.PI / 2);
    group.scale.set(YOKE_DEPTH, span, YOKE_THICKNESS);
  };

  let dressed = '';

  return {
    root,
    flip,
    body,
    head,
    parts,
    hands,

    setHandsVisible(visible): void {
      handsVisible = visible;
      for (const hand of hands) hand.group.visible = visible;
    },

    hair: { cap, hood, spikes, long, band },

    dress(look) {
      const key = `${look.outfit}|${look.hair}|${look.skin}|${look.aura}`;
      if (dressed === key) return;
      dressed = key;

      const outfit: Outfit = OUTFITS.find((o) => o.id === look.outfit) ?? OUTFITS[0]!;
      const hairId = HAIRSTYLES.find((h) => h.id === look.hair)?.model ?? 'court';

      /**
       * Le cote eloigne de la camera est assombri.
       *
       * Deux bras de la meme teinte se confondent des qu ils se croisent. Cet
       * ecart de valeur fait plus pour lire une pose que n importe quel ajout
       * de polygones.
       */
      const darken = (hex: string, factor: number): string =>
        `#${new Color(hex).multiplyScalar(factor).getHexString()}`;

      const jacket = toon(outfit.jacket);
      const jacketFar = toon(darken(outfit.jacket, 0.75));
      const pants = toon(outfit.pants);
      const pantsFar = toon(darken(outfit.pants, 0.72));
      const skin = toon(look.skin);

      setMaterial(parts.torso, jacket);
      // La ligne d epaules appartient au buste, pas a un bras : la teinte
      // proche, sinon le haut du torse s assombrit d un cote sans raison.
      setMaterial(parts.shoulderYoke, jacket);
      setMaterial(parts.neck, skin);
      for (const name of ['upperArmLeft', 'foreArmLeft', 'shoulderLeft', 'elbowLeft'] as const) {
        setMaterial(parts[name], jacketFar);
      }
      for (const name of [
        'upperArmRight',
        'foreArmRight',
        'shoulderRight',
        'elbowRight',
      ] as const) {
        setMaterial(parts[name], jacket);
      }
      for (const name of ['thighLeft', 'shinLeft', 'hipLeft', 'kneeLeft'] as const) {
        setMaterial(parts[name], pantsFar);
      }
      for (const name of ['thighRight', 'shinRight', 'hipRight', 'kneeRight'] as const) {
        setMaterial(parts[name], pants);
      }
      setMaterial(parts.footLeft, toon(outfit.shoes));
      setMaterial(parts.footRight, toon(outfit.shoes));
      setMaterial(parts.skull, skin);

      hands[0]?.setMaterial(toon(darken(look.skin, 0.88)));
      hands[1]?.setMaterial(skin);

      const hair = toon(HAIR_COLOR);
      cap.material = hair;
      longMesh.material = hair;
      for (const spike of spikes.children) if (spike instanceof Mesh) spike.material = hair;
      hoodMaterial.color.set(outfit.jacket);
      auraMaterial.color.set(look.aura);

      cap.visible = hairId !== 'capuche';
      spikes.visible = hairId === 'pics';
      hood.visible = hairId === 'capuche';
      band.visible = hairId === 'bandeau';
      for (const tail of tails) tail.visible = hairId === 'bandeau';
      long.visible = hairId === 'long';

      tie.visible = outfit.tie !== undefined;
      shirt.visible = outfit.shirt !== undefined || outfit.collar === true;
      zip.visible = outfit.zip === true;
      belt.visible = outfit.belt !== undefined;
      if (outfit.tie !== undefined) tie.material = toon(outfit.tie);
      if (outfit.shirt !== undefined) shirt.material = toon(outfit.shirt);
      else if (outfit.collar === true) shirt.material = toon(darken(outfit.jacket, 0.82));
      if (outfit.belt !== undefined) beltMaterial.color.set(outfit.belt);
    },

    pose(current, animation, elapsed, delta) {
      const facing = placement.facing;
      const flags = animation.flags ?? {};
      const joints = current.joints;

      /**
       * `rot` est un **lacet**, pas un roulis.
       *
       * `victory` le fait passer de 0 a 6,28 : un tour complet sur l axe
       * vertical. Applique comme un roulis, et autour d un pivot au niveau du
       * sol, il couche le personnage — faire pivoter de 0,2 rad un pied situe a
       * 26 cm du centre et 2 cm de haut le descend a -3 cm, sous le plancher.
       *
       * `pitch`, lui, est bien un roulis, mais sur `flip`, dont le pivot est a
       * mi-hauteur : c est l axe d un salto, pas celui d une chute.
       */
      root.rotation.y =
        placement.turn + current.rot * facing + (flags.noFace === true ? Math.PI * facing : 0);
      flip.rotation.z = current.pitch;

      const at = (target: Vector3, name: JointName, depth: number): Vector3 => {
        const j = joints[name];
        return target.set(j[0] * CM, -j[1] * CM, depth + j[2] * CM * facing);
      };

      /**
       * Separation en profondeur des membres.
       *
       * Les animations sont plates : les deux bras partagent le meme plan. Les
       * ecarter de part et d autre du corps est ce qui transforme un dessin en
       * volume — sans cela ils se traversent proprement, et la pose devient
       * illisible de trois quarts.
       *
       * Ces ecartements viennent de `animation/layout`, pas d ici : le cadrage
       * de la vitrine les applique aussi, et deux copies finissent toujours
       * par diverger.
       */
      const depths = skeletonDepths(flags);

      const neck = at(v.neck, 'neck', 0);
      const hip = at(v.hip, 'hip', 0);
      const skull = at(v.head, 'head', 0);

      /**
       * Les epaules, que le dessin n a pas.
       *
       * Le contenu fait partir les bras du cou. Les ecarter donne au buste une
       * vraie ligne d epaules, horizontale, au lieu d un V.
       */
      const shoulderY = neck.y - SHOULDER_DROP;
      v.shL.set(neck.x, shoulderY, neck.z + depths.shoulderLeft * facing);
      v.shR.set(neck.x, shoulderY, neck.z + depths.shoulderRight * facing);
      at(v.elL, 'le', depths.elbowLeft * facing);
      at(v.elR, 're', depths.elbowRight * facing);

      at(v.hL, 'lh', depths.handLeft * facing);
      at(v.hR, 'rh', depths.handRight * facing);
      v.hL.x += depths.handShift;
      v.hR.x += depths.handShift;
      v.elL.x += depths.elbowShift;
      v.elR.x += depths.elbowShift;

      v.hpL.set(hip.x, hip.y, hip.z + depths.hipLeft * facing);
      v.hpR.set(hip.x, hip.y, hip.z + depths.hipRight * facing);
      at(v.knL, 'lk', depths.kneeLeft * facing);
      at(v.knR, 'rk', depths.kneeRight * facing);
      at(v.ftL, 'lf', depths.footLeft * facing);
      at(v.ftR, 'rf', depths.footRight * facing);

      v.a.set(hip.x, hip.y - 0.03, hip.z);
      v.b.set(neck.x, neck.y + 0.01, neck.z);
      // Un buste un peu plus large qu au prototype : le tronc n a plus a
      // rattraper tout seul une ligne d epaules qui n existait pas.
      setBone(parts.torso, v.a, v.b, 0.13, 0.095);

      v.a.set(skull.x * 0.6 + neck.x * 0.4, skull.y - 0.1, skull.z * 0.6 + neck.z * 0.4);
      setBone(parts.neck, neck, v.a, LIMB_RADIUS.neck);

      setBone(parts.upperArmLeft, v.shL, v.elL, LIMB_RADIUS.upperArm);
      setBone(parts.foreArmLeft, v.elL, v.hL, LIMB_RADIUS.foreArm);
      setBone(parts.upperArmRight, v.shR, v.elR, LIMB_RADIUS.upperArm);
      setBone(parts.foreArmRight, v.elR, v.hR, LIMB_RADIUS.foreArm);
      setBone(parts.thighLeft, v.hpL, v.knL, LIMB_RADIUS.thigh);
      setBone(parts.shinLeft, v.knL, v.ftL, LIMB_RADIUS.shin);
      setBone(parts.thighRight, v.hpR, v.knR, LIMB_RADIUS.thigh);
      setBone(parts.shinRight, v.knR, v.ftR, LIMB_RADIUS.shin);

      setDeltoid(parts.shoulderLeft, v.shL, v.elL);
      setDeltoid(parts.shoulderRight, v.shR, v.elR);

      /**
       * La ligne d epaules relie les DELTOIDES, pas les points du squelette.
       *
       * Le deltoide est decale vers le coude : le tendre entre `shL` et `shR`
       * laissait donc deux billes depassant a chaque bout, ce qui est
       * exactement la silhouette qu on cherchait a supprimer. Le poser apres
       * eux coute un ordre d instructions et rend la mesure vraie.
       */
      v.a.addVectors(parts.shoulderLeft.position, parts.shoulderRight.position).multiplyScalar(0.5);
      // La barre est couchee le long de z : sa longueur est donc l etendue en
      // z, pas la distance 3D. Prendre la distance la faisait depasser des
      // deltoides des qu une epaule avancait.
      setYoke(
        parts.shoulderYoke,
        v.a,
        Math.abs(parts.shoulderLeft.position.z - parts.shoulderRight.position.z),
      );
      setKnot(parts.elbowLeft, v.elL, JOINT_RADIUS.elbow);
      setKnot(parts.elbowRight, v.elR, JOINT_RADIUS.elbow);
      setKnot(parts.hipLeft, v.hpL, JOINT_RADIUS.hip);
      setKnot(parts.hipRight, v.hpR, JOINT_RADIUS.hip);
      setKnot(parts.kneeLeft, v.knL, JOINT_RADIUS.knee);
      setKnot(parts.kneeRight, v.knR, JOINT_RADIUS.knee);

      if (handsVisible) {
        const specs = animation.hands.length >= 2 ? animation.hands : DEFAULT_HANDS;
        hands.forEach((hand, i) => {
          const spec: HandSpec = specs[i] ?? (['relax', 'in'] as const);
          hand.shape(spec, delta);
          hand.aim(i === 0 ? v.hL : v.hR, i === 0 ? v.elL : v.elR, spec[1] ?? 'in', delta);
        });
      }

      for (const [group, foot] of [
        [parts.footLeft, v.ftL],
        [parts.footRight, v.ftR],
      ] as const) {
        group.position.set(foot.x + 0.035, foot.y + 0.03, foot.z);
        group.quaternion.identity();
        group.scale.set(0.085, 0.045, 0.055);
      }

      head.position.copy(skull);
      head.rotation.set(0, current.hy, -(skull.x - neck.x) * 2.2);

      const quaternion = parts.torso.quaternion;
      const height = parts.torso.scale.y;
      const centre = parts.torso.position;
      v.forward.set(1, 0, 0).applyQuaternion(quaternion);
      v.upward.set(0, 1, 0).applyQuaternion(quaternion);
      if (tie.visible) {
        tie.position
          .copy(centre)
          .addScaledVector(v.upward, height * 0.12)
          .addScaledVector(v.forward, 0.127);
        tie.quaternion.copy(quaternion);
        tie.scale.set(0.012, 0.13, 0.03);
      }
      if (shirt.visible) {
        shirt.position
          .copy(centre)
          .addScaledVector(v.upward, height * 0.34)
          .addScaledVector(v.forward, 0.12);
        shirt.quaternion.copy(quaternion);
        shirt.scale.set(0.01, 0.08, 0.065);
      }
      if (zip.visible) {
        zip.position
          .copy(centre)
          .addScaledVector(v.upward, height * 0.1)
          .addScaledVector(v.forward, 0.124);
        zip.quaternion.copy(quaternion);
        zip.scale.set(0.006, height * 0.7, 0.008);
      }
      if (belt.visible) {
        belt.position.copy(centre).addScaledVector(v.upward, -height * 0.36);
        belt.quaternion.copy(quaternion);
        belt.scale.set(0.128, 0.04, 0.088);
      }

      // --- visage
      const expression = flags.expression ?? 'neutral';
      const blink = elapsed % 4.2 < 0.12 ? 0.2 : 1;
      const shut = expression === 'hurt';
      for (const eye of eyes) {
        eye.scale.y = 0.022 * blink * (expression === 'sad' ? 0.6 : 1);
        eye.visible = !shut;
      }
      const [browLeft, browRight] =
        expression === 'angry' || expression === 'hurt'
          ? [0.45, -0.45]
          : expression === 'sad'
            ? [-0.45, 0.45]
            : expression === 'smug'
              ? [0.25, -0.08]
              : [-0.1, 0.1];
      if (brows[0] !== undefined) brows[0].rotation.x = browLeft;
      if (brows[1] !== undefined) brows[1].rotation.x = browRight;
      mouth.rotation.x = expression === 'smug' ? 0.35 : expression === 'sad' ? -0.3 : 0;

      /**
       * Elevation.
       *
       * `float` vit dans `flags`, pas a la racine du document : le lire au
       * mauvais endroit ne casse rien bruyamment, la levitation cesse
       * simplement de lever. Le balancement qui l accompagne n est pas un
       * ornement — une pose flottante parfaitement stable se lit comme un
       * personnage colle en l air.
       *
       * L elevation monte la **racine**, pas le corps a l interieur du pivot.
       * C est ce qui distingue un salto d une pirouette : le pivot doit monter
       * avec le personnage. Applique au corps, le pivot reste a 0,85 m alors
       * que le corps s etend 1,45 m au-dessus — une fois retourne, la tete
       * passe a -0,6, sous le plancher.
       *
       * L appelant place donc le combattant en x et en z ; la hauteur
       * appartient au rig.
       */
      const float = flags.float ?? 0;
      const bob = float === 0 ? 0 : Math.sin(elapsed * 1.6) * 5 * Math.min(1, Math.abs(float) / 14);
      const lift = (-current.lift - float - bob) * CM;
      root.position.y = Math.max(0, lift);
    },

    dispose() {
      for (const hand of hands) hand.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      cache.clear();
    },
  };
}
