import { describe, expect, it } from 'vitest';
import { MemoryAttemptLimiter } from '../adapters/memory-attempt-limiter.js';
import { hashSecret } from '../domain/credentials.js';
import type { PlayerRecord } from '../domain/ports.js';
import { EmailAuthError, EmailAuthService, LIMITS, RECOVERY_PROOF_MIN_AGE_MS } from './email.js';
import { fakePasswordHasher, memoryEmailIdentities } from './email-testing.js';
import { RecoveryError } from './recovery.js';

const ALICE: PlayerRecord = { id: 'p-alice', displayName: 'Alice' };
const BOB: PlayerRecord = { id: 'p-bob', displayName: 'Bob' };
const GOOD = 'aura du dimanche';
const IP = '198.51.100.1';
const ALICE_DEVICE = 'a'.repeat(64);
const BOB_DEVICE = 'c'.repeat(64);

function setup() {
  const repo = memoryEmailIdentities([ALICE, BOB]);
  const { hasher, calls } = fakePasswordHasher();
  const warnings: string[] = [];
  // Deux heures apres l'epoque : `AURA-BOB` a ete delivre a l'instant 0,
  // donc il est assez ancien pour servir de preuve.
  let now = 2 * 60 * 60_000;
  const limiter = new MemoryAttemptLimiter({ windowMs: 15 * 60_000, now: () => now });
  const recoveryCodes = new Map<string, { player: PlayerRecord; issuedAt: Date }>([
    ['AURA-BOB', { player: BOB, issuedAt: new Date(0) }],
  ]);
  // Chaque joueur a deja son appareil, comme en vrai : c'est lui qui ouvre la session.
  repo.devices.set(hashSecret(ALICE_DEVICE), ALICE.id);
  repo.devices.set(hashSecret(BOB_DEVICE), BOB.id);
  const published: string[] = [];
  const service = new EmailAuthService({
    identities: repo.port,
    hasher,
    limiter,
    recovery: {
      fresh: () => ({ code: 'AURA-NEUF-NEUF-NEUF-NEUF', hash: 'hache-du-code-neuf' }),
      prove: (code) => {
        const found = recoveryCodes.get(code);
        return found === undefined
          ? Promise.reject(new RecoveryError('INVALID_RECOVERY_CODE'))
          : Promise.resolve(found);
      },
    },
    events: { publish: (playerId) => published.push(playerId) },
    clock: { now: () => new Date(now) },
    traceKey: 'une-cle-de-test-assez-longue',
    log: { warn: (message) => warnings.push(message) },
  });
  return {
    repo,
    calls,
    warnings,
    service,
    published,
    /** Joueurs dont le changement de mot de passe a tout revoque. */
    revoked: () => [...repo.credentialsVersion.keys()],
    /** Delivre un code a l'instant present, comme `POST /auth/recovery`. */
    issueCode: (code: string, player: PlayerRecord) => {
      recoveryCodes.set(code, { player, issuedAt: new Date(now) });
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(EmailAuthError);
  return (thrown as EmailAuthError).reason;
}

describe('link', () => {
  it('rattache l adresse normalisee et ne range que le hache', async () => {
    const { repo, service } = setup();
    const status = await service.link(ALICE.id, ' Alice@Gmail.com ', GOOD, '1.2.3.4', ALICE_DEVICE);

    expect(status).toEqual({ linked: true, maskedEmail: 'a•••@gmail.com' });
    expect(repo.rows).toEqual([
      {
        playerId: ALICE.id,
        email: 'alice@gmail.com',
        secretHash: `h(${GOOD})`,
        credentialsVersion: 0,
      },
    ]);
  });

  it('refuse un second rattachement : on change le mot de passe, pas l adresse', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, '1.2.3.4', ALICE_DEVICE);
    expect(
      await reasonOf(service.link(ALICE.id, 'autre@gmail.com', GOOD, '1.2.3.4', ALICE_DEVICE)),
    ).toBe('EMAIL_ALREADY_LINKED');
  });

  it('refuse une adresse deja prise par un autre joueur, sans dire par qui', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, '1.2.3.4', ALICE_DEVICE);
    expect(
      await reasonOf(service.link(BOB.id, 'ALICE@gmail.com', GOOD, '1.2.3.4', BOB_DEVICE)),
    ).toBe('EMAIL_UNAVAILABLE');
  });

  it('applique la politique : trop courant, ou egal a l adresse', async () => {
    const { repo, service } = setup();
    expect(
      await reasonOf(service.link(ALICE.id, 'alice@gmail.com', 'azertyuiop', IP, ALICE_DEVICE)),
    ).toBe('PASSWORD_TOO_COMMON');
    expect(
      await reasonOf(
        service.link(ALICE.id, 'alice@gmail.com', 'Alice@Gmail.com', IP, ALICE_DEVICE),
      ),
    ).toBe('PASSWORD_MATCHES_EMAIL');
    expect(repo.rows).toEqual([]);
  });

  /*
    L'adresse deja prise est une information : un compte invite se cree en un
    appel, donc cette route est un oracle ouvert a tous. On la borne comme la
    connexion, pour qu'on ne puisse pas y deverser un annuaire.
  */
  it('borne les essais de rattachement par joueur', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, '198.51.100.2', ALICE_DEVICE);
    for (let i = 0; i < LIMITS.linkPerPlayer; i++) {
      await reasonOf(
        service.link(BOB.id, 'alice@gmail.com', GOOD, `10.0.0.${String(i)}`, BOB_DEVICE),
      );
    }
    expect(
      await reasonOf(service.link(BOB.id, 'bob@gmail.com', GOOD, '198.51.100.5', BOB_DEVICE)),
    ).toBe('TOO_MANY_ATTEMPTS');
  });

  it('refuse un joueur qui n existe plus', async () => {
    const { service } = setup();
    expect(await reasonOf(service.link('p-fantome', 'x@gmail.com', GOOD, IP))).toBe(
      'UNKNOWN_PLAYER',
    );
  });
});

