import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Patch,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  parseAuthDeviceRequest,
  parseAuthEmailLinkRequest,
  parseAuthEmailLoginRequest,
  parseAuthEmailPasswordRequest,
  parseAuthRecoveryClaimRequest,
  parseAuthRecoveryIssueRequest,
  parseAuthRefreshRequest,
  parseAuthRenameRequest,
  type EmailStatusResponse,
  type PasswordChangeResponse,
  type RecoveryCodeResponse,
  type SessionResponse,
} from '@aura/protocol';
import { readBearer } from '../application/bearer.js';
import { EmailAuthError, EmailAuthService } from '../application/email.js';
import { IpRateLimit, type IpRateScope } from '../application/ip-rate-limit.js';
import { PasswordHasherBusyError } from '../domain/ports.js';
import type { AccessTokenVerifier } from '../application/socket-auth.js';
import { ProfileError, ProfileService } from '../application/profile.js';
import { RecoveryError, RecoveryService } from '../application/recovery.js';
import { SessionError, SessionService } from '../application/session.js';

/** Ce que la route de profil rend : le joueur, tel qu'il s'appelle desormais. */
export interface ProfileResponse {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Routes d'authentification (docs/03, jalon M3).
 *
 * Aucune inscription obligatoire : on joue d'abord, on rattache ensuite une
 * adresse ou un code si l'on veut retrouver son compte ailleurs. Le corps des
 * requetes est valide par les schemas de `@aura/protocol` : la meme definition
 * sert au client et au serveur, donc les deux ne peuvent pas diverger.
 */
@Controller('auth')
export class AuthController {
  /**
   * `@Inject` explicite, et non l'injection implicite par type.
   *
   * Nest deduit normalement le type d'un parametre de constructeur grace a la
   * metadonnee `design:paramtypes`, emise par `emitDecoratorMetadata`. Or esbuild
   * — donc `tsx`, qui fait tourner ce serveur — ne l'emet pas. Sans elle, Nest
   * ne sait pas quoi injecter et passe `undefined`, sans la moindre erreur au
   * demarrage : la panne n'apparait qu'au premier appel. Nommer le jeton
   * supprime le probleme et rend le cablage lisible.
   */
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(EmailAuthService) private readonly email: EmailAuthService,
    @Inject(IpRateLimit) private readonly ipLimit: IpRateLimit,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
  ) {}

  /**
   * Ouvre une session a partir d'un secret d'appareil.
   * Cree le joueur au premier appel, le retrouve ensuite.
   */
  @Post('device')
  async device(@Body() body: unknown, @Ip() ip: string | undefined): Promise<SessionResponse> {
    await this.limitIp('device', ip);
    const parsed = parseAuthDeviceRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    return this.toResponse(() => this.sessions.authenticateDevice(parsed.data.deviceSecret));
  }

  /** Echange un jeton de rafraichissement contre un nouveau couple. */
  @Post('refresh')
  async refresh(@Body() body: unknown, @Ip() ip: string | undefined): Promise<SessionResponse> {
    await this.limitIp('refresh', ip);
    const parsed = parseAuthRefreshRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    return this.toResponse(() => this.sessions.refresh(parsed.data.refreshToken));
  }

  /**
   * Change le nom affiche.
   *
   * Premiere route authentifiee du serveur. Le jeton est lu et verifie ici
   * plutot que par une garde globale : il n'y a qu'une route protegee, et une
   * garde posee sur tout le controleur fermerait aussi `device` et `refresh`,
   * qui sont precisement les deux routes qu'on appelle **sans** jeton.
   */
  @Patch('profile')
  async rename(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<ProfileResponse> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }

    const parsed = parseAuthRenameRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    let playerId: string;
    try {
      playerId = (await this.verifier.verify(token)).sub;
    } catch {
      // Signature, expiration, jeton forge : la reponse est la meme. Le client
      // n'a pas a apprendre laquelle de ces trois raisons s'applique.
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }

