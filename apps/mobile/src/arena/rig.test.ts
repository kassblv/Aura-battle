import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAnimation, OUTFITS, SKIN_TONES, type Animation } from '@aura/content';
import {
  Box3,
  type BufferGeometry,
  type Color,
  type CylinderGeometry,
  type Group,
  type Material,
  Matrix4,
  Mesh,
  type MeshToonMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { animationBounds } from '../animation/bounds.js';
import { samplePose } from '../animation/sample.js';
import { livePose } from '../animation/secondary.js';
import { createToonGradientMap } from './toonGradient.js';
import { createFighterRig, type FighterLook } from './rig.js';

const gradientMap = createToonGradientMap();
const LOOK: FighterLook = {
  outfit: 'outfit.noir',
  hair: 'hair.court',
  skin: SKIN_TONES[0] ?? '#f3cfae',
  aura: '#b36bff',
};

const build = (turn = -0.5, facing: 1 | -1 = 1) =>
  createFighterRig({ gradientMap }, { turn, facing });

/** Les 26 animations livrees, telles que le client les chargera. */
function shippedAnimations(): readonly Animation[] {
  const root = fileURLToPath(new URL('../../../../packages/content/animations/', import.meta.url));
  const out: Animation[] = [];
  for (const style of readdirSync(root)) {
    for (const file of readdirSync(`${root}${style}`)) {
      out.push(loadAnimation(JSON.parse(readFileSync(`${root}${style}/${file}`, 'utf8'))));
    }
  }
  return out;
}

const materialOf = (object: unknown): MeshToonMaterial =>
  (object as Mesh<never, MeshToonMaterial>).material;

/**
 * Boite englobante de ce qui est **reellement affiche**.
 *
 * `Box3.setFromObject` ne regarde pas `visible` : il traverse tout. Les details
 * de tenue masques gardent une geometrie unitaire non positionnee, soit un
 * cylindre de hauteur 1 centre sur l origine — il descend a -0,5 et ferait
 * echouer toute mesure de garde au sol, sur un objet que personne ne voit.
 */
function visibleBounds(root: Object3D): Box3 {
  const box = new Box3();
  root.updateMatrixWorld(true);
  const walk = (node: Object3D): void => {
    if (!node.visible) return;
    if (node instanceof Mesh) box.expandByObject(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return box;
}

describe('createFighterRig', () => {
  it('monte un squelette complet, pas une silhouette', () => {
    const rig = build();
    // Membres en deux segments, articulations, pieds, mains, tete : ce qui
    // distingue un personnage d un bonhomme baton.
    expect(rig.parts.torso).toBeDefined();
    expect(rig.parts.upperArmLeft).toBeDefined();
    expect(rig.parts.foreArmLeft).toBeDefined();
    expect(rig.parts.thighRight).toBeDefined();
    expect(rig.parts.shinRight).toBeDefined();
    expect(rig.parts.elbowLeft).toBeDefined();
    expect(rig.parts.kneeRight).toBeDefined();
    expect(rig.hands).toHaveLength(2);
    rig.dispose();
  });

  it('donne un contour a chaque volume', () => {
    const rig = build();
    // Le contour est une copie dilatee rendue en BackSide : sans lui, un
    // personnage toon d une seule teinte est une silhouette plate.
    expect(rig.parts.torso.children).toHaveLength(2);
    rig.dispose();
  });
});

describe('habillage', () => {
  it('pose la veste sur le buste, le pantalon sur les jambes, les chaussures aux pieds', () => {
    const rig = build();
    rig.dress(LOOK);
    const outfit = OUTFITS.find((o) => o.id === 'outfit.noir');
    expect(materialOf(rig.parts.torso.children[0]).color.getHexString()).toBe(
      outfit?.jacket.slice(1),
    );
    expect(materialOf(rig.parts.thighRight.children[0]).color.getHexString()).toBe(
      outfit?.pants.slice(1),
    );
    expect(materialOf(rig.parts.footLeft.children[0]).color.getHexString()).toBe(
      outfit?.shoes.slice(1),
    );
    rig.dispose();
  });

  /**
   * Deux bras de la meme teinte se confondent des qu ils se croisent. Cet ecart
   * de valeur fait plus pour lire une pose que n importe quel ajout de
   * polygones.
   */
  it('assombrit le cote eloigne de la camera', () => {
    const rig = build();
    rig.dress(LOOK);
    const near = materialOf(rig.parts.upperArmRight.children[0]).color;
    const far = materialOf(rig.parts.upperArmLeft.children[0]).color;
    expect(far.getHex()).toBeLessThan(near.getHex());
    rig.dispose();
  });

  /*
    La tenue offerte est noire, sur une nuit violette : mesure faite, le buste
    rendait plus sombre que la foule derriere lui. Le liseré le detoure, dans
    la couleur d aura du joueur.
  */
  it('detoure le personnage dans sa couleur d aura', () => {
    const rig = build();
    rig.dress({ ...LOOK, aura: '#4fe3ff' });
    const torso = materialOf(rig.parts.torso.children[0]);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      fragmentShader: '#include <opaque_fragment>',
      vertexShader: '',
    };
    torso.onBeforeCompile(shader as never, undefined as never);
    expect((shader.uniforms.rimColor?.value as Color).getHexString()).toBe('4fe3ff');
    rig.dispose();
  });

  it('ne rehabille pas quand l apparence n a pas bouge', () => {
    const rig = build();
    rig.dress(LOOK);
    const before = materialOf(rig.parts.torso.children[0]);
    rig.dress({ ...LOOK });
    expect(materialOf(rig.parts.torso.children[0])).toBe(before);
    rig.dispose();
  });

  it('ne montre qu une coiffure a la fois', () => {
    const rig = build();
    rig.dress({ ...LOOK, hair: 'hair.capuche' });
    expect(rig.hair.hood.visible).toBe(true);
    expect(rig.hair.cap.visible).toBe(false);
    rig.dress({ ...LOOK, hair: 'hair.pics' });
    expect(rig.hair.hood.visible).toBe(false);
    expect(rig.hair.spikes.visible).toBe(true);
    rig.dispose();
  });
});

/** Une pose debout minimale, avec le lacet et le salto qu on veut eprouver. */
const animation = (rot: number, pitch = 0): Animation =>
  loadAnimation({
    id: 'anim.test',
    version: 1,
    name: { fr: 'Test' },
    move: { style: 'calme', tier: 0 },
    loop: { duration: 1 },
    hands: [
      ['relax', 'in'],
      ['relax', 'in'],
    ],
    frames: [
      {
        joints: {
          head: [0, -150],
          neck: [0, -130],
          hip: [0, -78],
          le: [-16, -104],
          lh: [-10, -80],
          re: [16, -104],
          rh: [10, -80],
          lk: [-10, -42],
          lf: [-6, -2],
          rk: [10, -42],
          rf: [6, -2],
        },
        rot,
        pitch,
      },
    ],
  });

describe('mise en pose', () => {
  /**
   * Regression. `rot` vaut jusqu a 6,28 dans `victory` : c est un tour complet
   * sur l axe vertical. Applique comme un roulis, et autour d un pivot au
   * niveau du sol, il couchait le personnage et lui enfoncait un pied sous le
   * plancher.
   */
  it('traite rot comme un lacet, sur la racine', () => {
    const rig = build(-0.5, 1);
    rig.dress(LOOK);
    rig.pose(samplePose(animation(1.2), 0), animation(1.2), 0, 1 / 60);
    expect(rig.root.rotation.y).toBeCloseTo(-0.5 + 1.2, 6);
    expect(rig.root.rotation.z).toBeCloseTo(0, 6);
    rig.dispose();
  });

  it('traite pitch comme un roulis, sur le pivot de salto', () => {
    const rig = build();
    rig.dress(LOOK);
    const anim = animation(0, 0.8);
    rig.pose(samplePose(anim, 0), anim, 0, 1 / 60);
    // Le pivot est a mi-hauteur : c est l axe d un salto, pas d une chute.
    expect(rig.flip.rotation.z).toBeCloseTo(0.8, 6);
    expect(rig.flip.position.y).toBeGreaterThan(0.5);
    rig.dispose();
  });

  it('convertit les centimetres du contenu en metres, y vers le haut', () => {
    const rig = build(0, 1);
    rig.dress(LOOK);
    const anim = animation(0);
    rig.pose(samplePose(anim, 0), anim, 0, 1 / 60);
    // Tete a -150 cm dans le contenu : 1,50 m au-dessus du sol du personnage.
    expect(rig.head.position.y).toBeCloseTo(1.5, 2);
    rig.dispose();
  });

  /**
   * Regression, et le test qui compte vraiment : aucune partie d aucune
   * animation livree ne doit passer sous le plancher, a aucun instant.
   */
  it('ne fait jamais passer un personnage sous le sol', () => {
    const rig = build(-0.5, 1);
    rig.dress(LOOK);
    const fautes: string[] = [];

    for (const anim of shippedAnimations()) {
      for (let step = 0; step < 24; step++) {
        const t = (anim.loop.duration * step) / 24;
        rig.pose(samplePose(anim, t), anim, t, 1 / 60);
        const box = visibleBounds(rig.root);
        // Quatre centimetres de tolerance : la sphere de pied et son contour
        // dilate mordent legerement le sol, exactement comme dans le prototype.
        if (box.min.y < -0.04) {
          fautes.push(`${anim.id} a t=${t.toFixed(2)} : y=${box.min.y.toFixed(3)}`);
          break;
        }
      }
    }

    expect(fautes).toEqual([]);
    rig.dispose();
  });

  /**
   * `float` vit dans `flags`, pas a la racine du document. Le lire au mauvais
   * endroit ne casse rien bruyamment : la levitation cesse simplement de lever.
   */
  it('souleve une pose flottante', () => {
    const rig = build();
    rig.dress(LOOK);
    const flat = animation(0);
    rig.pose(samplePose(flat, 0), flat, 0, 1 / 60);
    const grounded = rig.root.position.y;

    const floating = loadAnimation({
      ...(flat as unknown as Record<string, unknown>),
      flags: { float: -34 },
    });
    rig.pose(samplePose(floating, 0), floating, 0, 1 / 60);
    // L elevation monte la racine : le pivot de salto doit monter avec.
    expect(rig.root.position.y).toBeGreaterThan(grounded + 0.2);
    rig.dispose();
  });
});

describe('mains', () => {
  it('referme les doigts sur un poing et les ouvre sur une main ouverte', () => {
    const rig = build();
    rig.dress(LOOK);
    const hand = rig.hands[0];
    if (hand === undefined) throw new Error('main absente');

    for (let i = 0; i < 90; i++) hand.shape(['fist', 'in'], 1 / 60);
    const closed = hand.curl[0] ?? 0;
    for (let i = 0; i < 90; i++) hand.shape(['open', 'in'], 1 / 60);
    const open = hand.curl[0] ?? 1;

    expect(closed).toBeGreaterThan(0.9);
    expect(open).toBeLessThan(0.1);
    rig.dispose();
  });

  it('ne claque pas d une forme a l autre', () => {
    const rig = build();
    rig.dress(LOOK);
    const hand = rig.hands[0];
    if (hand === undefined) throw new Error('main absente');
    for (let i = 0; i < 90; i++) hand.shape(['open', 'in'], 1 / 60);
    hand.shape(['fist', 'in'], 1 / 60);
    // Une main qui passe d ouverte a fermee en une image se lit comme un defaut.
    expect(hand.curl[0] ?? 0).toBeLessThan(0.4);
    rig.dispose();
  });
});

/**
 * Les deux maillages d un volume : la forme, puis son contour dilate.
 *
 * On verifie les deux. Un raccord propre sur la forme mais pas sur le contour
 * laisse un anneau noir a la jonction, ce qui se lit exactement comme la
 * marche qu on cherche a eviter.
 */
/**
 * Un maillage aux generiques fixes.
 *
 * `node instanceof Mesh` reduit vers `Mesh<any, any, any>` : les parametres de
 * type de Three valent `any` par defaut, et tout ce qu'on lit ensuite —
 * `geometry`, `material` — devient `any` a son tour. Nommer le type une fois
 * rend la suite verifiee.
 */
type TypedMesh = Mesh<BufferGeometry, Material | Material[]>;

const isMesh = (node: Object3D): node is TypedMesh => node instanceof Mesh;

const shell = (group: Group, outline: boolean): TypedMesh => {
  const mesh = group.children[outline ? 1 : 0];
  if (mesh === undefined || !isMesh(mesh)) throw new Error('volume sans maillage');
  return mesh;
};

/**
 * La section d un os a l une de ses extremites, en coordonnees du monde.
 *
 * Les rayons sont lus sur la geometrie plutot que recopies : c est elle qui
 * porte le galbe, et un test qui redeclare les memes nombres ne verifie plus
 * rien le jour ou ils changent.
 */
function boneSection(group: Group, end: 'racine' | 'extremite', outline: boolean): Vector3[] {
  const mesh = shell(group, outline);
  const { radiusTop, radiusBottom } = (mesh.geometry as CylinderGeometry).parameters;
  const tip = end === 'extremite';
  const radius = tip ? radiusTop : radiusBottom;
  const y = tip ? 0.5 : -0.5;
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius).applyMatrix4(
      mesh.matrixWorld,
    );
  });
}

