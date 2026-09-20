import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type { QueuePair } from '../domain/pairing.js';
import type { MatchOpening, PlayerAvailability, QueueClock } from '../domain/ports.js';
import type { QueueTicket } from '../domain/ticket.js';
import type { GhostFallbackService } from './ghost-fallback.service.js';
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
     * Connecte ? Deja en duel ? **Deux questions, pas une.** Le cablage les
     * branche sur le registre des sockets et sur l'index des matchs en cours ;
     * le worker ne connait ni l'un ni l'autre. Les confondre en un seul
     * booleen reviendrait a reserver le meme sort a un joueur qui revient dans
     * dix secondes et a un joueur qui est en train de jouer ailleurs.
     */
    private readonly availability: PlayerAvailability,
    private readonly log: AppLog | null = null,
    private readonly tickMs: number = QUEUE_TICK_MS,
    /**
     * Bascule vers un fantome (docs/05). Absente, la file se contente des
     * humains — c'est ce qu'elle faisait avant ce jalon, et un serveur sans
     * reserve d'enregistrements marche exactement pareil.
     */
    private readonly ghosts: GhostFallbackService | null = null,
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
      const { pairs, waiting } = await this.queue.tick(nowMs, this.availability);
      let opened = 0;

      for (const pair of pairs) {
        let matchId: string | null = null;
        try {
          // Ouverture **synchrone** : rien ne peut s'intercaler entre deux
          // paires d'un meme tour, ni entre le controle et la reservation.
          matchId = this.opener.open({
            // Siege `a` au plus ancien : l'ordre n'a aucun effet de jeu, mais
            // il rend les journaux lisibles.
            playerA: pair.a.playerId,
            playerB: pair.b.playerId,
            mode: MATCH_MODES[pair.a.mode],
          });
        } catch (cause) {
          this.log?.warn(`ouverture de match impossible : ${describeCause(cause)}`);
        }

        if (matchId !== null) {
          opened += 1;
          continue;
        }

        this.log?.warn(
          `paire ${pair.a.playerId}/${pair.b.playerId} appariee mais match non ouvert : retour en file`,
        );
        await this.requeue(pair, nowMs);
      }

      return opened + (await this.openGhosts(waiting, nowMs));
    } catch (cause) {
      this.log?.warn(`tour d'appariement abandonne : ${describeCause(cause)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Remet en file une paire dont le match ne s'est pas ouvert.
   *
   * **C'est ici, et pas dans l'ouverture, que le retour en file se fait.** Le
   * tour a reclame les deux tickets avant de tenter d'ouvrir : lui seul les a
   * encore en main, avec leur anciennete. Et `open` est synchrone par
   * contrainte — une attente entre le controle des sieges et leur reservation
   * suffit a asseoir un joueur a deux matchs — donc il ne peut de toute facon
   * pas ecrire dans la file.
   *
   * Trois sorts, parce qu'il y a trois situations — et c'est exactement ce
   * qu'un booleen « disponible » ne permettait pas de dire :
   *
   * - **assis ailleurs** : rien a lui rendre, c'est lui qui a fait echouer
   *   l'ouverture et il joue deja ;
   * - **parti** : son ticket est gare, il garde sa place le temps de revenir.
   *   Sans cela il ne serait ni en file ni au garage — le `park` de la
   *   passerelle est deja passe, et il n'a rien trouve a garer puisque le
   *   ticket etait reclame ;
   * - **la, et libre** : il retourne en file, anciennete intacte.
   */
  private async requeue(pair: QueuePair, nowMs: number): Promise<void> {
    for (const ticket of [pair.a, pair.b]) {
      await this.restore(ticket, nowMs);
    }
  }

  /** Rend son ticket a un joueur, selon lequel des trois cas le concerne. */
  private async restore(ticket: QueueTicket, nowMs: number): Promise<void> {
    if (this.availability.isBusy(ticket.playerId)) return;
    try {
      if (this.availability.isConnected(ticket.playerId)) {
        await this.queue.requeue(ticket, nowMs);
      } else {
        await this.queue.parkClaimed(ticket, nowMs);
      }
    } catch (cause) {
      // Au mieux : un retour en file rate laisse un joueur devant un ecran
      // de recherche muet, mais ne doit pas emporter le tour suivant.
      this.log?.warn(`retour en file impossible pour ${ticket.playerId} : ${describeCause(cause)}`);
    }
  }

  /**
   * Offre un fantome a ceux qui attendent depuis trop longtemps (docs/05).
   *
   * **Apres l'appariement humain, jamais avant** : un adversaire present vaut
   * toujours mieux qu'un enregistrement, et basculer d'abord priverait deux
   * joueurs d'un vrai duel au profit de deux rejeux.
   *
   * L'echec d'une bascule ne touche que son propre ticket. C'est aussi
   * pourquoi le retour en file passe par `restore` et pas par une seconde
   * politique : les trois sorts — assis ailleurs, parti, la et libre — sont les
   * memes que pour une paire dont le match ne s'est pas ouvert.
   */
  private async openGhosts(waiting: readonly QueueTicket[], nowMs: number): Promise<number> {
    if (this.ghosts === null) return 0;

    let opened = 0;
    for (const ticket of waiting) {
      let result;
      try {
        result = await this.ghosts.tryOpen(ticket, nowMs);
      } catch (cause) {
        // Le ticket est reste en file : `tryOpen` ne le reclame qu'une fois
        // tout ce qui peut echouer derriere lui deja fait.
        this.log?.warn(
          `bascule vers un fantome impossible pour ${ticket.playerId} : ${describeCause(cause)}`,
        );
        continue;
      }

      if (result === 'opened') opened += 1;
      if (result === 'failed') await this.restore(ticket, nowMs);
    }
    return opened;
  }
}
