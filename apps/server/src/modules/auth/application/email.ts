import { randomBytes } from 'node:crypto';
import type { EmailStatusResponse } from '@aura/protocol';
import type { AppLog } from '../../../shared/log-port.js';
import {
  emailAttemptKey,
  maskEmail,
  normalizeEmail,
  passwordProblem,
  preparePassword,
} from '../domain/email.js';
import { EmailIdentityConflictError } from '../domain/ports.js';
import type {
  AttemptKey,
  AttemptLimiter,
  EmailIdentityRepository,
  PasswordHasher,
  PlayerRecord,
} from '../domain/ports.js';
import { RecoveryError } from './recovery.js';

/**
 * Email et mot de passe : rattacher, se connecter, changer de mot de passe.
 *
 * Meme partage des roles que `RecoveryService` : le service **ne fabrique pas
 * de session**. `login` rend le joueur, et l'appelant ouvre la session par le
 * chemin habituel — un second chemin d'emission de jetons serait un second
 * endroit ou la rotation, l'expiration et la revocation pourraient diverger.
 */

export type EmailAuthFailure =
  | 'UNKNOWN_PLAYER'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_UNAVAILABLE'
  | 'EMAIL_ALREADY_LINKED'
  | 'EMAIL_NOT_LINKED'
  | 'PASSWORD_TOO_COMMON'
  | 'PASSWORD_MATCHES_EMAIL'
  | 'TOO_MANY_ATTEMPTS';

export class EmailAuthError extends Error {
  constructor(readonly reason: EmailAuthFailure) {
    super(reason);
    this.name = 'EmailAuthError';
  }
}

/**
 * Les limites, sur une fenetre de quinze minutes (celle de l'adaptateur).
 *
 * - **5 par adresse** : un joueur qui a oublie son mot de passe en essaie deux
 *   ou trois, pas six. Au-dela, le code de recuperation est la bonne porte.
 * - **20 par adresse IP** : assez pour une famille ou un reseau d'operateur
 *   qui partage une adresse, trop peu pour essayer un dictionnaire sur des
 *   milliers d'adresses. Une connexion reussie rend sa tentative.
 * - **10 rattachements par joueur, 20 par IP** : « cette adresse est deja
 *   prise » est une information, et un compte invite se cree en un appel.
 * - **5 changements de mot de passe par joueur** : une session volee ne doit
 *   pas devenir un banc d'essai de l'ancien mot de passe, qui sert peut-etre
 *   ailleurs.
 *
 * Bloquer une adresse bloque aussi son proprietaire, quinze minutes. C'est le
 * prix, et il est faible ici : son appareil reste connecte par son secret, et
 * le code de recuperation ouvre toujours son compte.
 */
export const LIMITS = Object.freeze({
  windowMs: 15 * 60_000,
  loginPerEmail: 5,
  loginPerIp: 20,
  linkPerPlayer: 10,
  linkPerIp: 20,
  passwordPerPlayer: 5,
});

/** La preuve qui autorise un changement de mot de passe : l'une ou l'autre. */
export type PasswordProof =
  | { readonly currentPassword: string; readonly recoveryCode?: undefined }
  | { readonly recoveryCode: string; readonly currentPassword?: undefined };

export interface EmailAuthDependencies {
  readonly identities: EmailIdentityRepository;
  readonly hasher: PasswordHasher;
  readonly limiter: AttemptLimiter;
  /** Le code de recuperation, preuve de secours du mot de passe oublie. */
  readonly recovery: { claim(code: string): Promise<PlayerRecord> };
  readonly log: AppLog;
}

const ipKey = (scope: string, ip: string): string => `${scope}:ip:${ip}`;

export class EmailAuthService {
  /**
   * Un hache jetable, calcule une fois avec les memes parametres.
   *
   * Une adresse inconnue est verifiee contre lui : la reponse coute alors le
   * meme temps qu'un mauvais mot de passe, et le chronometre ne dit pas quelles
   * adresses ont un compte. Calcule des la construction, pour que le premier
   * appel ne soit pas plus lent que les autres.
   */
  private readonly dummyHash: Promise<string>;

  constructor(private readonly deps: EmailAuthDependencies) {
    this.dummyHash = deps.hasher.hash(randomBytes(16).toString('hex'));
    // Rattrape ici pour ne pas faire tomber le processus ; l'erreur ressort
    // au premier `await`, ou elle a un appelant pour la recevoir.
    this.dummyHash.catch(() => undefined);
  }

  async status(playerId: string): Promise<EmailStatusResponse> {
    const identity = await this.deps.identities.findEmailOf(playerId);
    return identity === null
      ? { linked: false, maskedEmail: null }
      : { linked: true, maskedEmail: maskEmail(identity.email) };
  }

