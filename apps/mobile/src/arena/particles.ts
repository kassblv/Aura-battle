import {
  AdditiveBlending,
  type Blending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';

/**
 * Le puits a particules (port de `makePoints` / `P` / `commit` du prototype).
 *
 * Toutes les particules de l arene — les deux auras, et demain les eclats du
 * choc — se dessinent en **deux appels** : un tampon additif pour la lumiere,
 * un tampon normal pour la fumee. Des centaines de sprites individuels
 * couteraient autant d appels de dessin, ce que le budget mobile ne tient pas.
 *
 * Chaque image : `begin()`, puis autant de `add()` / `dark()` que voulu, puis
 * `commit()`. Rien n est conserve d une image sur l autre — l etat des
 * particules vit dans `aura.ts`, ici il n y a qu un tampon.
 */

/** Plafond de points par tampon. Au-dela, les demandes sont ignorees. */
export const ADDITIVE_CAPACITY = 2400;
export const DARK_CAPACITY = 600;

/** En dessous, le point n apparaitrait pas : inutile de payer son sommet. */
const MIN_ALPHA = 0.003;

/** Ce que voit un emetteur : deux facons de poser un point, rien d autre. */
export interface ParticleSink {
  /** Point lumineux, en melange additif. */
  add(x: number, y: number, z: number, color: string, alpha: number, size: number): void;
  /** Point opaque et sombre : la fumee, qui doit cacher au lieu d eclairer. */
  dark(x: number, y: number, z: number, color: string, alpha: number, size: number): void;
}

export interface ParticleFields extends ParticleSink {
  readonly group: Group;
  /** Points reellement ecrits depuis le dernier `begin()`. */
  readonly counts: { readonly additive: number; readonly dark: number };
  begin(): void;
  commit(): void;
  /**
   * Met a jour le facteur qui convertit une taille en metres en pixels.
   * A recalculer a chaque redimensionnement.
   */
  setProjectionScale(scale: number): void;
  dispose(): void;
}

/**
 * Combien de pixels vaut un metre a un metre de la camera.
 *
 * Sans cela, un point garde la meme taille a l ecran quelle que soit sa
 * distance : les particules du fond paraissent aussi grosses que celles du
 * premier plan, et toute la profondeur de l arene s aplatit.
 */
export function projectionScale(heightPx: number, pixelRatio: number, fovDegrees: number): number {
  const halfFov = (fovDegrees * Math.PI) / 360;
  return (heightPx * pixelRatio) / (2 * Math.tan(halfFov));
}

/**
 * Couleurs en sRGB brut, comme le prototype.
 *
 * Volontairement **sans** gestion de couleur : le fragment ecrit la valeur
 * telle quelle et le tampon de sortie est deja en sRGB. Passer par `Color`
 * convertirait l hexadecimal en lineaire (Three.js ≥ r152) sans que rien ne le
 * reconvertisse ensuite — les particules sortiraient nettement plus sombres
 * que la couleur d aura choisie par le joueur.
 */
const rgbCache = new Map<string, readonly [number, number, number]>();

export function srgbComponents(hex: string): readonly [number, number, number] {
  const cached = rgbCache.get(hex);
  if (cached !== undefined) return cached;
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const rgb = Object.freeze([
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ] as const);
  rgbCache.set(hex, rgb);
  return rgb;
}

const VERTEX_SHADER = `
attribute float size;
attribute vec4 acolor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = acolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, size * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

/** Un disque adouci : sans le degre, on verrait des carres. */
const FRAGMENT_SHADER = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 1.5);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}
`;

interface Buffer {
  readonly points: Points;
  readonly geometry: BufferGeometry;
  readonly material: ShaderMaterial;
  readonly position: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly capacity: number;
  count: number;
}

function createBuffer(capacity: number, blending: Blending, name: string): Buffer {
  const geometry = new BufferGeometry();
  const position = new Float32Array(capacity * 3);
  const color = new Float32Array(capacity * 4);
  const size = new Float32Array(capacity);

  geometry.setAttribute('position', new BufferAttribute(position, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('acolor', new BufferAttribute(color, 4).setUsage(DynamicDrawUsage));
  geometry.setAttribute('size', new BufferAttribute(size, 1).setUsage(DynamicDrawUsage));

  const material = new ShaderMaterial({
    uniforms: { uScale: { value: 500 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending,
  });

  const points = new Points(geometry, material);
  points.name = name;
  // Le nuage change de forme a chaque image : son englobant serait recalcule
  // pour rien, et un englobant perime ferait disparaitre les particules.
  points.frustumCulled = false;
  // La fumee passe avant la lumiere, sinon elle l efface.
  points.renderOrder = blending === NormalBlending ? 1 : 2;

  return { points, geometry, material, position, color, size, capacity, count: 0 };
}

function push(
  buffer: Buffer,
  x: number,
  y: number,
  z: number,
  hex: string,
  alpha: number,
  size: number,
): void {
  if (buffer.count >= buffer.capacity || alpha <= MIN_ALPHA) return;
  const i = buffer.count++;
  const rgb = srgbComponents(hex);
  buffer.position[i * 3] = x;
  buffer.position[i * 3 + 1] = y;
  buffer.position[i * 3 + 2] = z;
  buffer.color[i * 4] = rgb[0];
  buffer.color[i * 4 + 1] = rgb[1];
  buffer.color[i * 4 + 2] = rgb[2];
  buffer.color[i * 4 + 3] = alpha;
  buffer.size[i] = size;
}

function commitBuffer(buffer: Buffer): void {
  buffer.geometry.setDrawRange(0, buffer.count);
  for (const name of ['position', 'acolor', 'size']) {
    const attribute = buffer.geometry.getAttribute(name);
    // `updateRanges` limiterait le transfert aux points ecrits ; le gain est
    // nul tant que le tampon tient dans une seule ecriture.
    attribute.needsUpdate = true;
  }
}

export function createParticleFields(): ParticleFields {
  const group = new Group();
  group.name = 'particles';

  const additive = createBuffer(ADDITIVE_CAPACITY, AdditiveBlending, 'particles-additive');
  const dark = createBuffer(DARK_CAPACITY, NormalBlending, 'particles-dark');
  group.add(dark.points, additive.points);

  let disposed = false;

  return {
    group,

    get counts() {
      return { additive: additive.count, dark: dark.count };
    },

    begin(): void {
      additive.count = 0;
      dark.count = 0;
    },

    add(x, y, z, color, alpha, size): void {
      push(additive, x, y, z, color, alpha, size);
    },

    dark(x, y, z, color, alpha, size): void {
      push(dark, x, y, z, color, alpha, size);
    },

    commit(): void {
      commitBuffer(additive);
      commitBuffer(dark);
    },

    setProjectionScale(scale): void {
      additive.material.uniforms.uScale!.value = scale;
      dark.material.uniforms.uScale!.value = scale;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const buffer of [additive, dark]) {
        buffer.geometry.dispose();
        buffer.material.dispose();
      }
      group.clear();
    },
  };
}
