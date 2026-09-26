import type { CredentialsVersionReader } from '../domain/ports.js';
import type { AccessTokenVerifier, VerifiedToken } from './socket-auth.js';

/**
 * Un jeton d'acces n'est valable que s'il porte la version des identifiants
 * en cours (ADR 0013).
 *
 * Changer de mot de passe revoque les jetons de rafraichissement et detache
 * les appareils ; mais un jeton d'ACCES deja emis reste signe et non expire
 * jusqu'a quinze minutes. Chaque jeton porte donc `cv`, la version des
 * identifiants a son emission, et on exige l'EGALITE avec la base. Un compteur
 * plutot qu'une date : une date se compare a la seconde pres (`iat`), et un
 * jeton emis dans la seconde du changement passait.
 *
 * Decore le verificateur partage : toutes les routes authentifiees et le
 * handshake Socket.IO passent par lui, donc aucune ne peut l'oublier.
 */
export class CredentialsChangedError extends Error {
  constructor() {
    super('CREDENTIALS_CHANGED');
    this.name = 'CredentialsChangedError';
  }
}

export class FreshAccessTokenVerifier implements AccessTokenVerifier {
  constructor(
    private readonly inner: AccessTokenVerifier,
    private readonly players: CredentialsVersionReader,
  ) {}

  async verify(token: string): Promise<VerifiedToken> {
    const verified = await this.inner.verify(token);
    // Un sujet vide n'est personne : refuse ici, comme au handshake, plutot
    // que de laisser chaque route s'en souvenir.
    if (verified.sub === '') throw new CredentialsChangedError();

    const current = await this.players.credentialsVersion(verified.sub);
    // Sans claim `cv` : un jeton signe avant son introduction, qui vaut
    // version 0 — celle de tout joueur qui n'a jamais change de mot de passe.
    if (current === null || (verified.cv ?? 0) !== current) {
      throw new CredentialsChangedError();
    }
    return verified;
  }
}
