import { describe, expect, it } from 'vitest';
import { CredentialsChangedError, FreshAccessTokenVerifier } from './fresh-token.js';
import type { VerifiedToken } from './socket-auth.js';

/** Jeton `sub@cv` : le verificateur interne est un double lisible. */
const inner = {
  verify: (token: string): Promise<VerifiedToken> => {
    const [sub = '', cv] = token.split('@');
    return Promise.resolve(cv === undefined ? { sub } : { sub, cv: Number(cv) });
  },
};

function verifier(version: number | null) {
  const reads: string[] = [];
  const sut = new FreshAccessTokenVerifier(inner, {
    credentialsVersion: (playerId) => {
      reads.push(playerId);
      return Promise.resolve(version);
    },
  });
  return { sut, reads };
}

describe('FreshAccessTokenVerifier', () => {
  it('accepte un jeton de la version en cours', async () => {
    await expect(verifier(3).sut.verify('p1@3')).resolves.toEqual({ sub: 'p1', cv: 3 });
  });

  /*
    L'intrus chasse garde un jeton d'acces signe, non expire : il porte
    l'ancienne version et ne vaut plus rien. Egalite stricte, pas d'arrondi :
    c'est l'arrondi a la seconde de la version par dates qui laissait passer
    un jeton emis dans la seconde du changement.
  */
  it('refuse un jeton d une autre version', async () => {
    await expect(verifier(3).sut.verify('p1@2')).rejects.toBeInstanceOf(CredentialsChangedError);
    await expect(verifier(3).sut.verify('p1@4')).rejects.toBeInstanceOf(CredentialsChangedError);
  });

  /*
    Compatibilite : un jeton signe avant l'existence du claim `cv` vaut
    version 0, celle de tout joueur qui n'a jamais change de mot de passe. Il
    tombe des le premier changement.
  */
  it('traite un jeton sans version comme la version 0', async () => {
    await expect(verifier(0).sut.verify('p1')).resolves.toEqual({ sub: 'p1' });
    await expect(verifier(1).sut.verify('p1')).rejects.toBeInstanceOf(CredentialsChangedError);
  });

  it('refuse le jeton d un joueur qui n existe plus', async () => {
    await expect(verifier(null).sut.verify('p1@0')).rejects.toBeInstanceOf(CredentialsChangedError);
  });

  /* Meme regle que le handshake : un sujet vide n'est personne. */
  it('refuse un sujet vide, sans lire la base', async () => {
    const { sut, reads } = verifier(0);
    await expect(sut.verify('@0')).rejects.toBeInstanceOf(CredentialsChangedError);
    expect(reads).toEqual([]);
  });
});
