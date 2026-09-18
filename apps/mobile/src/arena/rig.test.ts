import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAnimation, OUTFITS, SKIN_TONES, type Animation } from '@aura/content';
import { Box3, Mesh, type MeshToonMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { samplePose } from '../animation/sample.js';
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

describe('mise en pose', () => {
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
