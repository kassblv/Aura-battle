import { randomBytes } from 'node:crypto';
import type { EmailStatusResponse } from '@aura/protocol';
import type { AppLog } from '../../../shared/log-port.js';
import { hashSecret } from '../domain/credentials.js';
import {
  emailAttemptKey,
  ipBucket,
  maskEmail,
  normalizeEmail,
  passwordProblem,
  preparePassword,
} from '../domain/email.js';
import { EmailIdentityConflictError } from '../domain/ports.js';
import type {
  AttemptKey,
  AttemptLimiter,
  Clock,
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
 *
 * Des qu'une adresse est rattachee, **le mot de passe est le secret maitre du
 * compte** (ADR 0013) : une session seule ne suffit plus ni a le changer, ni a
 * se faire delivrer un code de recuperation qui permettrait de le changer.
 */

export type EmailAuthFailure =
  | 'UNKNOWN_PLAYER'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_UNAVAILABLE'
  | 'EMAIL_ALREADY_LINKED'
  | 'EMAIL_NOT_LINKED'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_COMMON'
  | 'PASSWORD_MATCHES_EMAIL'
  | 'PASSWORD_REQUIRED'
  | 'DEVICE_PROOF_REQUIRED'
  | 'RECOVERY_CODE_TOO_RECENT'
  | 'NO_CLIENT_ADDRESS'
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
 * - **5 echecs de preuve de mot de passe par joueur et par appareil, 20
 *   preuves par IP** (changement de mot de passe, demande de code) : une
 *   session volee ne doit pas devenir un banc d'essai de l'ancien mot de
 *   passe, qui sert peut-etre ailleurs.
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
  passwordPerIp: 20,
});

/**
 * Age minimal d'un code de recuperation pour servir de preuve.
 *
 * Avant qu'un email soit rattache, une session suffisait a se faire delivrer
 * un code ; un intrus pouvait donc en detenir un tout neuf. Une heure plus
 * tard, le joueur a eu le temps de voir que son code a change — et le
 * parcours legitime n'en souffre pas : le « mot de passe oublie » se fait avec
 * le code NOTE, delivre bien avant.
 */
export const RECOVERY_PROOF_MIN_AGE_MS = 60 * 60_000;

/** La preuve qui autorise un changement de mot de passe : l'une ou l'autre. */
export type PasswordProof =
  | { readonly currentPassword: string; readonly recoveryCode?: undefined }
  | { readonly recoveryCode: string; readonly currentPassword?: undefined };

export interface EmailAuthDependencies {
  readonly identities: EmailIdentityRepository;
  readonly hasher: PasswordHasher;
  readonly limiter: AttemptLimiter;
  /** Le code de recuperation, preuve de secours du mot de passe oublie. */
  readonly recovery: {
    prove(code: string): Promise<{ readonly player: PlayerRecord; readonly issuedAt: Date }>;
  };
  readonly clock: Clock;
  /** Cle du HMAC qui cache les adresses dans Redis et dans les journaux. */
  readonly traceKey: string;
  readonly log: AppLog;
}

/**
 * La cle IP d'un compteur, sur le seau normalise (IPv6 par /64).
 *
 * Sans adresse lisible on refuse : ranger ces requetes sous une cle commune
 * laisserait n'importe qui la remplir et bloquer tous les autres.
 */
