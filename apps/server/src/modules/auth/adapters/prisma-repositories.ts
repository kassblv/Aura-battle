import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma.service.js';
import { DeviceIdentityConflictError } from '../domain/ports.js';
import type {
  PlayerRecord,
  PlayerRepository,
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

@Injectable()
export class PrismaPlayerRepository implements PlayerRepository {
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
        expiresAt: true,
        revokedAt: true,
        replacedBy: true,
      },
    });
  }

  async create(input: {
    playerId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({
      data: input,
      select: {
        id: true,
        playerId: true,
        tokenHash: true,
        expiresAt: true,
        revokedAt: true,
        replacedBy: true,
      },
    });
  }

  async markRotated(id: string, replacedByHash: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { replacedBy: replacedByHash, revokedAt: at },
    });
  }

  async revokeAllForPlayer(playerId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { playerId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
