import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX,
  displayNameSchema,
  parseAuthDeviceRequest,
  parseAuthRecoveryClaimRequest,
  parseAuthRefreshRequest,
  recoveryCodeResponseSchema,
  parseAuthRenameRequest,
  sessionResponseSchema,
  AUTH_ERROR_CODES,
  EMAIL_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  emailSchema,
  emailStatusResponseSchema,
  parseAuthEmailLinkRequest,
  parseAuthEmailLoginRequest,
  parseAuthEmailPasswordRequest,
  parseAuthRecoveryIssueRequest,
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

describe('code de recuperation', () => {
  /*
    Le schema borne la SAISIE, pas le code.

    Un joueur recopie son code avec des tirets, des espaces, parfois le
    prefixe. Le serveur normalise ensuite — mais il faut d'abord qu'il recoive
    la chaine. Une borne trop serree ici refuserait des codes valables avant
    meme que quiconque les regarde.
  */
  it('accepte un code tel qu il est affiche', () => {
    expect(parseAuthRecoveryClaimRequest({ code: 'AURA-7K2M-94PX-QTJD-3HVN' }).success).toBe(true);
  });

  it('accepte les variantes qu un humain produit', () => {
    for (const code of [
      '7K2M94PXQTJD3HVN',
      'aura 7k2m 94px qtjd 3hvn',
      ' AURA-7K2M94PXQTJD3HVN ',
    ]) {
      expect(parseAuthRecoveryClaimRequest({ code }).success).toBe(true);
    }
  });

  /*
    Mais elle reste bornee. Sans plafond, un client peut envoyer un megaoctet
    par tentative — c'est la meme lecon que « le protocole borne un message,
    pas la somme des messages », appliquee a un seul champ.
  */
  it('refuse une saisie demesuree', () => {
    expect(parseAuthRecoveryClaimRequest({ code: 'A'.repeat(200) }).success).toBe(false);
  });

  it('refuse une saisie vide ou absente', () => {
    expect(parseAuthRecoveryClaimRequest({ code: '' }).success).toBe(false);
    expect(parseAuthRecoveryClaimRequest({}).success).toBe(false);
  });

  it('refuse un champ inconnu', () => {
    expect(
      parseAuthRecoveryClaimRequest({ code: '7K2M94PXQTJD3HVN', playerId: 'p-1' }).success,
    ).toBe(false);
  });

  it('decrit la reponse : un code affichable, et rien de plus', () => {
    const ok = recoveryCodeResponseSchema.safeParse({ code: 'AURA-7K2M-94PX-QTJD-3HVN' });
    expect(ok.success).toBe(true);
    // Surtout pas le hache : il n'a aucune raison de sortir du serveur.
    expect(recoveryCodeResponseSchema.safeParse({ code: 'AURA-7K2M', hash: 'abc' }).success).toBe(
      false,
    );
  });
});

