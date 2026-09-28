import { isBanActive } from '../domain/ban.js';
import type { Clock, CredentialsVersionReader, PlayerAccessReader } from '../domain/ports.js';
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

/**
 * Le joueur est banni (ADR 0018). Distinct d'un jeton invalide : le handshake
 * le dit au client au lieu de l'inviter a rafraichir une session qui ne se
 * rafraichira plus.
 */
export class PlayerBannedError extends Error {
  constructor() {
    super('BANNED');
    this.name = 'PlayerBannedError';
  }
}

export class FreshAccessTokenVerifier implements AccessTokenVerifier {
  constructor(
    private readonly inner: AccessTokenVerifier,
    /**
     * Avec `accessStateOf`, le bannissement est relu dans la meme lecture que
     * la version. Sans (doubles de test anciens), la version seule.
     */
    private readonly players: CredentialsVersionReader & Partial<PlayerAccessReader>,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async verify(token: string): Promise<VerifiedToken> {
    const verified = await this.inner.verify(token);
    // Un sujet vide n'est personne : refuse ici, comme au handshake, plutot
    // que de laisser chaque route s'en souvenir.
    if (verified.sub === '') throw new CredentialsChangedError();

    const state =
      this.players.accessStateOf === undefined
        ? await this.versionOnly(verified.sub)
        : await this.players.accessStateOf(verified.sub);
    // Sans claim `cv` : un jeton signe avant son introduction, qui vaut
    // version 0 — celle de tout joueur qui n'a jamais change de mot de passe.
    if (state === null) throw new CredentialsChangedError();
    if ((verified.cv ?? 0) !== state.credentialsVersion) throw new CredentialsChangedError();
    // Un jeton d'acces vit quinze minutes : sans ce controle, un banni
    // garderait la main jusqu'a son expiration.
    if (isBanActive(state.ban, this.clock.now())) throw new PlayerBannedError();
    return verified;
  }

  private async versionOnly(
    playerId: string,
  ): Promise<{ credentialsVersion: number; ban: null } | null> {
    const version = await this.players.credentialsVersion(playerId);
    return version === null ? null : { credentialsVersion: version, ban: null };
  }
}