describe('login', () => {
  async function linked() {
    const context = setup();
    await context.service.link(ALICE.id, 'alice@gmail.com', GOOD, '198.51.100.3', ALICE_DEVICE);
    context.calls.verify = 0;
    context.calls.verifiedAgainst.length = 0;
    return context;
  }

  it('retrouve le joueur, quelle que soit la casse de l adresse', async () => {
    const { service } = await linked();
    await expect(service.login('ALICE@gmail.com ', GOOD, IP)).resolves.toMatchObject({
      playerId: ALICE.id,
    });
  });

  it('rend la meme erreur pour une adresse inconnue et un mauvais mot de passe', async () => {
    const { service } = await linked();
    const unknown = await reasonOf(service.login('personne@gmail.com', GOOD, IP));
    const wrong = await reasonOf(service.login('alice@gmail.com', 'pas le bon', IP));
    expect(unknown).toBe('INVALID_CREDENTIALS');
    expect(wrong).toBe(unknown);
  });

  /*
    Sans ce hachage factice, une adresse inconnue repondrait en une requete de
    base, une adresse connue en une requete plus argon2 : quelques dizaines de
    millisecondes d'ecart, assez pour dresser la liste des comptes.
  */
  it('hache quand meme quand l adresse est inconnue', async () => {
    const { service, calls } = await linked();
    await reasonOf(service.login('personne@gmail.com', GOOD, IP));
    expect(calls.verify).toBe(1);
    expect(calls.verifiedAgainst[0]).toMatch(/^h\(/);
  });

  it('bloque une adresse apres cinq echecs, meme depuis des adresses IP differentes', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      expect(await reasonOf(service.login('alice@gmail.com', 'faux', `10.0.0.${String(i)}`))).toBe(
        'INVALID_CREDENTIALS',
      );
    }
    // Meme le bon mot de passe : sinon le blocage dirait quand l'attaquant a
    // trouve, puisque seul le bon passerait.
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, '198.51.100.4'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('bloque une adresse IP qui essaie beaucoup d adresses', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.loginPerIp; i++) {
      await reasonOf(service.login(`cible${String(i)}@gmail.com`, 'faux', '198.51.100.66'));
    }
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, '198.51.100.66'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('ne hache rien quand la limite est atteinte', async () => {
    const { service, calls } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await reasonOf(service.login('alice@gmail.com', 'faux', IP));
    }
    const before = calls.verify;
    await reasonOf(service.login('alice@gmail.com', 'faux', IP));
    // Le hachage est la partie chere : la limite protege aussi le processeur.
    expect(calls.verify).toBe(before);
  });

  it('rouvre la porte apres la fenetre', async () => {
    const { service, advance } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await reasonOf(service.login('alice@gmail.com', 'faux', IP));
    }
    advance(15 * 60_000 + 1);
    await expect(service.login('alice@gmail.com', GOOD, IP)).resolves.toMatchObject({
      playerId: ALICE.id,
    });
  });

  it('efface les echecs de l adresse apres une connexion reussie', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail - 1; i++) {
      await reasonOf(service.login('alice@gmail.com', 'faux', IP));
    }
    await service.login('alice@gmail.com', GOOD, IP);
    // Une faute de frappe le lendemain ne doit pas la bloquer.
    await reasonOf(service.login('alice@gmail.com', 'faux', IP));
    await expect(service.login('alice@gmail.com', GOOD, IP)).resolves.toMatchObject({
      playerId: ALICE.id,
    });
  });

  it('journalise les echecs sans adresse ni mot de passe', async () => {
    const { service, warnings } = await linked();
    await reasonOf(service.login('alice@gmail.com', 'mauvais-secret', IP));
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await reasonOf(service.login('alice@gmail.com', 'mauvais-secret', IP));
    }
    expect(warnings.length).toBeGreaterThan(0);
    const all = warnings.join('\n');
    expect(all).not.toContain('alice');
    expect(all).not.toContain('gmail');
    expect(all).not.toContain('mauvais-secret');
  });
});