/**
 * Profondeur d un point dans une articulation, 1 = sa surface.
 *
 * L articulation est une sphere unitaire mise a l echelle : il suffit de
 * repasser le point dans son repere pour savoir s il est dedans, quelle que
 * soit l orientation du deltoide.
 */
const local = new Matrix4();
function insideJoint(joint: Group, point: Vector3, outline: boolean): number {
  const mesh = shell(joint, outline);
  local.copy(mesh.matrixWorld).invert();
  return point.clone().applyMatrix4(local).length();
}

/** Rayon horizontal et sommet de ce qui est reellement dessine, sommet par sommet. */
function drawnExtent(root: Object3D): { radius: number; maxY: number } {
  root.updateMatrixWorld(true);
  const point = new Vector3();
  let radius = 0;
  let maxY = Number.NEGATIVE_INFINITY;
  const walk = (node: Object3D): void => {
    if (!node.visible) return;
    if (isMesh(node)) {
      const positions = node.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
        radius = Math.max(radius, Math.hypot(point.x, point.z));
        maxY = Math.max(maxY, point.y);
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return { radius, maxY };
}

describe('bras et epaules', () => {
  it('galbe les membres au lieu de poser des tuyaux', () => {
    const rig = build();
    // Un membre plus fin a l extremite qu a la racine : c est la seule chose
    // qui distingue un bras d un tube de meme volume.
    for (const name of ['upperArmLeft', 'foreArmLeft', 'thighRight', 'shinRight'] as const) {
      const { radiusTop, radiusBottom } = (
        shell(rig.parts[name], false).geometry as CylinderGeometry
      ).parameters;
      expect(radiusTop, name).toBeLessThan(radiusBottom * 0.85);
    }
    rig.dispose();
  });

  it('donne des epaules plus larges que le buste', () => {
    const rig = build(0, 1);
    rig.dress(LOOK);
    const anim = animation(0);
    rig.pose(samplePose(anim, 0), anim, 0, 1 / 60);

    // Le contenu fait partir les bras du cou : sans deltoides ecartes, la
    // silhouette n a pas d epaules du tout, juste un buste et deux tubes.
    const span = Math.abs(rig.parts.shoulderLeft.position.z - rig.parts.shoulderRight.position.z);
    expect(span).toBeGreaterThan(rig.parts.torso.scale.z * 2);
    // Et une ligne d epaules qui les relie au buste, sinon ce sont deux
    // billes posees de part et d autre d un tronc etroit.
    expect(rig.parts.shoulderYoke.scale.y).toBeCloseTo(span, 6);
    rig.dispose();
  });

  /*
    « Les bras sont trop colles. » Le buste etait plus profond (26 cm) que
    large (19 cm) — un tronc de profil — et les coudes, a 12,6 cm de l axe,
    s enfoncaient de trois centimetres dans ses flancs : le bras disparaissait
    dans le buste, surtout de trois quarts.
  */
  it('donne un buste plus large que profond', () => {
    const rig = build();
    const anim = shippedAnimations().find((a) => a.id === 'anim.calme.t1.stride')!;
    rig.pose(samplePose(anim, 0), anim, 0, 1 / 60);
    expect(rig.parts.torso.scale.z).toBeGreaterThan(rig.parts.torso.scale.x);
    rig.dispose();
  });

  it('decolle du buste un bras qui pend, contour compris', () => {
    const rig = build();
    const fautes: string[] = [];
    for (const id of ['anim.calme.t1.stride', 'anim.calme.t1.pocket', 'anim.hype.t2.goal']) {
      const anim = shippedAnimations().find((a) => a.id === id)!;
      for (let step = 0; step < 8; step++) {
        const t = (anim.loop.duration * step) / 8;
        rig.pose(samplePose(anim, t), anim, t, 1 / 60);
        const torso = rig.parts.torso;
        for (const elbow of [rig.parts.elbowLeft, rig.parts.elbowRight]) {
          // Seul un coude a hauteur du buste peut s y enfoncer.
          if (elbow.position.y > torso.position.y + torso.scale.y / 2) continue;
          const outline = elbow.scale.x * 1.17;
          const gap = Math.abs(elbow.position.z - torso.position.z) - outline - torso.scale.z;
          if (gap <= 0) fautes.push(`${id} t=${t.toFixed(2)} : ${(gap * 100).toFixed(1)} cm`);
        }
      }
    }
    expect(fautes).toEqual([]);
    rig.dispose();
  });

  it('ne laisse ni marche ni trou a l epaule et au coude', () => {
    const rig = build(-0.5, 1);
    rig.dress(LOOK);
    const fautes: string[] = [];

    for (const anim of shippedAnimations()) {
      for (let step = 0; step < 16; step++) {
        const t = (anim.loop.duration * step) / 16;
        rig.pose(samplePose(anim, t), anim, t, 1 / 60);
        rig.root.updateMatrixWorld(true);

        const raccords = [
          ['epaule gauche', rig.parts.shoulderLeft, rig.parts.upperArmLeft, 'racine'],
          ['epaule droite', rig.parts.shoulderRight, rig.parts.upperArmRight, 'racine'],
          ['coude gauche haut', rig.parts.elbowLeft, rig.parts.upperArmLeft, 'extremite'],
          ['coude gauche bas', rig.parts.elbowLeft, rig.parts.foreArmLeft, 'racine'],
          ['coude droit haut', rig.parts.elbowRight, rig.parts.upperArmRight, 'extremite'],
          ['coude droit bas', rig.parts.elbowRight, rig.parts.foreArmRight, 'racine'],
        ] as const;

        for (const [nom, joint, bone, end] of raccords) {
          for (const outline of [false, true]) {
            for (const point of boneSection(bone, end, outline)) {
              const depth = insideJoint(joint, point, outline);
              if (depth > 1) {
                fautes.push(
                  `${anim.id} a t=${t.toFixed(2)} : ${nom}${outline ? ' (contour)' : ''} deborde de ${((depth - 1) * 100).toFixed(1)} %`,
                );
              }
            }
          }
        }
      }
    }

    expect(fautes.slice(0, 5)).toEqual([]);
    rig.dispose();
  });
});

/**
 * Le cadrage de la vitrine doit suivre la geometrie.
 *
 * `animationBounds` mesure un squelette, le rig dessine des volumes autour :
 * tant que les deux recopiaient les memes ecartements, la T-pose, la toupie,
 * le haussement d epaules et la levitation debordaient du cadre de sept
 * centimetres. Ce test-la est le seul qui l aurait vu.
 */
describe('ce qui est dessine tient dans ce qui est cadre', () => {
  /*
    Delai explicite : ce test est lourd PAR NATURE.

    Vingt-six animations, seize poses chacune, et a chaque pose un parcours
    complet du graphe de scene pour mesurer ce qui est dessine. Environ six
    secondes sur une machine au repos — donc au-dessus du delai par defaut de
    cinq, et il tombait des que Turbo lancait les autres paquets en parallele.

    Echantillonner moins irait plus vite et couterait la seule chose qui
    justifie ce test : son commentaire dit qu'il est le SEUL a avoir vu quatre
    animations deborder de sept centimetres. On paie les secondes.
  */
  it('sur les 26 animations livrees', { timeout: 30_000 }, () => {
    const rig = build(-0.5, 1);
    rig.dress(LOOK);
    const fautes: string[] = [];

    for (const anim of shippedAnimations()) {
      const bounds = animationBounds(anim);
      for (let step = 0; step < 16; step++) {
        const t = (anim.loop.duration * step) / 16;
        // La pose AFFICHEE, mouvement secondaire compris, a pleine ferveur :
        // c est elle que la camera doit contenir, pas la pose ecrite.
        rig.pose(livePose(anim, t, 0, { hype: 1, reducedMotion: false }), anim, t, 1 / 60);
        const { radius, maxY } = drawnExtent(rig.root);
        if (radius > bounds.radius) {
          fautes.push(
            `${anim.id} deborde en largeur : ${radius.toFixed(3)} contre ${bounds.radius.toFixed(3)}`,
          );
          break;
        }
        if (maxY > bounds.maxY) {
          fautes.push(
            `${anim.id} deborde en hauteur : ${maxY.toFixed(3)} contre ${bounds.maxY.toFixed(3)}`,
          );
          break;
        }
      }
    }

    expect(fautes).toEqual([]);
    rig.dispose();
  });
});

describe('mains, palier de qualite', () => {
  /*
    Les mains sont le dernier levier de qualite, et le plus cher a perdre :
    ce sont elles qui portent la moitie des poses du contenu. Au palier le plus
    bas, elles ne sont plus dessinees — et surtout plus mises en pose, sinon on
    paierait encore l interpolation de huit doigts par combattant et par image
    pour des noeuds que personne ne voit.
  */

  /**
   * Une animation livree, et la forme de main que son premier doigt **ne**
   * demande **pas**.
   *
   * Sans ca le test serait vide : si on ferme le poing a la main alors que
   * l animation voulait deja un poing, la pose ne change rien et on ne peut
   * plus distinguer « les doigts ne bougent plus » de « ils sont deja la ».
   */
  function opposedSetup(): { animation: Animation; opposite: 'fist' | 'open' } {
    const animation = shippedAnimations()[0];
    if (animation === undefined) throw new Error('aucune animation livree');
    const wanted = animation.hands[0]?.[0];
    return { animation, opposite: wanted === 'fist' ? 'open' : 'fist' };
  }

  it('dessine les mains par defaut', () => {
    const rig = build();
    expect(rig.hands.every((hand) => hand.group.visible)).toBe(true);
    rig.dispose();
  });

  it('retire les mains quand le palier les coupe', () => {
    const rig = build();
    rig.setHandsVisible(false);
    expect(rig.hands.every((hand) => hand.group.visible)).toBe(false);
    rig.dispose();
  });

  it('cesse de mettre les doigts en pose une fois les mains coupees', () => {
    const { animation, opposite } = opposedSetup();
    const rig = build();
    rig.dress(LOOK);
    const hand = rig.hands[0];
    if (hand === undefined) throw new Error('main absente');

    for (let i = 0; i < 90; i++) hand.shape([opposite, 'in'], 1 / 60);
    const before = hand.curl[0] ?? 0;

    rig.setHandsVisible(false);
    for (let i = 0; i < 90; i++) {
      rig.pose(samplePose(animation, 0.5), animation, i / 60, 1 / 60);
    }
    expect(hand.curl[0] ?? 0).toBeCloseTo(before, 6);
    rig.dispose();
  });

  it('remet les doigts en pose quand le palier remonte', () => {
    const { animation, opposite } = opposedSetup();
    const rig = build();
    rig.dress(LOOK);
    rig.setHandsVisible(false);
    rig.setHandsVisible(true);
    const hand = rig.hands[0];
    if (hand === undefined) throw new Error('main absente');

    for (let i = 0; i < 90; i++) hand.shape([opposite, 'in'], 1 / 60);
    const before = hand.curl[0] ?? 0;
    for (let i = 0; i < 90; i++) {
      rig.pose(samplePose(animation, 0.5), animation, i / 60, 1 / 60);
    }
    expect(hand.curl[0] ?? 0).not.toBeCloseTo(before, 6);
    expect(rig.hands.every((h) => h.group.visible)).toBe(true);
    rig.dispose();
  });
});
