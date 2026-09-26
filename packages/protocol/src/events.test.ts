import { describe, expect, it } from 'vitest';
import { productEventSchema } from './index.js';

describe('productEventSchema — la seule mesure que seul le client connait', () => {
  it('accepte un clip partage, rattache a son match', () => {
    expect(productEventSchema.safeParse({ kind: 'clip_shared', matchId: 'm_01' }).success).toBe(
      true,
    );
  });

  it('refuse une sorte inconnue : rien ne s inscrit sans avoir ete decide', () => {
    expect(productEventSchema.safeParse({ kind: 'screen_view', matchId: 'm_01' }).success).toBe(
      false,
    );
  });

  it('refuse un champ en plus : pas de charge libre dans une table de mesure', () => {
    expect(
      productEventSchema.safeParse({ kind: 'clip_shared', matchId: 'm_01', device: 'iPhone' })
        .success,
    ).toBe(false);
  });

  it('refuse un identifiant de match mal forme', () => {
    expect(productEventSchema.safeParse({ kind: 'clip_shared', matchId: 'm 01;' }).success).toBe(
      false,
    );
  });
});
