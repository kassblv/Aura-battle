import { DataTexture, NearestFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three';

/**
 * Les trois paliers d eclairage du rendu toon : ombre, demi-teinte, lumiere.
 * Valeurs reprises telles quelles du prototype.
 */
export const TOON_GRADIENT_STEPS = new Uint8Array([80, 160, 255]);

/**
 * Texture de degrade partagee par tous les `MeshToonMaterial` de l arene.
 *
 * Le prototype tourne sur r128 et passe `LuminanceFormat`, retire depuis.
 * `RedFormat` decrit le meme buffer a canal unique et donne le meme resultat
 * (voir CLAUDE.md, « Pieges connus »).
 *
 * Deux contraintes que la doc de `MeshToonMaterial.gradientMap` impose :
 *
 * 1. `minFilter` et `magFilter` doivent valoir `NearestFilter`. Sans cela le
 *    materiau interpole les paliers, l eclairage redevient continu et il ne
 *    reste plus rien du rendu toon — c est l identite visuelle du jeu.
 * 2. `colorSpace` doit rester `NoColorSpace` : ce degrade n est pas une
 *    couleur, c est une donnee. Le convertir en sRGB deplacerait les paliers.
 *
 * `DataTexture` donne deja ces valeurs par defaut ; on les ecrit quand meme,
 * parce qu un defaut n est pas un contrat et que le test les verrouille.
 */
export function createToonGradientMap(): DataTexture {
  const map = new DataTexture(
    TOON_GRADIENT_STEPS.slice(),
    TOON_GRADIENT_STEPS.length,
    1,
    RedFormat,
    UnsignedByteType,
  );
  map.minFilter = NearestFilter;
  map.magFilter = NearestFilter;
  map.colorSpace = NoColorSpace;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return map;
}
