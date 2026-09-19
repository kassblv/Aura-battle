import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX,
  displayNameSchema,
  parseAuthDeviceRequest,
  parseAuthRefreshRequest,
  parseAuthRenameRequest,
  sessionResponseSchema,
} from './auth.js';

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

describe('displayNameSchema', () => {
  const ok = (name: string): boolean => displayNameSchema.safeParse(name).success;

  it('accepte un pseudo ordinaire', () => {
    expect(ok('Kassim')).toBe(true);
    expect(ok('Nova_7')).toBe(true);
    expect(ok('Jean-Luc')).toBe(true);
  });

  it('accepte les accents : un prenom francais est un pseudo valide', () => {
    expect(ok('Am\u00e9lie')).toBe(true);
    expect(ok('Zo\u00eb')).toBe(true);
  });

  it('refuse trop court et trop long', () => {
    expect(ok('K')).toBe(false);
    expect(ok('K'.repeat(DISPLAY_NAME_MAX + 1))).toBe(false);
    expect(ok('K'.repeat(DISPLAY_NAME_MAX))).toBe(true);
  });

  it('rogne les espaces autour plutot que de refuser', () => {
    // Un espace colle avant le nom vient du clavier, pas du joueur.
    expect(displayNameSchema.parse('  Kassim  ')).toBe('Kassim');
  });

  /**
   * Deux espaces de suite, ou un nom commencant par une ponctuation, servent a
   * imiter le nom d'un autre joueur dans une liste — et a passer devant lui.
   */
  it('refuse ce qui sert a se faire passer pour un autre', () => {
    expect(ok('Kas  sim')).toBe(false);
    expect(ok('_Kassim')).toBe(false);
    expect(ok('.Nova')).toBe(false);
  });

  it('refuse le balisage et les caracteres de controle', () => {
    expect(ok('Kas<b>im')).toBe(false);
    expect(ok('Kas\u0000im')).toBe(false);
    expect(ok('Kas\nim')).toBe(false);
  });

  it('refuse un nom vide ou fait d espaces', () => {
    expect(ok('')).toBe(false);
    expect(ok('    ')).toBe(false);
  });
});

describe('parseAuthRenameRequest', () => {
  it('accepte une demande bien formee', () => {
    expect(parseAuthRenameRequest({ displayName: 'Kassim' }).success).toBe(true);
  });

  it('refuse un champ surnumeraire', () => {
    // Un champ en trop trahit un client qui n'est pas celui qu'on croit.
    expect(parseAuthRenameRequest({ displayName: 'Kassim', admin: true }).success).toBe(false);
  });
});
