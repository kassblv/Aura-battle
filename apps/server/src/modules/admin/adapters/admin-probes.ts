import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import { RedisService } from '../../../shared/redis.js';
import type { AdminProbes, DatabaseSnapshot, QueueSnapshot } from '../domain/ports.js';

/**
 * Les sondes reelles du tableau de bord.
 *
 * Chacune rend `null` quand elle ne sait pas, jamais une valeur inventee : un
 * tableau de bord qui affiche un chiffre faux est pire qu'un tableau qui avoue
 * ne pas savoir — on agit sur le premier, on enquete sur le second.
 */

/**
 * Meme cle que `redis-queue.store.ts`.
 *
 * Recopiee a dessein, et c'est le moindre mal : importer l'adaptateur de file
 * depuis l'administration creerait une dependance du panneau vers le
 * matchmaking pour un seul nom. Le test d'integration ci-contre compare les
 * deux, pour que la copie ne survive pas a un renommage.
 */
export const QUEUE_KEY = 'mm:queue';

/** Ou le cron depose l'horodatage de sa derniere reussite (docs/10). */
const BACKUP_MARKER = '/var/backups/aura/derniere-reussite';

@Injectable()
export class RealAdminProbes implements AdminProbes {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes`.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async database(): Promise<DatabaseSnapshot | null> {
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);

    const [players, matchesTotal, matchesLastDay, rankedPlayers, lastMatch] = await Promise.all([
      this.prisma.player.count(),
      this.prisma.match.count(),
      this.prisma.match.count({ where: { startedAt: { gte: dayAgo } } }),
      this.prisma.rating.count(),
      this.prisma.match.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    ]);

    return {
      players,
      matchesTotal,
      matchesLastDay,
      rankedPlayers,
      lastMatchAt: lastMatch?.startedAt ?? null,
    };
  }

  async queue(): Promise<QueueSnapshot | null> {
    return { waiting: await this.redis.client.zCard(QUEUE_KEY) };
  }

  /**
   * L'horodatage de la derniere sauvegarde reussie.
   *
   * Le fichier vit sur l'HOTE, pas dans l'image : c'est le cron du serveur qui
   * l'ecrit. Il est monte en lecture seule dans le conteneur
   * (`docker-compose.prod.yml`). Absent — en developpement, ou si le montage
   * manque — la sonde rend `null`, et le tableau affiche « jamais » : c'est le
   * pire cas, et c'est le bon affichage puisque rien ne prouve le contraire.
   */
  async lastBackup(): Promise<Date | null> {
    try {
      const raw = (await readFile(BACKUP_MARKER, 'utf8')).trim();
      const at = new Date(raw);
      return Number.isNaN(at.getTime()) ? null : at;
    } catch {
      return null;
    }
  }
}