    try {
      return await this.profiles.rename(playerId, parsed.data.displayName);
    } catch (cause) {
      if (cause instanceof ProfileError) {
        if (cause.reason === 'INVALID_DISPLAY_NAME') {
          throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'nom invalide' });
        }
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
      }
      throw cause;
    }
  }

  /**
   * Delivre un code de recuperation au joueur connecte.
   *
   * Authentifiee, evidemment : un code delivre a qui le demande serait une
   * porte ouverte sur n'importe quel compte. Le precedent est remplace, donc
   * en redemander un revoque l'ancien.
   *
   * Le serveur ne garde que le hache : il ne sait pas rejouer un code deja
   * delivre, et c'est voulu. Une route « revoir mon code » serait une route
   * « voler un compte depuis une session ouverte ».
   */
  @Post('recovery')
  async issueRecovery(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Ip() ip: string | undefined,
  ): Promise<RecoveryCodeResponse> {
    const playerId = await this.requirePlayer(authorization);
    // Sans corps (client d'avant les adresses email) : un objet vide.
    const parsed = parseAuthRecoveryIssueRequest(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    // Des qu'une adresse est rattachee, le mot de passe est exige : sinon une
    // session volee remplacerait le code du joueur par le sien (ADR 0013).
    await this.emailCall(() =>
      this.email.authorizeRecoveryIssue(
        playerId,
        parsed.data.currentPassword,
        ip,
        parsed.data.deviceSecret,
      ),
    );
    try {
      return { code: await this.recovery.issue(playerId) };
    } catch (cause) {
      if (cause instanceof RecoveryError) {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
      }
      throw cause;
    }
  }

  /**
   * Presente un code et ouvre une session sur le compte qu'il designe.
   *
   * **Non** authentifiee : c'est precisement la route de quelqu'un qui n'a plus
   * de session. Le code tient lieu de preuve, comme le secret d'appareil pour
   * `device`.
   *
   * La session est ouverte par le chemin habituel plutot que par un second :
   * un autre point d'emission serait un autre endroit ou la rotation,
   * l'expiration et la revocation des jetons pourraient diverger.
   *
   * L'appareil (`deviceSecret`, un secret NEUF) est rattache **dans le meme
   * geste**, avant d'ouvrir la session. Une route de rattachement a part
   * laissait n'importe quel jeton vole fabriquer une « preuve d'appareil »
   * (ADR 0013) ; ici, seul qui presente le code rattache un appareil.
   */
  @Post('recovery/claim')
  async claimRecovery(
    @Body() body: unknown,
    @Ip() ip: string | undefined,
  ): Promise<SessionResponse> {
    await this.limitIp('claim', ip);
    const parsed = parseAuthRecoveryClaimRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    let proven;
    try {
      // `prove` et non `claim` : la version des identifiants lue avec le code,
      // que le rattachement exigera encore sous verrou.
      proven = await this.recovery.prove(parsed.data.code);
    } catch (cause) {
      if (cause instanceof RecoveryError) {
        // Saisie mal formee et code inconnu rendent la meme reponse : qui
        // essaie des codes au hasard n'a pas a apprendre lesquels ont la
        // bonne forme.
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'code de recuperation invalide',
        });
      }
      throw cause;
    }

    return this.joinWithDevice(
      proven.player.id,
      proven.credentialsVersion,
      parsed.data.deviceSecret,
    );
  }

  /**
   * L'adresse rattachee au joueur connecte, masquee.
   *
   * Jamais en clair, jamais le hache : les Reglages n'ont besoin que de la
   * reconnaitre, et un ecran se photographie.
   */
  @Get('email')
  async emailStatus(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<EmailStatusResponse> {
    const playerId = await this.requirePlayer(authorization);
    return this.email.status(playerId);
  }

  /**
   * Rattache une adresse et un mot de passe au joueur connecte.
   *
   * Authentifiee : on ajoute une facon d'ouvrir CE compte, comme le code de
   * recuperation. Une adresse deja prise rend `EMAIL_UNAVAILABLE`, sans dire
   * par qui — et la route est bornee, puisque cette reponse est une
   * information.
   */
  @Post('email/link')
  async linkEmail(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Ip() ip: string | undefined,
  ): Promise<EmailStatusResponse> {
    const playerId = await this.requirePlayer(authorization);
    const parsed = parseAuthEmailLinkRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    return this.emailCall(() =>
      this.email.link(
        playerId,
        parsed.data.email,
        parsed.data.password,
        ip,
        parsed.data.deviceSecret,
      ),
    );
  }

  /**
   * Presente une adresse et un mot de passe, et ouvre la session du compte.
   *
   * **Non** authentifiee, comme `recovery/claim` : c'est la route de quelqu'un
   * qui arrive sur un appareil neuf. Comme `recovery/claim`, elle rattache
   * l'appareil dans le meme geste que la preuve, puis ouvre la session par le
   * chemin habituel — sans ce rattachement, le rechargement suivant rouvrirait
   * le compte invite local.
   */
  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  async loginEmail(@Body() body: unknown, @Ip() ip: string | undefined): Promise<SessionResponse> {
    const parsed = parseAuthEmailLoginRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    const proven = await this.emailCall(() =>
      this.email.login(parsed.data.email, parsed.data.password, ip),
    );
    return this.joinWithDevice(
      proven.playerId,
      proven.credentialsVersion,
      parsed.data.deviceSecret,
    );
  }

  /**
   * Change le mot de passe, sur preuve de l'ancien ou du code de recuperation.
   *
   * Le code est le chemin du mot de passe oublie : aucun courrier ne part
   * jamais. La session seule ne suffit pas — un telephone deverrouille pose sur
   * une table ne doit pas suffire a changer un secret qui sert peut-etre
   * ailleurs.
   */
  @Post('email/password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Ip() ip: string | undefined,
  ): Promise<PasswordChangeResponse> {
    const playerId = await this.requirePlayer(authorization);
    const parsed = parseAuthEmailPasswordRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    const { currentPassword, recoveryCode, newPassword, deviceSecret } = parsed.data;
    // Le schema garantit une preuve et une seule.
    const proof =
      currentPassword !== undefined ? { currentPassword } : { recoveryCode: recoveryCode ?? '' };
    const { recoveryCode: freshCode } = await this.emailCall(() =>
      this.email.changePassword(playerId, proof, newPassword, ip, deviceSecret),
    );
    /*
      Une session fraiche, par le chemin habituel. Le changement vient de
      revoquer tous les jetons de rafraichissement et d'invalider tout jeton
      d'acces anterieur — y compris ceux de l'appareil qui l'a demande. Sans
      celle-ci, il serait deconnecte a l'instant ou il reprend son compte.

      Et le code de recuperation NEUF, qui remplace l'ancien : il ne sera plus
      jamais reaffiche, comme a la delivrance.
    */
    const session = await this.toResponse(() => this.sessions.openForPlayer(playerId));
    return { ...session, recoveryCode: freshCode };
  }

  /**
   * Rattache l'appareil qui vient de faire sa preuve, puis ouvre la session.
   *
   * Le seul chemin qui rattache un appareil a un compte existant : il suit
   * toujours une preuve (code ou mot de passe), jamais un simple jeton.
   */
  private async joinWithDevice(
    playerId: string,
    provenVersion: number,
    deviceSecret: string,
  ): Promise<SessionResponse> {
    try {
      return await this.sessions.joinWithDevice(playerId, provenVersion, deviceSecret);
    } catch (cause) {
      if (cause instanceof SessionError && cause.reason === 'CREDENTIALS_CHANGED') {
        // La preuve portait sur un secret qui vient d'etre change : elle ne
        // vaut plus rien, et la reponse est celle d'une preuve fausse.
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'email ou mot de passe incorrect',
        });
      }
      if (cause instanceof SessionError && cause.reason === 'DEVICE_ALREADY_LINKED') {
        throw new ConflictException({
          code: 'DEVICE_ALREADY_LINKED',
          message: 'cet appareil est deja rattache a un autre compte',
        });
      }
      if (cause instanceof SessionError) {
        throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'secret invalide' });
      }
      throw cause;
    }
  }

  /** Limite de debit par IP des routes publiques (ADR 0013). */
  private async limitIp(scope: IpRateScope, ip: string | undefined): Promise<void> {
    const verdict = await this.ipLimit.allow(scope, ip);
    if (verdict === 'NO_ADDRESS') {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'adresse inconnue' });
    }
    if (verdict === 'LIMITED') {
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'trop de tentatives, reessaie dans quinze minutes' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Traduit un refus du service email en reponse HTTP.
   *
   * Le `code` du corps est ce que le client lit pour choisir son message ;
   * `INVALID_CREDENTIALS` y est le meme pour une adresse inconnue et un
   * mauvais mot de passe.
   */
  private async emailCall<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof PasswordHasherBusyError) {
        // Le plafond global du hachage est atteint : on refuse vite plutot que
        // d'empiler des requetes a 19 Mio piece.
        throw new ServiceUnavailableException({
          code: 'BUSY',
          message: 'reessaie dans un instant',
        });
      }
      if (!(cause instanceof EmailAuthError)) throw cause;
      const code = cause.reason;
      switch (code) {
        case 'TOO_MANY_ATTEMPTS':
          throw new HttpException(
            { code, message: 'trop de tentatives, reessaie dans quinze minutes' },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        case 'INVALID_CREDENTIALS':
          throw new UnauthorizedException({ code, message: 'email ou mot de passe incorrect' });
        case 'UNKNOWN_PLAYER':
          throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
        case 'NO_CLIENT_ADDRESS':
          throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'adresse inconnue' });
        case 'EMAIL_UNAVAILABLE':
        case 'EMAIL_ALREADY_LINKED':
        case 'EMAIL_NOT_LINKED':
          throw new ConflictException({ code, message: code });
        case 'PASSWORD_REQUIRED':
        case 'DEVICE_PROOF_REQUIRED':
        case 'RECOVERY_CODE_TOO_RECENT':
          throw new ForbiddenException({ code, message: code });
        case 'PASSWORD_TOO_SHORT':
        case 'PASSWORD_TOO_COMMON':
        case 'PASSWORD_MATCHES_EMAIL':
          throw new BadRequestException({ code, message: 'mot de passe refuse' });
      }
    }
  }

  /**
   * Lit le jeton d'une route authentifiee, ou refuse.
   *
   * Extrait parce que plusieurs routes en ont besoin. Signature, expiration, jeton
   * forge : la reponse est la meme — le client n'a pas a apprendre laquelle
   * des trois s'applique.
   */
  private async requirePlayer(authorization: string | undefined): Promise<string> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }
    try {
      return (await this.verifier.verify(token)).sub;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }
  }

  /**
   * Traduit une erreur de session en reponse HTTP.
   *
   * Le message renvoye ne distingue pas « jeton inconnu » de « jeton rejoue » :
   * un attaquant n'a pas a apprendre, depuis nos reponses, si le jeton qu'il
   * essaie a deja existe. Le detail reste cote serveur, dans le journal.
   */
  private async toResponse(run: () => Promise<SessionResponse>): Promise<SessionResponse> {
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof SessionError) {
        if (cause.reason === 'INVALID_DEVICE_SECRET') {
          throw new BadRequestException({
            code: 'INVALID_PAYLOAD',
            message: 'secret d appareil invalide',
          });
        }
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'session expiree ou invalide',
        });
      }
      throw cause;
    }
  }
}