describe('changePassword', () => {
  async function linked() {
    const context = setup();
    await context.service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    await context.service.link(BOB.id, 'bob@gmail.com', GOOD, IP, BOB_DEVICE);
    return context;
  }

  it('change le mot de passe sur preuve de l ancien', async () => {
    const { service } = await linked();
    await service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle phrase', IP);
    await expect(service.login('alice@gmail.com', 'nouvelle phrase', IP)).resolves.toMatchObject({
      playerId: ALICE.id,
    });
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, IP))).toBe('INVALID_CREDENTIALS');
  });

  it('refuse un ancien mot de passe faux', async () => {
    const { service } = await linked();
    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { currentPassword: 'faux' }, 'nouvelle ok', IP),
      ),
    ).toBe('INVALID_CREDENTIALS');
  });

  /*
    Le chemin du mot de passe oublie : aucun courrier ne part jamais, donc la
    preuve de secours est le code de recuperation. Un code d'un AUTRE compte ne
    vaut rien ici.
  */
  it('accepte le code de recuperation du joueur, pas celui d un autre', async () => {
    const { service } = await linked();
    await service.changePassword(BOB.id, { recoveryCode: 'AURA-BOB' }, 'nouvelle phrase', IP);
    await expect(service.login('bob@gmail.com', 'nouvelle phrase', IP)).resolves.toMatchObject({
      playerId: BOB.id,
    });

    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { recoveryCode: 'AURA-BOB' }, 'autre ok', IP),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { recoveryCode: 'AURA-RIEN' }, 'autre ok', IP),
      ),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('applique la politique au nouveau mot de passe', async () => {
    const { service } = await linked();
    expect(
      await reasonOf(service.changePassword(ALICE.id, { currentPassword: GOOD }, 'password1', IP)),
    ).toBe('PASSWORD_TOO_COMMON');
    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { currentPassword: GOOD }, 'alice@gmail.com', IP),
      ),
    ).toBe('PASSWORD_MATCHES_EMAIL');
  });

  it('refuse un joueur sans adresse', async () => {
    const { service } = setup();
    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle ok', IP),
      ),
    ).toBe('EMAIL_NOT_LINKED');
  });

  /*
    Une session volee ne doit pas devenir un banc d'essai du mot de passe :
    le meme mot de passe sert peut-etre ailleurs.
  */
  it('borne les essais de l ancien mot de passe', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.passwordPerPlayer; i++) {
      await reasonOf(
        service.changePassword(ALICE.id, { currentPassword: 'faux' }, 'nouvelle ok', IP),
      );
    }
    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle ok', IP),
      ),
    ).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('status', () => {
  it('dit si une adresse est rattachee, masquee', async () => {
    const { service } = setup();
    await expect(service.status(ALICE.id)).resolves.toEqual({ linked: false, maskedEmail: null });
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    await expect(service.status(ALICE.id)).resolves.toEqual({
      linked: true,
      maskedEmail: 'a•••@gmail.com',
    });
  });
});

