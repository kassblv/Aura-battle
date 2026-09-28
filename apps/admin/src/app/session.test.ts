import { describe, expect, it } from 'vitest';
import { clearToken, readToken, saveToken, SESSION_KEY, type SessionStore } from './session.js';

function memory(): SessionStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('session du secret', () => {
  it('garde, relit et efface le secret', () => {
    const store = memory();
    saveToken('abc', store);
    expect(store.data.get(SESSION_KEY)).toBe('abc');
    expect(readToken(store)).toBe('abc');
    clearToken(store);
    expect(readToken(store)).toBeNull();
  });

  it('un stockage qui refuse ne fait pas tomber le panneau', () => {
    const hostile: SessionStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readToken(hostile)).toBeNull();
    expect(() => saveToken('x', hostile)).not.toThrow();
    expect(() => clearToken(hostile)).not.toThrow();
  });

  it('aucun fichier du panneau n utilise localStorage', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
      });
    const offenders = walk(fileURLToPath(new URL('..', import.meta.url))).filter((file) =>
      /localStorage\s*[.[]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
