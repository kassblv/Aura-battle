import type { AppLog } from '../../../shared/log-port.js';
import type { MatchOpening, QueueClock } from '../domain/ports.js';
import { QUEUE_TICK_MS, type MatchmakingQueue } from './queue.service.js';

/**
 * Worker d'appariement (docs/05 : « toutes les 500 ms »).
 *
 * Il ne decide rien non plus : il donne l'heure au service, lui demande les
 * paires formees, et les fait ouvrir. Tout son interet est de transformer une
 * fonction pure et une file en un service qui tourne.
 *
 * Les methodes `onModuleInit` / `onModuleDestroy` sont reconnues par NestJS
 * sans le moindre decorateur : cette classe reste donc ignorante du cadre, et
 * un test peut la piloter a la main, tour par tour.
 */

/** Modes de file, traduits vers le vocabulaire du match enregistre. */
const MATCH_MODES = { ranked: 'RANKED', casual: 'CASUAL' } as const;

export class QueueWorker {
  private timer: NodeJS.Timeout | null = null;
  /** Un tour en cours. Le suivant passe son tour plutot que de se superposer. */
  private running = false;

  constructor(
    private readonly queue: MatchmakingQueue,
    private readonly opener: MatchOpening,
    private readonly clock: QueueClock,
    /**
     * Un joueur est disponible s'il est connecte et qu'il n'est pas deja assis
     * a un duel. Les deux conditions sont composees par le cablage : le worker
     * ne connait ni les sockets ni les matchs en cours.
     */
    private readonly isAvailable: (playerId: string) => boolean,
    private readonly log: AppLog | null = null,
    private readonly tickMs: number = QUEUE_TICK_MS,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.runOnce(), this.tickMs);
    // Un worker oublie ne doit pas retenir le processus — en test comme a
    // l'arret du serveur.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Un tour : apparier, puis ouvrir.
   *
   * Rien de ce qui peut echouer ici ne doit arreter le worker. Une file
   * injoignable, un match qui refuse de s'ouvrir : on journalise et le tour
   * suivant repart. Un worker mort laisserait tous les joueurs devant un ecran
   * de recherche, sans le moindre message d'erreur.
   */
  async runOnce(nowMs: number = this.clock.now()): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const pairs = await this.queue.tick(nowMs, this.isAvailable);
      let opened = 0;

      for (const pair of pairs) {
        try {
          const matchId = await this.opener.open({
            // Siege `a` au plus ancien : l'ordre n'a aucun effet de jeu, mais
            // il rend les journaux lisibles.
            playerA: pair.a.playerId,
            playerB: pair.b.playerId,
            mode: MATCH_MODES[pair.a.mode],
          });
          if (matchId === null) {
            this.log?.warn(
              `paire ${pair.a.playerId}/${pair.b.playerId} appariee mais match non ouvert`,
            );
            continue;
          }
          opened += 1;
        } catch (cause) {
          this.log?.warn(`ouverture de match impossible : ${String(cause)}`);
        }
      }

      return opened;
    } catch (cause) {
      this.log?.warn(`tour d'appariement abandonne : ${String(cause)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
