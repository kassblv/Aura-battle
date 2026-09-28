import { describe, expect, it } from 'vitest';
import { TOKEN_PACKS, tokenPackFor } from './tokenPacks.js';

describe('packs de jetons', () => {
  it('a des identifiants de produit uniques et des quantites positives', () => {
    const ids = TOKEN_PACKS.map((pack) => pack.productId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of TOKEN_PACKS)
      expect(Number.isInteger(pack.tokens) && pack.tokens > 0).toBe(true);
  });

  // Un pack plus gros ne donne jamais MOINS de jetons par pack : le bonus grandit.
  it('range les packs du plus petit au plus gros', () => {
    for (let i = 1; i < TOKEN_PACKS.length; i += 1) {
      expect(TOKEN_PACKS[i]!.tokens).toBeGreaterThan(TOKEN_PACKS[i - 1]!.tokens);
    }
  });

  it('retrouve un pack par son produit, et rien pour un produit inconnu', () => {
    const first = TOKEN_PACKS[0]!;
    expect(tokenPackFor(first.productId)).toEqual(first);
    expect(tokenPackFor('aura.tokens.inconnu')).toBeUndefined();
  });
});
