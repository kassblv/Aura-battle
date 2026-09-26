import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { lenient } from './lenient.js';
import { SERVER_MESSAGES } from './server.js';

/**
 * Parcours GENERIQUE d'une definition zod : toute valeur qui est un schema,
 * a toute profondeur, sans connaitre les formes. Un parcours qui ne suivrait
 * que les formes connues de `lenient` aurait les memes angles morts que lui.
 */
function strictObjectsIn(schema: z.ZodType, path: string, seen = new Set<unknown>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = schema._zod.def as unknown as Record<string, unknown>;
  const found: string[] = [];
  if (def.type === 'object' && (def.catchall as z.ZodType | undefined)?._zod.def.type === 'never') {
    found.push(path);
  }
  const visit = (value: unknown, at: string): void => {
    if (value instanceof z.ZodType) found.push(...strictObjectsIn(value, at, seen));
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${at}[${index}]`));
    else if (value !== null && typeof value === 'object' && at.endsWith('.shape')) {
      for (const [key, item] of Object.entries(value)) visit(item, `${at}.${key}`);
    }
  };
  for (const [key, value] of Object.entries(def)) {
    if (key !== 'catchall') visit(value, `${path}.${key}`);
  }
  return found;
}

describe('lenient', () => {
  it('le parcours sait trouver un objet strict imbrique (temoin)', () => {
    const strict = z.strictObject({ a: z.array(z.strictObject({ b: z.number() })).optional() });
    expect(strictObjectsIn(strict, 'x').length).toBe(2);
  });

  it('ne laisse aucun objet strict dans les analyseurs client', () => {
    for (const [name, schema] of Object.entries(SERVER_MESSAGES)) {
      expect(strictObjectsIn(lenient(schema), name)).toEqual([]);
    }
  });

  it('laisse le registre sortant strict', () => {
    expect(strictObjectsIn(SERVER_MESSAGES['match:found'], 'match:found').length).toBeGreaterThan(
      0,
    );
  });
});
