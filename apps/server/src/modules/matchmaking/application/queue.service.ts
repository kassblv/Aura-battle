import { pairTickets, searchRange, type QueuePair } from '../domain/pairing.js';
import type {
  QueueNotifier,
  QueueTicketStore,
  RatingReader,
  RecentOpponentStore,
} from '../domain/ports.js';
import { DEFAULT_MMR, DEFAULT_REGION, type QueueMode, type QueueTicket } from '../domain/ticket.js';

/**
 * File d'attente et appariement (docs/05, § « File d'attente » ; jalon M5).
 *
 * Ce service orchestre, il ne decide pas : la decision — qui joue contre qui,
 * quelle fenetre a quel instant — appartient a `domain/pairing.ts`, qui est
 * pur. Ici on lit la file, on ecarte les absents, on reclame les paires et on
 * tient les joueurs au courant.
 *
 * Le temps est un **parametre** de chaque methode. Aucun `Date.now()` cache :
 * c'est ce qui permet de verifier l'elargissement de la fenetre a la
 * milliseconde pres, sans attendre quinze secondes par cas.
 */

/** Periode du worker d'appariement (docs/05 : « toutes les 500 ms »). */
export const QUEUE_TICK_MS = 500;

/** Le strict minimum attendu d'un journal, pour ne pas dependre de NestJS ici. */
export interface QueueLog {
  warn(message: string): void;
}

/** Ce qu'un joueur sait de sa propre attente. Rien de l'attente des autres. */
export interface JoinOutcome {
  readonly ticket: QueueTicket;
  /** Vrai si le joueur attendait deja dans ce mode : son anciennete est conservee. */
  readonly resumed: boolean;
}

export class MatchmakingQueue {
  constructor(
    private readonly tickets: QueueTicketStore,
    private readonly recent: RecentOpponentStore,
    private readonly ratings: RatingReader,
    private readonly notifier: QueueNotifier,
    private readonly log: QueueLog | null = null,
  ) {}

  /**
   * Met un joueur en file, ou confirme qu'il y est deja.
   *
   * Renvoyer `queue:join` n'accumule rien : le rangement remplace, et un
   * renvoi dans le **meme mode** ne remet meme pas le compteur d'attente a
   * zero — un client qui reprend apres une coupure ne doit pas y perdre son
   * anciennete, et un client qui insiste ne doit pas y gagner une fenetre
   * eternellement etroite.
   *
   * Changer de mode, en revanche, est une autre recherche : nouveau ticket,
   * nouvelle anciennete.
   */
  async join(playerId: string, mode: QueueMode, nowMs: number): Promise<JoinOutcome> {
    const existing = await this.tickets.get(playerId);

    if (existing !== null && existing.mode === mode) {
      // Le client a peut-etre perdu son ecran de recherche : on le resynchronise.
      this.sendStatus(existing, nowMs);
      return { ticket: existing, resumed: true };
    }

    const ticket: QueueTicket = {
      playerId,
      mode,
      mmr: await this.mmrOf(playerId, nowMs),
      enqueuedAtMs: nowMs,
      region: DEFAULT_REGION,
      recentOpponents: await this.recentOpponentsOf(playerId, nowMs),
    };

    await this.tickets.add(ticket);
    this.sendStatus(ticket, nowMs);
    return { ticket, resumed: false };
  }

  /**
   * Retire un joueur de la file.
   *
   * Appele par `queue:leave`, par la deconnexion et a l'ouverture d'un match.
   * Un ticket qui survit a son joueur fait apparier un absent : l'adversaire
   * obtient un match contre personne, puis un forfait au bout de la periode de
   * grace. C'est le defaut le plus couteux de cette fonctionnalite, et c'est
   * pourquoi il est coupe a trois endroits plutot qu'a un seul.
   */
  async leave(playerId: string): Promise<void> {
    await this.tickets.remove(playerId);
  }

  /** Ce joueur attend-il ? Utilise pour refuser une double mise en file. */
  async isQueued(playerId: string): Promise<boolean> {
    return (await this.tickets.get(playerId)) !== null;
  }

  /**
   * Un tour d'appariement.
   *
   * Rend les paires **reclamees** : leurs tickets ont deja quitte la file, il
   * ne reste plus qu'a ouvrir les matchs.
   *
   * La disponibilite est fournie par l'appelant — le service n'a a savoir ni ce
   * qu'est une socket, ni ce qu'est un match en cours. Est disponible un joueur
   * qui est toujours connecte **et** qui n'est pas deja assis a un duel.
   */
  async tick(
    nowMs: number,
    isAvailable: (playerId: string) => boolean,
  ): Promise<readonly QueuePair[]> {
    const waiting = await this.tickets.listWaiting();

    // Les tickets fantomes partent avant toute decision : apparier un absent
    // reviendrait a offrir un forfait a son adversaire.
    const present: QueueTicket[] = [];
    for (const ticket of waiting) {
      if (isAvailable(ticket.playerId)) {
        present.push(ticket);
      } else {
        await this.tickets.remove(ticket.playerId);
      }
    }

    const outcome = pairTickets(present, nowMs);
    const opened: QueuePair[] = [];

    for (const pair of outcome.pairs) {
      // Entre la lecture et ici, l'un des deux a pu partir. Le rangement
      // tranche : les deux, ou aucun.
      if (!(await this.tickets.claimPair(pair.a.playerId, pair.b.playerId))) continue;
      await this.recent.record(pair.a.playerId, pair.b.playerId, nowMs);
      opened.push(pair);
    }

    for (const ticket of outcome.waiting) {
      this.sendStatus(ticket, nowMs);
    }

    return opened;
  }

  /**
   * Etat de la recherche, tel que le joueur a le droit de le voir.
   *
   * Son mode, son attente, sa fenetre. Ni le MMR de qui que ce soit, ni la
   * taille de la file, ni sa position dedans : l'ecran de recherche n'a besoin
   * de rien d'autre pour tourner, et tout le reste renseignerait un joueur sur
   * ses adversaires (regle d'or n°4).
   */
  private sendStatus(ticket: QueueTicket, nowMs: number): void {
    const elapsedMs = Math.max(0, Math.floor(nowMs - ticket.enqueuedAtMs));
    this.notifier.send(ticket.playerId, 'queue:status', {
      mode: ticket.mode,
      elapsedMs,
      searchRange: searchRange(elapsedMs),
    });
  }

  /**
   * MMR du joueur, ou la valeur de depart.
   *
   * Une base indisponible ne doit pas empecher de jouer : on apparie alors au
   * centre de l'echelle, ce qui est exactement le sort d'un joueur non classe.
   */
  private async mmrOf(playerId: string, nowMs: number): Promise<number> {
    try {
      return (await this.ratings.mmrOf([playerId], nowMs)).get(playerId) ?? DEFAULT_MMR;
    } catch (cause) {
      this.log?.warn(`classement illisible pour ${playerId} : ${String(cause)}`);
      return DEFAULT_MMR;
    }
  }

  /** Rencontres recentes, ou aucune si la memoire est indisponible. */
  private async recentOpponentsOf(playerId: string, nowMs: number): Promise<readonly string[]> {
    try {
      return await this.recent.of(playerId, nowMs);
    } catch (cause) {
      this.log?.warn(`adversaires recents illisibles pour ${playerId} : ${String(cause)}`);
      return [];
    }
  }
}