function ipKey(scope: string, ip: string | undefined): string {
  const bucket = ipBucket(ip);
  if (bucket === null) throw new EmailAuthError('NO_CLIENT_ADDRESS');
  return `${scope}:ip:${bucket}`;
}

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
    ip: string | undefined,
    deviceSecret?: string,
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
    // Un compte sans adresse n'a que ses appareils pour secret : rattacher une
    // adresse exige d'en prouver un, sinon un jeton vole suffirait a poser
    // l'adresse et le mot de passe de l'intrus, puis a chasser le joueur.
    if ((await this.ownedDevice(playerId, deviceSecret)) === null) {
      throw new EmailAuthError('DEVICE_PROOF_REQUIRED');
    }
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
  async login(rawEmail: string, password: string, ip: string | undefined): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const byEmail: AttemptKey = {
      key: emailAttemptKey(email, this.deps.traceKey),
      limit: LIMITS.loginPerEmail,
    };
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
   * Change le mot de passe, sur preuve de l'ancien **ou** d'un code de
   * recuperation delivre il y a plus d'une heure.
   *
   * Le code est le chemin du mot de passe oublie : aucun courrier ne part
   * jamais. On ne se contente pas de la session ouverte : une session, c'est
   * aussi un telephone deverrouille pose sur une table, ou un jeton vole.
   *
   * Changer de mot de passe **chasse tout le monde** : toutes les sessions sont
   * revoquees et tous les appareils detaches, sauf celui qui fait la demande
   * (`deviceSecret`). C'est le geste de qui pense que quelqu'un d'autre est
   * entre ; le laisser dedans le rendrait inutile.
   */
  async changePassword(
    playerId: string,
    proof: PasswordProof,
    newPassword: string,
    ip: string | undefined,
    deviceSecret?: string,
  ): Promise<void> {
    const identity = await this.deps.identities.findEmailOf(playerId);
    if (identity === null) throw new EmailAuthError('EMAIL_NOT_LINKED');
    this.enforcePolicy(newPassword, identity.email);

    const device = await this.ownedDevice(playerId, deviceSecret);
    await this.proveWithLimits(playerId, device, ip, identity.secretHash, proof, 'mot de passe');

    const secretHash = await this.deps.hasher.hash(preparePassword(newPassword));
    if (
      !(await this.deps.identities.setPasswordHash(
        playerId,
        secretHash,
        device,
        this.deps.clock.now(),
      ))
    ) {
      throw new EmailAuthError('EMAIL_NOT_LINKED');
    }
  }

  /**
   * Autorise, ou refuse, la delivrance d'un nouveau code de recuperation.
   *
   * - Avec une adresse, l'ancien mot de passe est exige : sinon un intrus muni
   *   d'une session remplacerait le code du joueur par le sien, puis s'en
   *   servirait pour changer le mot de passe.
   * - Sans adresse, la preuve d'un appareil DEJA rattache a ce joueur est
   *   exigee (`deviceSecret`) : un jeton vole ne suffit plus, il faut le
   *   secret que seul l'appareil du joueur detient.
   */
  async authorizeRecoveryIssue(
    playerId: string,
    currentPassword: string | undefined,
    ip: string | undefined,
    deviceSecret?: string,
  ): Promise<void> {
    const identity = await this.deps.identities.findEmailOf(playerId);
    const device = await this.ownedDevice(playerId, deviceSecret);
    if (identity === null) {
      if (device === null) throw new EmailAuthError('DEVICE_PROOF_REQUIRED');
      return;
    }
    if (currentPassword === undefined) throw new EmailAuthError('PASSWORD_REQUIRED');
    await this.proveWithLimits(
      playerId,
      device,
      ip,
      identity.secretHash,
      { currentPassword },
      'demande de code',
    );
  }

  /**
   * L'empreinte de cet appareil s'il appartient bien a CE joueur, sinon `null`.
   *
   * Un secret d'appareil fait 256 bits : le deviner n'est pas une attaque, et
   * sa preuve n'a donc pas besoin de limite de tentatives.
   */
  private async ownedDevice(
    playerId: string,
    deviceSecret: string | undefined,
  ): Promise<string | null> {
    if (deviceSecret === undefined) return null;
    const hash = hashSecret(deviceSecret);
    const owner = await this.deps.identities.findByDeviceHash(hash);
    return owner?.id === playerId ? hash : null;
  }

  /**
   * Verifie une preuve de mot de passe sous deux limites.
   *
   * - **Par IP**, chaque tentative compte.
   * - **Par joueur ET par appareil**, seuls les ECHECS comptent. Un intrus qui
   *   rate expres cinq fois ne remplit que son propre compteur — celui de son
   *   appareil, ou celui des requetes sans appareil prouve — et le proprietaire,
   *   depuis le sien, reste libre de changer son mot de passe pour le chasser.
   */
  private async proveWithLimits(
    playerId: string,
    device: string | null,
    ip: string | undefined,
    secretHash: string,
    proof: PasswordProof,
    what: string,
  ): Promise<void> {
    const failures = `password:player:${playerId}:${device ?? 'sans-appareil'}`;
    const byIp = await this.deps.limiter.attempt([
      { key: ipKey('password', ip), limit: LIMITS.passwordPerIp },
    ]);
    if (!byIp || (await this.deps.limiter.peek(failures)) >= LIMITS.passwordPerPlayer) {
      this.deps.log.warn(`${what} bloque : trop de tentatives`);
      throw new EmailAuthError('TOO_MANY_ATTEMPTS');
    }
    try {
      await this.checkProof(playerId, secretHash, proof);
    } catch (cause) {
      if (cause instanceof EmailAuthError) {
        await this.deps.limiter.attempt([{ key: failures, limit: LIMITS.passwordPerPlayer }]);
      }
      throw cause;
    }
    await this.deps.limiter.reset(failures);
  }

  private async checkProof(
    playerId: string,
    secretHash: string,
    proof: PasswordProof,
  ): Promise<void> {
    if (proof.currentPassword !== undefined) {
      if (await this.deps.hasher.verify(secretHash, preparePassword(proof.currentPassword))) return;
      this.deps.log.warn('preuve de mot de passe refusee');
      throw new EmailAuthError('INVALID_CREDENTIALS');
    }

    let proven: { readonly player: PlayerRecord; readonly issuedAt: Date };
    try {
      proven = await this.deps.recovery.prove(proof.recoveryCode);
    } catch (cause) {
      if (!(cause instanceof RecoveryError)) throw cause;
      this.deps.log.warn('preuve par code de recuperation refusee');
      throw new EmailAuthError('INVALID_CREDENTIALS');
    }
    // Le code doit ouvrir CE compte : celui d'un autre ne prouve rien ici.
    if (proven.player.id !== playerId) {
      this.deps.log.warn('preuve par code de recuperation refusee');
      throw new EmailAuthError('INVALID_CREDENTIALS');
    }
    const age = this.deps.clock.now().getTime() - proven.issuedAt.getTime();
    if (age < RECOVERY_PROOF_MIN_AGE_MS) {
      this.deps.log.warn('preuve par code de recuperation trop recente');
      throw new EmailAuthError('RECOVERY_CODE_TOO_RECENT');
    }
  }

  private enforcePolicy(password: string, email: string): void {
    const problem = passwordProblem(password, email);
    if (problem === 'TOO_SHORT') throw new EmailAuthError('PASSWORD_TOO_SHORT');
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
