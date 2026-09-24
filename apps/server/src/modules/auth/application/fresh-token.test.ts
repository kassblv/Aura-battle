import { describe, expect, it } from 'vitest';
import { CredentialsChangedError, FreshAccessTokenVerifier } from './fresh-token.js';
import type { VerifiedToken } from './socket-auth.js';

/** Jeton `sub@iat` : le verificateur interne est un double lisible. */
const inner = {
  verify: (token: string): Promise<VerifiedToken> => {
    const [sub = '', iat] = token.split('@');
    return Promise.resolve(iat === undefined ? { sub } : { sub, iat: Number(iat) });
  },
};

function verifier(changedAt: Date | null) {
  return new FreshAccessTokenVerifier(inner, {
    credentialsChangedAt: () => Promise.resolve(changedAt),
  });
}

// Changement de mot de passe a 1 000 000,400 s.
const CHANGED = new Date(1_000_000_400);

describe('FreshAccessTokenVerifier', () => {
  it('laisse passer tout jeton d un joueur qui n a jamais change de mot de passe', async () => {
    await expect(verifier(null).verify('p1@10')).resolves.toEqual({ sub: 'p1', iat: 10 });
  });

  /* L'intrus chasse garde un jeton d'acces signe, non expire : il ne vaut plus rien. */
  it('refuse un jeton emis avant le changement', async () => {
    await expect(verifier(CHANGED).verify('p1@999999')).rejects.toBeInstanceOf(
      CredentialsChangedError,
    );
  });

  /*
    `iat` est en secondes : le jeton que la route de changement delivre a
    l'appareil qui l'a demande tombe dans la meme seconde, et doit passer.
  */
  it('accepte un jeton emis dans la seconde du changement, ou apres', async () => {
    await expect(verifier(CHANGED).verify('p1@1000000')).resolves.toMatchObject({ sub: 'p1' });
    await expect(verifier(CHANGED).verify('p1@1000001')).resolves.toMatchObject({ sub: 'p1' });
  });

  it('refuse un jeton sans instant d emission apres un changement', async () => {
    await expect(verifier(CHANGED).verify('p1')).rejects.toBeInstanceOf(CredentialsChangedError);
  });

  it('laisse l appelant refuser un sujet vide, sans lire la base', async () => {
    const reader = {
      calls: 0,
      credentialsChangedAt() {
        this.calls += 1;
        return Promise.resolve(CHANGED);
      },
    };
    const sut = new FreshAccessTokenVerifier(inner, reader);
    await expect(sut.verify('@5')).resolves.toEqual({ sub: '', iat: 5 });
    expect(reader.calls).toBe(0);
  });
});
