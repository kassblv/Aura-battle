import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma.service.js';
import { DeviceIdentityConflictError, EmailIdentityConflictError } from '../domain/ports.js';
import type {
  CredentialsVersionReader,
  EmailIdentityRecord,
  EmailIdentityRepository,
  PlayerRecord,
  PlayerRepository,
  RecoveryIdentityRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../domain/ports.js';

/**
 * Adaptateurs Prisma des ports d'authentification.
 *
 * Ils ne contiennent aucune regle : traduire une requete, rien de plus. Toute
 * la logique — validation du secret, rotation, detection de rejeu — vit dans
 * `application/session.ts`, ou elle se teste sans base de donnees.
 */

/** Appareils rattaches a un meme joueur, au plus (ADR 0013). */
export const MAX_DEVICES = 10;

@Injectable()
export class PrismaPlayerRepository
  implements
    PlayerRepository,
    RecoveryIdentityRepository,
    EmailIdentityRepository,
    CredentialsVersionReader
{
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir auth.controller.ts).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByDeviceHash(deviceHash: string): Promise<PlayerRecord | null> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'DEVICE', subject: deviceHash } },
      select: { player: { select: { id: true, displayName: true } } },
    });
    return identity?.player ?? null;
  }

  async findById(playerId: string): Promise<PlayerRecord | null> {
    return this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, displayName: true },
    });
  }

  /**
   * Rattache une identite d'appareil a un joueur existant.
   *
   * `P2002` veut dire que cette identite appartient deja a quelqu'un : traduit
   * en erreur du domaine, comme pour la creation.
   */
  async linkDeviceIdentity(playerId: string, deviceHash: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.authIdentity.create({
          data: { playerId, provider: 'DEVICE', subject: deviceHash },
        });
        /*
          Plafond d'appareils (ADR 0013) : on garde les MAX_DEVICES plus
          recents et on detache les autres. Refuser au-dela bloquerait le
          joueur sur ordinateur, dont chaque navigateur vide laisse un
          appareil mort ; remplacer le plus ancien borne ce qu'un compte peut
          accumuler sans fermer la porte a personne.
        */
        const stale = await tx.authIdentity.findMany({
          where: { playerId, provider: 'DEVICE' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: MAX_DEVICES,
          select: { id: true },
        });
        if (stale.length > 0) {
          await tx.authIdentity.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
        }
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new DeviceIdentityConflictError(cause);
      }
      throw cause;
    }
  }

  async findByRecoveryHash(codeHash: string): Promise<PlayerRecord | null> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'RECOVERY', subject: codeHash } },
      select: { player: { select: { id: true, displayName: true } } },
    });
    return identity?.player ?? null;
  }

  async findRecoveryIdentity(
    codeHash: string,
  ): Promise<{ readonly player: PlayerRecord; readonly issuedAt: Date } | null> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'RECOVERY', subject: codeHash } },
      select: { createdAt: true, player: { select: { id: true, displayName: true } } },
    });
    return identity === null ? null : { player: identity.player, issuedAt: identity.createdAt };
  }

  /**
   * Pose le code de recuperation du joueur, en remplacant le precedent.
   *
   * Suppression puis creation **dans une transaction**, et non un `upsert` :
   * la contrainte d'unicite porte sur `(provider, subject)`, pas sur
   * `(provider, playerId)`, donc il n'existe pas de cle sur laquelle poser un
   * `upsert`. Hors transaction, une panne entre les deux laisserait le joueur
   * sans aucun code — avec un code note sur un papier qui n'ouvre plus rien.
   */
  async setRecoveryIdentity(playerId: string, codeHash: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.authIdentity.deleteMany({ where: { playerId, provider: 'RECOVERY' } }),
      this.prisma.authIdentity.create({
        data: { playerId, provider: 'RECOVERY', subject: codeHash },
      }),
    ]);
  }

  async findByEmail(email: string): Promise<EmailIdentityRecord | null> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'EMAIL', subject: email } },
      select: { playerId: true, subject: true, secretHash: true },
    });
    return toEmailRecord(identity);
  }

  async findEmailOf(playerId: string): Promise<EmailIdentityRecord | null> {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { playerId, provider: 'EMAIL' },
      select: { playerId: true, subject: true, secretHash: true },
    });
    return toEmailRecord(identity);
  }

  /**
   * Rattache une adresse, a condition que le joueur n'en ait pas deja une.
   *
   * La contrainte d'unicite porte sur `(provider, subject)` : elle empeche deux
   * joueurs de partager une adresse, pas un joueur d'en avoir deux. Verifier
   * puis creer ne suffit pas — deux appuis sur « Valider » verraient tous deux
   * la place libre. La ligne du joueur est donc **verrouillee** (`FOR UPDATE`)
   * le temps de la transaction : le second appel attend le premier, puis voit
   * son adresse.
   *
   * `P2002` veut dire que l'adresse appartient a un autre joueur : traduit en
   * erreur du domaine, comme pour les appareils.
   */
  async linkEmailIdentity(
    playerId: string,
    email: string,
    secretHash: string,
  ): Promise<'LINKED' | 'ALREADY_LINKED'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Player" WHERE id = ${playerId} FOR UPDATE`;
        const existing = await tx.authIdentity.findFirst({
          where: { playerId, provider: 'EMAIL' },
          select: { id: true },
        });
        if (existing !== null) return 'ALREADY_LINKED' as const;
        await tx.authIdentity.create({
          data: { playerId, provider: 'EMAIL', subject: email, secretHash },
        });
        return 'LINKED' as const;
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new EmailIdentityConflictError(cause);
      }
      throw cause;
    }
  }

  /**
   * Nouveau hache, et appareils detaches sauf celui qui fait la demande.
   *
   * Une transaction : un mot de passe change dont les appareils de l'intrus
   * resteraient rattaches serait un changement pour rien, et l'inverse
   * laisserait le joueur deconnecte partout avec son ancien mot de passe.
   * `keepDeviceHash` n'est garde que s'il appartient a CE joueur — le filtre
   * porte sur `playerId`, donc le hache d'un autre ne protege rien.
   */
  async setPasswordHash(
    playerId: string,
    secretHash: string,
    keepDeviceHash: string | null,
    at: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.authIdentity.updateMany({
        where: { playerId, provider: 'EMAIL' },
        data: { secretHash },
      });
      if (count === 0) return false;
      await tx.authIdentity.deleteMany({
        where: {
          playerId,
          provider: 'DEVICE',
          ...(keepDeviceHash === null ? {} : { subject: { not: keepDeviceHash } }),
        },
      });
      // Meme transaction que la revocation : un renouvellement concurrent lit
      // cette ligne `FOR SHARE` et ne peut donc pas s'intercaler (voir `rotate`).
      await tx.player.update({
        where: { id: playerId },
        data: { credentialsVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { playerId, revokedAt: null },
        data: { revokedAt: at },
      });
      return true;
    });
  }

  async credentialsVersion(playerId: string): Promise<number | null> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { credentialsVersion: true },
    });
    return player?.credentialsVersion ?? null;
  }

  /**
   * Cree le joueur et son identite d'appareil **en une transaction**.
   * Un joueur sans identite serait injoignable ; une identite sans joueur
   * serait orpheline. Les deux doivent apparaitre ensemble ou pas du tout.
   *
   * Prisma leve `P2002` quand la contrainte d'unicite sur `(provider, subject)`
   * refuse la ligne, c'est-a-dire quand un autre appel a cree cette identite
   * entre-temps. Traduit ici en erreur du domaine, comme `P2025` l'est en
   * `null` plus bas : le cas d'usage a une reponse pour « cette identite existe
   * deja », il n'en a pas pour « le moteur de base a leve ».
   */
  async createWithDeviceIdentity(input: {
    deviceHash: string;
    displayName: string;
  }): Promise<PlayerRecord> {
    try {
      return await this.prisma.player.create({
        data: {
          displayName: input.displayName,
          identities: { create: { provider: 'DEVICE', subject: input.deviceHash } },
        },
        select: { id: true, displayName: true },
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new DeviceIdentityConflictError(cause);
      }
      throw cause;
    }
  }

  /**
   * Renomme, et rend `null` si le joueur a disparu entre-temps.
   *
   * Prisma leve `P2025` quand la ligne visee n'existe plus. On le traduit en
   * `null` plutot que de laisser remonter une erreur d'infrastructure : le
   * domaine a une reponse pour « ce joueur n'existe pas », il n'en a pas pour
   * « le moteur de base a leve ».
   */
  async rename(playerId: string, displayName: string): Promise<PlayerRecord | null> {
    try {
      return await this.prisma.player.update({
        where: { id: playerId },
        data: { displayName },
        select: { id: true, displayName: true },
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2025') {
        return null;
      }
      throw cause;
    }
  }

  async touchLastSeen(playerId: string): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: { lastSeenAt: new Date() },
    });
  }
}

