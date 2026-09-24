import { describe, expect, it } from 'vitest';
import { MemoryAttemptLimiter } from '../adapters/memory-attempt-limiter.js';
import type { PlayerRecord } from '../domain/ports.js';
import { EmailAuthError, EmailAuthService, LIMITS } from './email.js';
import { fakePasswordHasher, memoryEmailIdentities } from './email-testing.js';
import { RecoveryError } from './recovery.js';

const ALICE: PlayerRecord = { id: 'p-alice', displayName: 'Alice' };
const BOB: PlayerRecord = { id: 'p-bob', displayName: 'Bob' };
const GOOD = 'aura du dimanche';

function setup() {
  const repo = memoryEmailIdentities([ALICE, BOB]);
  const { hasher, calls } = fakePasswordHasher();
  const warnings: string[] = [];
  let now = 0;
  const limiter = new MemoryAttemptLimiter({ windowMs: 15 * 60_000, now: () => now });
  const recoveryCodes = new Map<string, PlayerRecord>([['AURA-BOB', BOB]]);
  const service = new EmailAuthService({
    identities: repo.port,
    hasher,
    limiter,
    recovery: {
      claim: (code) => {
        const player = recoveryCodes.get(code);
        return player === undefined
          ? Promise.reject(new RecoveryError('INVALID_RECOVERY_CODE'))
          : Promise.resolve(player);
      },
    },
    log: { warn: (message) => warnings.push(message) },
  });
  return {
    repo,
    calls,
    warnings,
    service,
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
    const status = await service.link(ALICE.id, ' Alice@Gmail.com ', GOOD, '1.2.3.4');

    expect(status).toEqual({ linked: true, maskedEmail: 'a•••@gmail.com' });
    expect(repo.rows).toEqual([
      { playerId: ALICE.id, email: 'alice@gmail.com', secretHash: `h(${GOOD})` },
    ]);
  });

  it('refuse un second rattachement : on change le mot de passe, pas l adresse', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, '1.2.3.4');
    expect(await reasonOf(service.link(ALICE.id, 'autre@gmail.com', GOOD, '1.2.3.4'))).toBe(
      'EMAIL_ALREADY_LINKED',
    );
  });

  it('refuse une adresse deja prise par un autre joueur, sans dire par qui', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, '1.2.3.4');
    expect(await reasonOf(service.link(BOB.id, 'ALICE@gmail.com', GOOD, '1.2.3.4'))).toBe(
      'EMAIL_UNAVAILABLE',
    );
  });

  it('applique la politique : trop courant, ou egal a l adresse', async () => {
    const { repo, service } = setup();
    expect(await reasonOf(service.link(ALICE.id, 'alice@gmail.com', 'azertyuiop', 'ip'))).toBe(
      'PASSWORD_TOO_COMMON',
    );
    expect(await reasonOf(service.link(ALICE.id, 'alice@gmail.com', 'Alice@Gmail.com', 'ip'))).toBe(
      'PASSWORD_MATCHES_EMAIL',
    );
    expect(repo.rows).toEqual([]);
  });

  /*
    L'adresse deja prise est une information : un compte invite se cree en un
    appel, donc cette route est un oracle ouvert a tous. On la borne comme la
    connexion, pour qu'on ne puisse pas y deverser un annuaire.
  */
  it('borne les essais de rattachement par joueur', async () => {
    const { service } = setup();
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, 'ip-a');
    for (let i = 0; i < LIMITS.linkPerPlayer; i++) {
      await reasonOf(service.link(BOB.id, 'alice@gmail.com', GOOD, `ip-${String(i)}`));
    }
    expect(await reasonOf(service.link(BOB.id, 'bob@gmail.com', GOOD, 'ip-z'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('refuse un joueur qui n existe plus', async () => {
    const { service } = setup();
    expect(await reasonOf(service.link('p-fantome', 'x@gmail.com', GOOD, 'ip'))).toBe(
      'UNKNOWN_PLAYER',
    );
  });
});

describe('login', () => {
  async function linked() {
    const context = setup();
    await context.service.link(ALICE.id, 'alice@gmail.com', GOOD, 'ip-link');
    context.calls.verify = 0;
    context.calls.verifiedAgainst.length = 0;
    return context;
  }

  it('retrouve le joueur, quelle que soit la casse de l adresse', async () => {
    const { service } = await linked();
    await expect(service.login('ALICE@gmail.com ', GOOD, 'ip')).resolves.toBe(ALICE.id);
  });

  it('rend la meme erreur pour une adresse inconnue et un mauvais mot de passe', async () => {
    const { service } = await linked();
    const unknown = await reasonOf(service.login('personne@gmail.com', GOOD, 'ip'));
    const wrong = await reasonOf(service.login('alice@gmail.com', 'pas le bon', 'ip'));
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
    await reasonOf(service.login('personne@gmail.com', GOOD, 'ip'));
    expect(calls.verify).toBe(1);
    expect(calls.verifiedAgainst[0]).toMatch(/^h\(/);
  });

  it('bloque une adresse apres cinq echecs, meme depuis des adresses IP differentes', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      expect(await reasonOf(service.login('alice@gmail.com', 'faux', `ip-${String(i)}`))).toBe(
        'INVALID_CREDENTIALS',
      );
    }
    // Meme le bon mot de passe : sinon le blocage dirait quand l'attaquant a
    // trouve, puisque seul le bon passerait.
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, 'ip-neuve'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('bloque une adresse IP qui essaie beaucoup d adresses', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.loginPerIp; i++) {
      await reasonOf(service.login(`cible${String(i)}@gmail.com`, 'faux', 'ip-bot'));
    }
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, 'ip-bot'))).toBe(
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('ne hache rien quand la limite est atteinte', async () => {
    const { service, calls } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await reasonOf(service.login('alice@gmail.com', 'faux', 'ip'));
    }
    const before = calls.verify;
    await reasonOf(service.login('alice@gmail.com', 'faux', 'ip'));
    // Le hachage est la partie chere : la limite protege aussi le processeur.
    expect(calls.verify).toBe(before);
  });

  it('rouvre la porte apres la fenetre', async () => {
    const { service, advance } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await reasonOf(service.login('alice@gmail.com', 'faux', 'ip'));
    }
    advance(15 * 60_000 + 1);
    await expect(service.login('alice@gmail.com', GOOD, 'ip')).resolves.toBe(ALICE.id);
  });

  it('efface les echecs de l adresse apres une connexion reussie', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.loginPerEmail - 1; i++) {
      await reasonOf(service.login('alice@gmail.com', 'faux', 'ip'));
    }
    await service.login('alice@gmail.com', GOOD, 'ip');
    // Une faute de frappe le lendemain ne doit pas la bloquer.
    await reasonOf(service.login('alice@gmail.com', 'faux', 'ip'));
    await expect(service.login('alice@gmail.com', GOOD, 'ip')).resolves.toBe(ALICE.id);
  });

  it('journalise les echecs sans adresse ni mot de passe', async () => {
    const { service, warnings } = await linked();
    await reasonOf(service.login('alice@gmail.com', 'mauvais-secret', 'ip'));
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await reasonOf(service.login('alice@gmail.com', 'mauvais-secret', 'ip'));
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
    await context.service.link(ALICE.id, 'alice@gmail.com', GOOD, 'ip');
    await context.service.link(BOB.id, 'bob@gmail.com', GOOD, 'ip');
    return context;
  }

  it('change le mot de passe sur preuve de l ancien', async () => {
    const { service } = await linked();
    await service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle phrase');
    await expect(service.login('alice@gmail.com', 'nouvelle phrase', 'ip')).resolves.toBe(ALICE.id);
    expect(await reasonOf(service.login('alice@gmail.com', GOOD, 'ip'))).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('refuse un ancien mot de passe faux', async () => {
    const { service } = await linked();
    expect(
      await reasonOf(service.changePassword(ALICE.id, { currentPassword: 'faux' }, 'nouvelle ok')),
    ).toBe('INVALID_CREDENTIALS');
  });

  /*
    Le chemin du mot de passe oublie : aucun courrier ne part jamais, donc la
    preuve de secours est le code de recuperation. Un code d'un AUTRE compte ne
    vaut rien ici.
  */
  it('accepte le code de recuperation du joueur, pas celui d un autre', async () => {
    const { service } = await linked();
    await service.changePassword(BOB.id, { recoveryCode: 'AURA-BOB' }, 'nouvelle phrase');
    await expect(service.login('bob@gmail.com', 'nouvelle phrase', 'ip')).resolves.toBe(BOB.id);

    expect(
      await reasonOf(service.changePassword(ALICE.id, { recoveryCode: 'AURA-BOB' }, 'autre ok')),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await reasonOf(service.changePassword(ALICE.id, { recoveryCode: 'AURA-RIEN' }, 'autre ok')),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('applique la politique au nouveau mot de passe', async () => {
    const { service } = await linked();
    expect(
      await reasonOf(service.changePassword(ALICE.id, { currentPassword: GOOD }, 'password1')),
    ).toBe('PASSWORD_TOO_COMMON');
    expect(
      await reasonOf(
        service.changePassword(ALICE.id, { currentPassword: GOOD }, 'alice@gmail.com'),
      ),
    ).toBe('PASSWORD_MATCHES_EMAIL');
  });

  it('refuse un joueur sans adresse', async () => {
    const { service } = setup();
    expect(
      await reasonOf(service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle ok')),
    ).toBe('EMAIL_NOT_LINKED');
  });

  /*
    Une session volee ne doit pas devenir un banc d'essai du mot de passe :
    le meme mot de passe sert peut-etre ailleurs.
  */
  it('borne les essais de l ancien mot de passe', async () => {
    const { service } = await linked();
    for (let i = 0; i < LIMITS.passwordPerPlayer; i++) {
      await reasonOf(service.changePassword(ALICE.id, { currentPassword: 'faux' }, 'nouvelle ok'));
    }
    expect(
      await reasonOf(service.changePassword(ALICE.id, { currentPassword: GOOD }, 'nouvelle ok')),
    ).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('status', () => {
  it('dit si une adresse est rattachee, masquee', async () => {
    const { service } = setup();
    await expect(service.status(ALICE.id)).resolves.toEqual({ linked: false, maskedEmail: null });
    await service.link(ALICE.id, 'alice@gmail.com', GOOD, 'ip');
    await expect(service.status(ALICE.id)).resolves.toEqual({
      linked: true,
      maskedEmail: 'a•••@gmail.com',
    });
  });
});
