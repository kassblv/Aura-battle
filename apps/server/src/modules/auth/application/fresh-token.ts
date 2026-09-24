import type { CredentialsChangeReader } from '../domain/ports.js';
import type { AccessTokenVerifier, VerifiedToken } from './socket-auth.js';

/**
 * Un jeton d'acces n'est valable que s'il est posterieur au dernier
 * changement de mot de passe (ADR 0013).
 *
 * Changer de mot de passe revoque les jetons de rafraichissement et detache
 * les appareils ; mais un jeton d'ACCES deja emis reste signe et non expire
 * jusqu'a quinze minutes. Sans ce controle, l'intrus chasse s'en servirait
 * pour rattacher un nouvel appareil (`device/link`) et revenir indefiniment.
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
    private readonly players: CredentialsChangeReader,
  ) {}

  async verify(token: string): Promise<VerifiedToken> {
    const verified = await this.inner.verify(token);
    if (verified.sub === '') return verified;

    const changedAt = await this.players.credentialsChangedAt(verified.sub);
    if (changedAt === null) return verified;

    /*
      `iat` est en secondes, la date en millisecondes. On compare a la SECONDE
      du changement : un jeton emis dans la meme seconde passe. C'est le cas
      du jeton que la route de changement delivre elle-meme a l'appareil qui
      l'a demande — le refuser le deconnecterait a l'instant de sa victoire.
      La fenetre concedee a un intrus est d'une seconde, pendant laquelle il
      devrait justement obtenir un jeton neuf, que la revocation lui refuse.
    */
    const changedSecond = Math.floor(changedAt.getTime() / 1_000);
    if (verified.iat === undefined || verified.iat < changedSecond) {
      throw new CredentialsChangedError();
    }
    return verified;
  }
}
