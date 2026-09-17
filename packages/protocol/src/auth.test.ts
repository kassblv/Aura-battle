import { describe, expect, it } from 'vitest';
import { parseAuthDeviceRequest, parseAuthRefreshRequest, sessionResponseSchema } from './auth.js';

const secret = 'a'.repeat(64);

describe('authDeviceRequest — jouer sans inscription', () => {
  it('accepte un secret d appareil bien forme', () => {
    expect(parseAuthDeviceRequest({ deviceSecret: secret }).success).toBe(true);
  });

  it('refuse un identifiant d appareil devinable', () => {
    // Le nom du champ dit « secret » : un numero de serie ou un IDFV n'y a pas
    // sa place, et la forme imposee l'empeche mecaniquement.
    expect(parseAuthDeviceRequest({ deviceSecret: 'iphone-de-kassim' }).success).toBe(false);
    expect(parseAuthDeviceRequest({ deviceSecret: 'A'.repeat(64) }).success).toBe(false);
    expect(parseAuthDeviceRequest({ deviceSecret: 'a'.repeat(63) }).success).toBe(false);
  });

  it('refuse un champ supplementaire', () => {
    expect(parseAuthDeviceRequest({ deviceSecret: secret, playerId: 'p_1' }).success).toBe(false);
  });

  it('refuse une requete vide', () => {
    expect(parseAuthDeviceRequest({}).success).toBe(false);
  });
});

describe('authRefreshRequest', () => {
  it('accepte un jeton de rafraichissement', () => {
    expect(parseAuthRefreshRequest({ refreshToken: 'jeton-valide' }).success).toBe(true);
  });

  it('refuse un jeton vide ou demesure', () => {
    expect(parseAuthRefreshRequest({ refreshToken: '' }).success).toBe(false);
    expect(parseAuthRefreshRequest({ refreshToken: 'x'.repeat(600) }).success).toBe(false);
  });
});

describe('sessionResponse', () => {
  const session = {
    accessToken: 'jwt.token',
    refreshToken: 'refresh.token',
    expiresIn: 900,
    player: { id: 'p_1', displayName: 'Invite 4821', guest: true },
  };

  it('accepte une session complete', () => {
    expect(sessionResponseSchema.safeParse(session).success).toBe(true);
  });

  it('ne laisse pas fuiter le secret d appareil dans la reponse', () => {
    expect(sessionResponseSchema.safeParse({ ...session, deviceSecret: secret }).success).toBe(
      false,
    );
  });

  it('ne laisse pas fuiter le hache du jeton', () => {
    expect(sessionResponseSchema.safeParse({ ...session, tokenHash: 'abc' }).success).toBe(false);
  });
});
