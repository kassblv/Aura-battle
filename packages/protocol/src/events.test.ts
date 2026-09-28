import { describe, expect, it } from 'vitest';
import { PRODUCT_EVENT_KINDS, productEventSchema, RECHARGE_INPUT_MODES } from './index.js';

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

describe('recharge_input — clavier ou tactile, pour mesurer l equite (protocole 2.8.0)', () => {
  it('accepte les deux modes, rattaches a leur match', () => {
    for (const mode of RECHARGE_INPUT_MODES) {
      expect(
        productEventSchema.safeParse({ kind: 'recharge_input', matchId: 'm_01', mode }).success,
      ).toBe(true);
    }
    expect(RECHARGE_INPUT_MODES).toEqual(['touch', 'keys']);
  });

  it('exige le mode : un recharge_input sans mode ne mesure rien', () => {
    expect(productEventSchema.safeParse({ kind: 'recharge_input', matchId: 'm_01' }).success).toBe(
      false,
    );
  });

  it('refuse un mode inconnu', () => {
    expect(
      productEventSchema.safeParse({ kind: 'recharge_input', matchId: 'm_01', mode: 'gamepad' })
        .success,
    ).toBe(false);
  });

  it('refuse les points de recharge declares : le serveur les calcule', () => {
    expect(
      productEventSchema.safeParse({
        kind: 'recharge_input',
        matchId: 'm_01',
        mode: 'keys',
        points: 999,
      }).success,
    ).toBe(false);
  });

  it('refuse un mode sur un clip : chaque sorte porte exactement ses champs', () => {
    expect(
      productEventSchema.safeParse({ kind: 'clip_shared', matchId: 'm_01', mode: 'keys' }).success,
    ).toBe(false);
  });

  it('expose les sortes admises', () => {
    expect(PRODUCT_EVENT_KINDS).toEqual(['clip_shared', 'recharge_input']);
  });
});