/*
  Relecture de securite, point 1 : une session seule ne doit pas suffire a
  prendre le compte. Sans ces regles, un intrus muni d'une session demandait
  un code neuf (revoquant celui du joueur) puis changeait le mot de passe avec.
*/
describe('une session seule ne prend pas le compte', () => {
  async function linked() {
    const context = setup();
    await context.service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    return context;
  }

  it('refuse un code de recuperation delivre il y a moins d une heure', async () => {
    const { service, issueCode, advance } = await linked();
    issueCode('AURA-ALICE-NEUF', ALICE);
    expect(
      await reasonOf(
        service.changePassword(
          ALICE.id,
          { recoveryCode: 'AURA-ALICE-NEUF' },
          'prise de controle',
          IP,
        ),
      ),
    ).toBe('RECOVERY_CODE_TOO_RECENT');

    // Le parcours legitime : le code NOTE, delivre bien avant, passe.
    advance(RECOVERY_PROOF_MIN_AGE_MS);
    await service.changePassword(
      ALICE.id,
      { recoveryCode: 'AURA-ALICE-NEUF' },
      'phrase retrouvee',
      IP,
    );
    await expect(service.login('alice@gmail.com', 'phrase retrouvee', IP)).resolves.toMatchObject({
      playerId: ALICE.id,
    });
  });

  it('exige le mot de passe pour delivrer un code des qu une adresse est rattachee', async () => {
    const { service } = await linked();
    expect(await reasonOf(service.authorizeRecoveryIssue(ALICE.id, undefined, IP))).toBe(
      'PASSWORD_REQUIRED',
    );
    expect(await reasonOf(service.authorizeRecoveryIssue(ALICE.id, 'faux', IP))).toBe(
      'INVALID_CREDENTIALS',
    );
    await expect(service.authorizeRecoveryIssue(ALICE.id, GOOD, IP)).resolves.toBeUndefined();
  });

  /*
    Seconde relecture (B) : sur un compte sans adresse, un jeton vole ne suffit
    plus. Il faut le secret d'un appareil deja rattache a CE joueur.
  */
  it('exige la preuve d un appareil du joueur sur un compte sans adresse', async () => {
    const { service } = setup();
    await expect(
      service.authorizeRecoveryIssue(BOB.id, undefined, IP, BOB_DEVICE),
    ).resolves.toBeUndefined();
    expect(await reasonOf(service.authorizeRecoveryIssue(BOB.id, undefined, IP))).toBe(
      'DEVICE_PROOF_REQUIRED',
    );
    expect(
      await reasonOf(service.authorizeRecoveryIssue(BOB.id, undefined, IP, ALICE_DEVICE)),
    ).toBe('DEVICE_PROOF_REQUIRED');
  });

  it('exige la preuve d un appareil du joueur pour rattacher une adresse', async () => {
    const { service } = setup();
    expect(await reasonOf(service.link(BOB.id, 'intrus@gmail.com', GOOD, IP))).toBe(
      'DEVICE_PROOF_REQUIRED',
    );
    expect(await reasonOf(service.link(BOB.id, 'intrus@gmail.com', GOOD, IP, ALICE_DEVICE))).toBe(
      'DEVICE_PROOF_REQUIRED',
    );
    expect(await reasonOf(service.link(BOB.id, 'intrus@gmail.com', GOOD, IP, 'd'.repeat(64)))).toBe(
      'DEVICE_PROOF_REQUIRED',
    );
  });

  /*
    Seconde relecture (D) : un intrus qui rate expres ne remplit que son
    propre compteur ; le proprietaire, depuis son appareil, peut toujours
    changer son mot de passe pour le chasser.
  */
  it('ne laisse pas un intrus bloquer le proprietaire en ratant expres', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    for (let i = 0; i < LIMITS.passwordPerPlayer + 2; i++) {
      await reasonOf(
        service.changePassword(
          ALICE.id,
          { currentPassword: 'faux' },
          'prise de controle',
          '203.0.113.9',
        ),
      );
    }
    await service.changePassword(
      ALICE.id,
      { currentPassword: GOOD },
      'phrase du proprietaire',
      IP,
      ALICE_DEVICE,
    );
    await expect(
      service.login('alice@gmail.com', 'phrase du proprietaire', IP),
    ).resolves.toMatchObject({ playerId: ALICE.id });
  });

  it('ne compte pas les preuves reussies', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    for (let i = 0; i < LIMITS.passwordPerPlayer + 1; i++) {
      await service.authorizeRecoveryIssue(ALICE.id, GOOD, IP, ALICE_DEVICE);
    }
    await expect(
      service.authorizeRecoveryIssue(ALICE.id, GOOD, IP, ALICE_DEVICE),
    ).resolves.toBeUndefined();
  });

  it('borne les essais de mot de passe a la demande de code', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.passwordPerPlayer; i++) {
      await reasonOf(service.authorizeRecoveryIssue(ALICE.id, 'faux', IP));
    }
    expect(await reasonOf(service.authorizeRecoveryIssue(ALICE.id, GOOD, IP))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });
});