describe('email et mot de passe', () => {
  const password = 'une phrase de passe';

  /*
    Le schema NORMALISE : c'est la meme chaine qui arrive au serveur, qu'on
    l'ait tapee avec une majuscule de clavier de telephone ou un espace colle.
    Sinon « Kassim@Gmail.com » et « kassim@gmail.com » seraient deux comptes.
  */
  it('rogne et met l adresse en minuscules', () => {
    expect(emailSchema.parse('  Kassim@Gmail.COM ')).toBe('kassim@gmail.com');
  });

  it('refuse ce qui n est pas une adresse', () => {
    for (const email of ['', 'kassim', 'kassim@', '@gmail.com', 'kassim gmail.com']) {
      expect(emailSchema.safeParse(email).success).toBe(false);
    }
  });

  it('borne la longueur de l adresse', () => {
    const long = `${'a'.repeat(EMAIL_MAX)}@x.fr`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });

  it('borne le mot de passe choisi des deux cotes', () => {
    const at = (length: number) =>
      parseAuthEmailLinkRequest({
        email: 'k@gmail.com',
        password: 'x'.repeat(length),
        deviceSecret: secret,
      }).success;
    expect(at(PASSWORD_MIN - 1)).toBe(false);
    expect(at(PASSWORD_MIN)).toBe(true);
    expect(at(PASSWORD_MAX)).toBe(true);
    // Le plafond n'est pas cosmetique : le hachage coute du temps de calcul
    // proportionnel a l'entree, et un megaoctet par tentative est un deni de
    // service a peu de frais.
    expect(at(PASSWORD_MAX + 1)).toBe(false);
  });

  it('ne rogne pas un mot de passe : l espace en fait partie', () => {
    const parsed = parseAuthEmailLinkRequest({
      email: 'k@gmail.com',
      password: `  ${password}  `,
      deviceSecret: secret,
    });
    expect(parsed.success && parsed.data.password).toBe(`  ${password}  `);
  });

  /*
    La connexion n'applique PAS la politique de choix, seulement le plafond.
    Le jour ou la longueur minimale monte, un joueur doit encore pouvoir
    entrer avec le mot de passe qu'il a choisi avant.
  */
  it('laisse passer a la connexion un mot de passe court choisi sous une ancienne regle', () => {
    expect(parseAuthEmailLoginRequest({ email: 'k@gmail.com', password: 'court' }).success).toBe(
      true,
    );
    expect(
      parseAuthEmailLoginRequest({ email: 'k@gmail.com', password: 'x'.repeat(PASSWORD_MAX + 1) })
        .success,
    ).toBe(false);
    expect(parseAuthEmailLoginRequest({ email: 'k@gmail.com', password: '' }).success).toBe(false);
  });

  it('refuse un champ inconnu', () => {
    expect(
      parseAuthEmailLoginRequest({ email: 'k@gmail.com', password, deviceSecret: 'a' }).success,
    ).toBe(false);
  });

  describe('changement de mot de passe', () => {
    it('accepte l ancien mot de passe comme preuve', () => {
      expect(
        parseAuthEmailPasswordRequest({ currentPassword: 'ancien', newPassword: password }).success,
      ).toBe(true);
    });

    it('accepte un code de recuperation comme preuve', () => {
      expect(
        parseAuthEmailPasswordRequest({
          recoveryCode: 'AURA-7K2M-94PX-QTJD-3HVN',
          newPassword: password,
        }).success,
      ).toBe(true);
    });

    it('exige une et une seule preuve', () => {
      expect(parseAuthEmailPasswordRequest({ newPassword: password }).success).toBe(false);
      expect(
        parseAuthEmailPasswordRequest({
          currentPassword: 'ancien',
          recoveryCode: 'AURA-7K2M-94PX-QTJD-3HVN',
          newPassword: password,
        }).success,
      ).toBe(false);
    });

    it('applique la politique au nouveau mot de passe', () => {
      expect(
        parseAuthEmailPasswordRequest({ currentPassword: 'ancien', newPassword: 'court' }).success,
      ).toBe(false);
    });
  });

  it('decrit l etat du rattachement sans jamais l adresse en clair ni le hache', () => {
    expect(
      emailStatusResponseSchema.safeParse({ linked: true, maskedEmail: 'k•••@gmail.com' }).success,
    ).toBe(true);
    expect(emailStatusResponseSchema.safeParse({ linked: false, maskedEmail: null }).success).toBe(
      true,
    );
    expect(
      emailStatusResponseSchema.safeParse({
        linked: true,
        maskedEmail: 'k•••@gmail.com',
        secretHash: '$argon2id$',
      }).success,
    ).toBe(false);
  });

  it('nomme les refus que le client sait expliquer', () => {
    expect(AUTH_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'INVALID_CREDENTIALS',
        'EMAIL_UNAVAILABLE',
        'EMAIL_ALREADY_LINKED',
        'EMAIL_NOT_LINKED',
        'PASSWORD_TOO_COMMON',
        'PASSWORD_MATCHES_EMAIL',
        'TOO_MANY_ATTEMPTS',
      ]),
    );
  });
});

describe('durcissement des preuves', () => {
  it('accepte le secret de l appareil appelant avec un changement de mot de passe', () => {
    expect(
      parseAuthEmailPasswordRequest({
        currentPassword: 'ancien',
        newPassword: 'une phrase de passe',
        deviceSecret: 'a'.repeat(64),
      }).success,
    ).toBe(true);
    expect(
      parseAuthEmailPasswordRequest({
        currentPassword: 'ancien',
        newPassword: 'une phrase de passe',
        deviceSecret: 'pas-un-secret',
      }).success,
    ).toBe(false);
  });

  it('demande de code : corps vide, ou ancien mot de passe', () => {
    expect(parseAuthRecoveryIssueRequest({}).success).toBe(true);
    expect(parseAuthRecoveryIssueRequest({ currentPassword: 'ancien' }).success).toBe(true);
    expect(parseAuthRecoveryIssueRequest({ currentPassword: '' }).success).toBe(false);
    expect(parseAuthRecoveryIssueRequest({ playerId: 'p' }).success).toBe(false);
  });

  it('nomme les nouveaux refus', () => {
    expect(AUTH_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'PASSWORD_TOO_SHORT',
        'RECOVERY_CODE_TOO_RECENT',
        'PASSWORD_REQUIRED',
        'BUSY',
      ]),
    );
  });
});

describe('preuve d appareil', () => {
  it('exige le secret de l appareil pour rattacher une adresse', () => {
    const body = { email: 'k@gmail.com', password: 'une phrase de passe' };
    expect(parseAuthEmailLinkRequest(body).success).toBe(false);
    expect(parseAuthEmailLinkRequest({ ...body, deviceSecret: secret }).success).toBe(true);
  });

  it('accepte le secret de l appareil avec une demande de code', () => {
    expect(parseAuthRecoveryIssueRequest({ deviceSecret: secret }).success).toBe(true);
    expect(parseAuthRecoveryIssueRequest({ deviceSecret: 'court' }).success).toBe(false);
  });

  it('nomme le refus', () => {
    expect(AUTH_ERROR_CODES).toContain('DEVICE_PROOF_REQUIRED');
  });
});
