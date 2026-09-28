import { type Color, DirectionalLight, Group, HemisphereLight, SRGBColorSpace } from 'three';
import { arenaMood, type Rgb } from './mood.js';

/**
 * Eclairage de l arene.
 *
 * Trois sources suffisent au rendu toon : une ambiance qui teinte le haut et le
 * bas, une lumiere principale de face, et un contre-jour qui detoure les
 * combattants sur le fond sombre.
 *
 * Elles ne sont plus fixes. `update(hype)` fait basculer la dominante avec la
 * ferveur du public — froide et basse pendant la recharge, chaude et haute a
 * la revelation. Ce qui vaut la peine d etre dit ici : ces trois lumieres sont
 * **directionnelle et hemispherique**, c est-a-dire exactement les deux types
 * que la refonte de l eclairage de Three.js n a pas touches. Les intensites du
 * prototype se transposent telles quelles ; ce n est pas le cas des lumieres
 * ponctuelles, dont l attenuation en inverse du carre est desormais permanente.
 */
export interface ArenaLighting {
  readonly group: Group;
  readonly ambient: HemisphereLight;
  readonly key: DirectionalLight;
  readonly back: DirectionalLight;
  /** `hype` entre 0 et 1 : fait basculer la dominante de la salle. */
  update(hype: number): void;
  dispose(): void;
}

function paint(color: Color, rgb: Rgb): void {
  color.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

export function createLighting(): ArenaLighting {
  const group = new Group();
  group.name = 'lighting';

  const ambient = new HemisphereLight(0xa48cff, 0x1a0c33, 0.85);
  ambient.name = 'ambient';

  const key = new DirectionalLight(0xffffff, 0.75);
  key.name = 'key';
  key.position.set(2.5, 4, 5);

  const back = new DirectionalLight(0x9a6bff, 0.8);
  back.name = 'back';
  // Bas et derriere : le contre-jour doit passer **sous** la ligne des epaules
  // pour poser un liseré sur la nuque et le haut des bras. Pose trop haut, il
  // n eclaire que le sol, et les combattants restent des taches sombres.
  back.position.set(-3, 2.2, -6);

  group.add(ambient, key, back);

  /** La ferveur de la derniere image : inutile de repeindre si rien ne bouge. */
  let lastHype = Number.NaN;

  const lighting: ArenaLighting = {
    group,
    ambient,
    key,
    back,

    update(hype: number): void {
      if (hype === lastHype) return;
      lastHype = hype;
      const mood = arenaMood(hype);
      paint(ambient.color, mood.ambientSky);
      paint(ambient.groundColor, mood.ambientGround);
      ambient.intensity = mood.ambientIntensity;
      paint(key.color, mood.keyColor);
      key.intensity = mood.keyIntensity;
      paint(back.color, mood.backColor);
      back.intensity = mood.backIntensity;
    },

    // Les lumieres ne detiennent ni geometrie ni materiau : il n y a que le
    // graphe a defaire pour que le ramasse-miettes fasse le reste.
    dispose(): void {
      group.clear();
    },
  };

  lighting.update(0);
  return lighting;
}