/**
 * Une identite email sans hache n'ouvre rien.
 *
 * La colonne est nullable parce qu'elle est vide pour tous les autres
 * fournisseurs. Une ligne EMAIL sans hache ne devrait pas exister ; si elle
 * existait, la traiter comme absente vaut mieux que de la laisser comparer un
 * mot de passe a une chaine vide.
 */
function toEmailRecord(
  identity: { playerId: string; subject: string; secretHash: string | null } | null,
): EmailIdentityRecord | null {
  if (!identity?.secretHash) return null;
  return { playerId: identity.playerId, email: identity.subject, secretHash: identity.secretHash };
}

const TOKEN_FIELDS = {
  id: true,
  playerId: true,
  tokenHash: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  replacedBy: true,
  credentialsVersion: true,
} as const;

/**
 * La version des identifiants du joueur, lue sous verrou PARTAGE de sa ligne.
 *
 * Un changement de mot de passe modifie cette ligne : il attend donc la fin
 * de la transaction qui lit, ou la fait attendre. Emettre un jeton et changer
 * de mot de passe ne peuvent pas s'entrelacer. Un joueur disparu vaut -1, une
 * version qu'aucun jeton ne porte.
 */
async function lockedVersion(tx: Prisma.TransactionClient, playerId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ credentialsVersion: number }[]>`
    SELECT "credentialsVersion" FROM "Player" WHERE id = ${playerId} FOR SHARE`;
  return rows[0]?.credentialsVersion ?? -1;
}

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        playerId: true,
        tokenHash: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        replacedBy: true,
        credentialsVersion: true,
      },
    });
  }

  async create(input: {
    playerId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    return this.prisma.$transaction(async (tx) => {
      const credentialsVersion = await lockedVersion(tx, input.playerId);
      return tx.refreshToken.create({
        data: { ...input, credentialsVersion },
        select: TOKEN_FIELDS,
      });
    });
  }

  /**
   * Consomme et remplace, dans une transaction (ADR 0013).
   *
   * La consommation est un `updateMany` CONDITIONNEL (encore vivant) : de deux
   * appels concurrents, un seul compte une ligne. La ligne du joueur est lue
   * `FOR SHARE` : un changement de mot de passe, qui la modifie, attend la fin
   * de cette transaction ou la fait attendre — il passe donc soit avant (et
   * le jeton est `STALE`), soit apres (et sa revocation atteint le remplacant).
   */
  async rotate(input: {
    readonly id: string;
    readonly playerId: string;
    readonly credentialsVersion: number;
    readonly replacedByHash: string;
    readonly expiresAt: Date;
    readonly at: Date;
  }): Promise<
    | { readonly outcome: 'ROTATED'; readonly credentialsVersion: number }
    | { readonly outcome: 'REUSED' }
    | { readonly outcome: 'STALE' }
  > {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockedVersion(tx, input.playerId);
      const { count } = await tx.refreshToken.updateMany({
        where: { id: input.id, revokedAt: null, replacedBy: null },
        data: { replacedBy: input.replacedByHash, revokedAt: input.at },
      });
      if (count !== 1) return { outcome: 'REUSED' as const };
      if (current !== input.credentialsVersion) return { outcome: 'STALE' as const };
      await tx.refreshToken.create({
        data: {
          playerId: input.playerId,
          tokenHash: input.replacedByHash,
          expiresAt: input.expiresAt,
          credentialsVersion: current,
        },
      });
      return { outcome: 'ROTATED' as const, credentialsVersion: current };
    });
  }

  async revokeAllForPlayer(playerId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { playerId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
