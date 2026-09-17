import { DirectionalLight, Group, HemisphereLight } from 'three';

/**
 * Eclairage fixe de l arene, repris du prototype.
 *
 * Trois sources suffisent au rendu toon : une ambiance qui teinte le haut et le
 * bas, une lumiere principale de face, et un contre-jour violet qui detoure les
 * combattants sur le fond sombre.
 */
export interface ArenaLighting {
  readonly group: Group;
  readonly ambient: HemisphereLight;
  readonly key: DirectionalLight;
  readonly back: DirectionalLight;
  dispose(): void;
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
  back.position.set(-3, 3, -5);

  group.add(ambient, key, back);

  return {
    group,
    ambient,
    key,
    back,
    // Les lumieres ne detiennent ni geometrie ni materiau : il n y a que le
    // graphe a defaire pour que le ramasse-miettes fasse le reste.
    dispose(): void {
      group.clear();
    },
  };
}