  /**
   * Rattache une adresse et un mot de passe au joueur connecte.
   *
   * Une adresse par joueur. En changer n'est pas prevu : on change le mot de
   * passe (`changePassword`), et une adresse ne se deplace pas d'un compte a
   * l'autre en silence.
   */
  async link(
    playerId: string,
    rawEmail: string,
    password: string,
    ip: string,
  ): Promise<EmailStatusResponse> {
    const email = normalizeEmail(rawEmail);
    this.enforcePolicy(password, email);

    const allowed = await this.deps.limiter.attempt([
      { key: `link:player:${playerId}`, limit: LIMITS.linkPerPlayer },
      { key: ipKey('link', ip), limit: LIMITS.linkPerIp },
    ]);
    if (!allowed) {
      this.deps.log.warn('rattachement d email bloque : trop de tentatives');
      throw new EmailAuthError('TOO_MANY_ATTEMPTS');
    }

    const player = await this.deps.identities.findById(playerId);
    if (player === null) throw new EmailAuthError('UNKNOWN_PLAYER');
    if ((await this.deps.identities.findEmailOf(playerId)) !== null) {
      throw new EmailAuthError('EMAIL_ALREADY_LINKED');
    }

    const secretHash = await this.deps.hasher.hash(preparePassword(password));
    try {
      const outcome = await this.deps.identities.linkEmailIdentity(player.id, email, secretHash);
      // Deux appuis simultanes : le second trouve la place prise par le premier.
      if (outcome === 'ALREADY_LINKED') throw new EmailAuthError('EMAIL_ALREADY_LINKED');
    } catch (cause) {
      if (cause instanceof EmailIdentityConflictError) {
        // « Indisponible », sans dire a qui elle appartient.
        throw new EmailAuthError('EMAIL_UNAVAILABLE');
      }
      throw cause;
    }
    return { linked: true, maskedEmail: maskEmail(email) };
  }

  /**
   * Retrouve le joueur de cette adresse, sur preuve du mot de passe.
   *
   * **Une seule erreur** pour l'adresse inconnue et le mauvais mot de passe, et
   * le meme temps de calcul : ni le message ni le chronometre ne disent quelles
   * adresses ont un compte.
   *
   * La limite passe **avant** le hachage : c'est la partie chere, et une
   * rafale bloquee ne doit rien couter au processeur.
   */
  async login(rawEmail: string, password: string, ip: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const byEmail: AttemptKey = { key: emailAttemptKey(email), limit: LIMITS.loginPerEmail };
    const byIp: AttemptKey = { key: ipKey('login', ip), limit: LIMITS.loginPerIp };

    if (!(await this.deps.limiter.attempt([byEmail, byIp]))) {
      this.deps.log.warn(`connexion par email bloquee : trop de tentatives (${trace(byEmail)})`);
      throw new EmailAuthError('TOO_MANY_ATTEMPTS');
    }

    const identity = await this.deps.identities.findByEmail(email);
    const matches = await this.deps.hasher.verify(
      identity?.secretHash ?? (await this.dummyHash),
      preparePassword(password),
    );
    if (identity === null || !matches) {
      this.deps.log.warn(`connexion par email refusee (${trace(byEmail)})`);
      throw new EmailAuthError('INVALID_CREDENTIALS');
    }

    // Le proprietaire a fait sa preuve : ses fautes de frappe d'avant ne
    // comptent plus, et sa reussite ne pese pas sur ceux qui partagent son IP.
    await this.deps.limiter.reset(byEmail.key);
    await this.deps.limiter.refund(byIp.key);
    return identity.playerId;
  }

  /**
   * Change le mot de passe, sur preuve de l'ancien **ou** du code de
   * recuperation.
   *
   * Le code est le chemin du mot de passe oublie : aucun courrier ne part
   * jamais, et c'est la seule autre preuve que le joueur detient. On ne se
   * contente pas de la session ouverte : une session, c'est aussi un telephone
   * deverrouille pose sur une table, et le mot de passe sert peut-etre
   * ailleurs.
   */
  async changePassword(playerId: string, proof: PasswordProof, newPassword: string): Promise<void> {
    const identity = await this.deps.identities.findEmailOf(playerId);
    if (identity === null) throw new EmailAuthError('EMAIL_NOT_LINKED');
    this.enforcePolicy(newPassword, identity.email);

    const byPlayer = `password:player:${playerId}`;
    const allowed = await this.deps.limiter.attempt([
      { key: byPlayer, limit: LIMITS.passwordPerPlayer },
    ]);
    if (!allowed) {
      this.deps.log.warn('changement de mot de passe bloque : trop de tentatives');
      throw new EmailAuthError('TOO_MANY_ATTEMPTS');
    }

    if (!(await this.proves(playerId, identity.secretHash, proof))) {
      this.deps.log.warn('changement de mot de passe refuse : preuve invalide');
      throw new EmailAuthError('INVALID_CREDENTIALS');
    }

    const secretHash = await this.deps.hasher.hash(preparePassword(newPassword));
    if (!(await this.deps.identities.setPasswordHash(playerId, secretHash))) {
      throw new EmailAuthError('EMAIL_NOT_LINKED');
    }
    await this.deps.limiter.reset(byPlayer);
  }

  private async proves(playerId: string, secretHash: string, proof: PasswordProof) {
    if (proof.currentPassword !== undefined) {
      return this.deps.hasher.verify(secretHash, preparePassword(proof.currentPassword));
    }
    try {
      // Le code doit ouvrir CE compte : celui d'un autre ne prouve rien ici.
      return (await this.deps.recovery.claim(proof.recoveryCode)).id === playerId;
    } catch (cause) {
      if (cause instanceof RecoveryError) return false;
      throw cause;
    }
  }

  private enforcePolicy(password: string, email: string): void {
    const problem = passwordProblem(password, email);
    if (problem === 'TOO_COMMON') throw new EmailAuthError('PASSWORD_TOO_COMMON');
    if (problem === 'MATCHES_EMAIL') throw new EmailAuthError('PASSWORD_MATCHES_EMAIL');
  }
}

/**
 * Ce qu'une ligne de journal peut dire de la cible : un fragment d'empreinte.
 *
 * Assez pour voir qu'une meme adresse est visee cent fois, jamais l'adresse —
 * la redaction du journal ne connait pas ce champ, donc il ne doit rien
 * contenir qu'elle aurait du masquer.
 */
function trace(key: AttemptKey): string {
  return `cible ${key.key.slice('email:'.length, 'email:'.length + 12)}`;
}