/* Relecture de securite, point 2 : changer de mot de passe chasse tout le monde. */
describe('changer de mot de passe revoque le reste', () => {
  it('revoque les sessions et detache les autres appareils, sauf celui qui demande', async () => {
    const { service, repo, revoked, published } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    const mine = 'a'.repeat(64);
    const intruder = 'b'.repeat(64);
    repo.devices.set(hashSecret(mine), ALICE.id);
    repo.devices.set(hashSecret(intruder), ALICE.id);
    repo.devices.set(hashSecret('c'.repeat(64)), BOB.id);

    await service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle phrase', IP, mine);

    expect(revoked()).toEqual([ALICE.id]);
    // Les sockets ouvertes sont fermees : le module match est prevenu.
    expect(published).toEqual([ALICE.id]);
    expect(repo.devices.get(hashSecret(mine))).toBe(ALICE.id);
    expect(repo.devices.has(hashSecret(intruder))).toBe(false);
    // Les appareils d'un autre joueur ne sont pas touches.
    expect(repo.devices.get(hashSecret(BOB_DEVICE))).toBe(BOB.id);
  });

  it('detache tous les appareils quand le demandeur ne dit pas lequel il est', async () => {
    const { service, repo } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    await service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle phrase', IP);
    expect([...repo.devices.values()]).toEqual([BOB.id]);
  });

  it('ne revoque rien quand la preuve est refusee', async () => {
    const { service, revoked } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    await reasonOf(
      service.changePassword(ALICE.id, { currentPassword: 'faux' }, 'nouvelle ok', IP),
    );
    expect(revoked()).toEqual([]);
  });
});

/* Relecture de securite, point 3 : l'adresse IP compte par seau, et doit exister. */
describe('adresse IP', () => {
  it('compte toute une IPv6 /64 dans un seul compteur', async () => {
    const { service } = setup();
    for (let i = 0; i < LIMITS.loginPerIp; i++) {
      await reasonOf(
        service.login(`cible${String(i)}@gmail.com`, 'faux', `2001:db8:1:2::${i.toString(16)}`),
      );
    }
    expect(await reasonOf(service.login('autre@gmail.com', 'faux', '2001:db8:1:2::ffff'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('refuse une requete sans adresse plutot que de la ranger avec les autres', async () => {
    const { service } = setup();
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, undefined))).toBe(
      'NO_CLIENT_ADDRESS',
    );
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, ''))).toBe('NO_CLIENT_ADDRESS');
  });
});

describe('longueur apres normalisation', () => {
  it('refuse un mot de passe de huit unites mais quatre caracteres', async () => {
    const { service } = setup();
    expect(
      await reasonOf(service.link(ALICE.id, 'alice@gmail.com', '😀😀😀😀', IP, ALICE_DEVICE)),
    ).toBe('PASSWORD_TOO_SHORT');
  });
});

/* Quatrieme relecture (B2) : le code de recuperation ne survit pas au changement. */
describe('changer de mot de passe remplace le code de recuperation', () => {
  it('rend un code neuf et en pose le hache dans la meme ecriture', async () => {
    const { service, repo } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    const { recoveryCode } = await service.changePassword(
      ALICE.id,
      { currentPassword: GOOD },
      'nouvelle phrase',
      IP,
      ALICE_DEVICE,
    );
    expect(recoveryCode).toBe('AURA-NEUF-NEUF-NEUF-NEUF');
    expect(repo.recoveryHashes.get(ALICE.id)).toBe('hache-du-code-neuf');
  });
});

/* Quatrieme relecture (I1) : les connexions REUSSIES sont bornees aussi. */
describe('connexions reussies en rafale', () => {
  it('borne les connexions par IP, reussies comprises', async () => {
    const { service, calls } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    for (let i = 0; i < LIMITS.loginAllPerIp; i++) {
      await service.login('alice@gmail.com', GOOD, '203.0.113.50');
    }
    const before = calls.verify;
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, '203.0.113.50'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
    // Refusee avant le hachage : c'est le processeur qu'on protege.
    expect(calls.verify).toBe(before);
  });
});

/* Quatrieme relecture (M3) : compter PUIS verifier, meme en rafale. */
describe('preuves de mot de passe en rafale', () => {
  it('ne laisse pas passer plus d essais que la limite, lances ensemble', async () => {
    const { service, calls } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, IP, ALICE_DEVICE);
    const before = calls.verify;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        service
          .changePassword(
            ALICE.id,
            { currentPassword: 'faux' },
            'nouvelle phrase',
            IP,
            ALICE_DEVICE,
          )
          .catch(() => undefined),
      ),
    );
    expect(calls.verify - before).toBe(LIMITS.passwordPerPlayer);
  });
});
