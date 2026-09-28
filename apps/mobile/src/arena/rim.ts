import { Color, type MeshToonMaterial } from 'three';

/**
 * Liseré de contour : la lumiere qui accroche le bord d un volume.
 *
 * Le contre-jour directionnel de `lighting.ts` n eclaire que les faces
 * tournees vers lui : de trois quarts, il ne pose presque rien sur le buste
 * d un combattant, et une tenue sombre — la tenue offerte est noire — se
 * confondait avec la nuit du fond. Mesure faite, le buste rendait plus sombre
 * que la foule derriere lui : le sujet disparaissait dans son decor.
 *
 * Ce liseré-la ne depend d aucune lumiere : il suit l angle entre la surface
 * et le regard, donc il dessine TOUJOURS la silhouette, quel que soit l angle
 * d orbite. Il est franc, pas degrade — deux paliers, comme le reste du rendu
 * toon.
 *
 * Aucun appel de dessin de plus : c est trois lignes injectees dans le
 * programme du materiau, et tous les materiaux d un meme porteur partagent le
 * meme programme (`customProgramCacheKey`).
 */

export interface RimUniforms {
  readonly rimColor: { value: Color };
  /** Intensite ajoutee au bord, 0 pour eteindre. */
  readonly rimStrength: { value: number };
}

/** Ou commence le liseré, en `1 - n.v` : 0 face au regard, 1 a la tangente. */
export const RIM_FROM = 0.6;

/** Largeur du passage au palier plein, etroite pour rester un trait. */
export const RIM_SOFTNESS = 0.08;

/**
 * Le cote qui recoit le liseré, dans le repere de la camera : en haut, un peu
 * a gauche.
 *
 * Un liseré tout autour de la forme se lit comme un deuxieme contour, un trait
 * au neon — essaye, et le personnage ressemblait a un panneau lumineux. Borne
 * a un cote, il se lit comme une lumiere qui vient de quelque part.
 */
export const RIM_SIDE: readonly [number, number, number] = [-0.33, 0.94, 0];

export function createRimUniforms(color = '#ffffff', strength = 0.5): RimUniforms {
  return { rimColor: { value: new Color(color) }, rimStrength: { value: strength } };
}

const DECLARATIONS = /* glsl */ `
uniform vec3 rimColor;
uniform float rimStrength;
`;

const RIM = /* glsl */ `
  float rimFacing = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float rimEdge = smoothstep( ${RIM_FROM.toFixed(3)}, ${(RIM_FROM + RIM_SOFTNESS).toFixed(3)}, rimFacing );
  rimEdge *= smoothstep( -0.05, 0.35, dot( normal, vec3( ${RIM_SIDE.map((n) => n.toFixed(3)).join(', ')} ) ) );
  outgoingLight += rimColor * rimEdge * rimStrength;
`;

/**
 * Ajoute le liseré a un materiau toon.
 *
 * `key` separe les programmes : deux porteurs qui injectent la meme chose
 * partagent le leur, mais un materiau toon ordinaire — le decor — ne doit
 * jamais recevoir un programme qui attend des uniformes qu il n a pas.
 */
export function withRim(material: MeshToonMaterial, uniforms: RimUniforms, key = 'rim'): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = uniforms.rimColor;
    shader.uniforms.rimStrength = uniforms.rimStrength;
    shader.fragmentShader = DECLARATIONS + injectRim(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => key;
}

/**
 * Pose le calcul juste avant la sortie opaque.
 *
 * Exporte pour le test : si Three.js renomme ce morceau, comme il a renomme
 * `output_fragment` en r154, l injection ne trouverait plus sa place et le
 * liseré disparaitrait sans la moindre erreur.
 */
export function injectRim(fragmentShader: string): string {
  const anchor = '#include <opaque_fragment>';
  if (!fragmentShader.includes(anchor)) {
    throw new Error('Liseré : le programme toon n a plus de sortie opaque ou se greffer.');
  }
  return fragmentShader.replace(anchor, `${RIM}\n${anchor}`);
}
