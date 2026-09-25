import { z } from 'zod';

/**
 * Le meme schema, qui IGNORE les cles inconnues a toutes les profondeurs.
 *
 * Les messages serveur sont des `strictObject` : c'est ce qui empeche le
 * serveur d'emettre un champ hors protocole (une fuite, regle d'or n° 4). Mais
 * le client analysait avec ces memes schemas, et refusait donc tout message
 * portant un champ AJOUTE par un serveur plus recent — une version mineure
 * cassait les clients deja installes, contrairement a ce que promet
 * `version.ts`. Le client analyse desormais avec cette copie tolerante : les
 * cles inconnues sont retirees, les types, bornes et valeurs par defaut restent.
 *
 * Seules les formes employees par le protocole sont parcourues (objet, tableau,
 * enregistrement, union, facultatif, nullable, defaut) ; tout le reste est une
 * feuille, rendue telle quelle. Les verifications (`max`, `refine`) sont
 * recopiees sur la forme reconstruite.
 */
export function lenient(schema: z.ZodType): z.ZodType {
  const def = (schema as z.ZodObject)._zod.def as unknown as LenientDef;
  const checks = def.checks ?? [];
  switch (def.type) {
    case 'object': {
      const shape = Object.fromEntries(
        Object.entries(def.shape).map(([key, value]) => [key, lenient(value)]),
      );
      return z.object(shape).check(...checks);
    }
    case 'array':
      return z.array(lenient(def.element)).check(...checks);
    case 'record':
      return z.record(def.keyType, lenient(def.valueType)).check(...checks);
    case 'union':
      return z.union(def.options.map(lenient) as [z.ZodType, z.ZodType]).check(...checks);
    case 'optional':
      return lenient(def.innerType).optional();
    case 'nullable':
      return lenient(def.innerType).nullable();
    case 'default':
      return lenient(def.innerType).default(def.defaultValue);
    default:
      return schema;
  }
}

/** Les champs de definition zod lus ici, selon la forme. */
interface LenientDef {
  readonly type: string;
  readonly checks?: z.core.$ZodCheck<unknown>[];
  readonly shape: Record<string, z.ZodType>;
  readonly element: z.ZodType;
  readonly keyType: z.core.$ZodRecordKey;
  readonly valueType: z.ZodType;
  readonly options: readonly z.ZodType[];
  readonly innerType: z.ZodType;
  readonly defaultValue: unknown;
}
