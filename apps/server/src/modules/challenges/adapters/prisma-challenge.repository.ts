import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { ChallengeRepository } from '../domain/ports.js';
import type { StoredProgress } from '../domain/progress.js';

@Injectable()
export class PrismaChallengeRepository implements ChallengeRepository {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir auth.controller.ts).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async read(playerId: string, day: number): Promise<readonly StoredProgress[]> {
    const rows = await this.prisma.playerChallenge.findMany({
      where: { playerId, day },
      select: { challengeId: true, progress: true, claimedAt: true },
    });
    return rows.map((row) => ({
      challengeId: row.challengeId,
      progress: row.progress,
      claimed: row.claimedAt !== null,
    }));
  }

  /**
   * Un `upsert` par defi, dans UNE transaction.
   *
   * L'upsert plutot qu'une lecture suivie d'une ecriture : c'est la cle
   * primaire `(playerId, day, challengeId)` qui rend deux parties terminees au
   * meme instant incapables de creer deux lignes pour le meme defi.
   *
   * La transaction plutot que trois appels : trois defis avancent ensemble ou
   * pas du tout. Une coupure au milieu laisserait un joueur avec un defi
   * credite et deux perdus, sans rien pour le dire.
   */
  async write(
    playerId: string,
    day: number,
    entries: readonly { readonly challengeId: string; readonly progress: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.playerChallenge.upsert({
          where: { playerId_day_challengeId: { playerId, day, challengeId: entry.challengeId } },
          create: { playerId, day, challengeId: entry.challengeId, progress: entry.progress },
          update: { progress: entry.progress },
        }),
      ),
    );
  }

  /**
   * Marque encaisse **et** credite, en une transaction.
   *
   * `updateMany` conditionne sur `claimedAt: null`, et c'est cette condition
   * qui tranche la course : entre la lecture du service et cette ecriture, un
   * second onglet a le temps de passer. Une lecture suivie d'un `update`
   * paierait deux fois, et rien dans les journaux ne le dirait.
   *
   * Le marquage vient AVANT le credit, a l'inverse de l'achat : ici c'est le
   * paiement en double qu'on redoute, pas l'absence de paiement. Un defi
   * marque sans credit se voit et se corrige ; un credit double ne se
   * remarque jamais.
   */
  async claim(
    playerId: string,
    day: number,
    challengeId: string,
    reward: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const marked = await tx.playerChallenge.updateMany({
        where: { playerId, day, challengeId, claimedAt: null },
        data: { claimedAt: new Date() },
      });
      if (marked.count === 0) return false;

      await tx.player.update({
        where: { id: playerId },
        data: { softCurrency: { increment: reward } },
      });
      return true;
    });
  }
}
