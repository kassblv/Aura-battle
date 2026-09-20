import { describeCause } from '../../../shared/describe-cause.js';
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

/**
 * Duree pendant laquelle le ticket d'un joueur deconnecte lui est garde.
 *
 * **La meme grace que pour un match en cours**, et pour la meme raison :
 * `docs/03` accorde 45 s pour revenir avec le meme jeton, et demande au client
 * de *fermer proprement sa socket* quand l'application passe en arriere-plan.
 * Une file plus severe que cela punirait le comportement que le protocole
 * prescrit — un passage sous un tunnel, un appel recu, et la place est perdue
 * sans que rien ne le dise au joueur.
 *
 * Ce n'est pas un ticket qui continue de chercher : il est **gare**, hors de la
 * file (voir `park`). L'invariant « on n'apparie jamais un absent » tient donc
 * pendant toute la grace.
 */
export const QUEUE_PARKING_MS = 45_000;

/**
 * Duree pendant laquelle une annulation de recherche reste opposable.
 *
 * Elle n'a besoin de couvrir qu'un intervalle : entre la reclamation des
 * tickets d'une paire et l'echec d'ouverture qui suit, au sein d'un meme tour
 * de worker. Une minute est absurdement large pour cela, et c'est voulu — la
 * borne doit survivre a un tour anormalement lent, faute de quoi le defaut
 * qu'elle ferme reapparait precisement le jour ou le serveur va mal.
 *
 * Le cout est nul : la memoire tient **une entree par joueur**, pas une par
 * message, et un `queue:join` l'efface.
 */
export const QUEUE_CANCELLATION_MEMORY_MS = 60_000;

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

/** Un ticket mis de cote le temps que son joueur revienne. */
interface ParkedTicket {
  readonly ticket: QueueTicket;
  readonly expiresAtMs: number;
}

export class MatchmakingQueue {
  /**
   * Tickets gares, par joueur. **En memoire de processus, et c'est correct** :
   * un ticket appartient deja a l'instance qui l'a ecrit — elle seule peut
   * joindre son joueur, puisque le registre des sockets est local au
   * processus. Le garer ailleurs ne le rendrait pas plus joignable.
   */
  private readonly parked = new Map<string, ParkedTicket>();

  /**
   * Annulations recentes, par joueur : l'instant du `queue:leave`.
   *
   * Une entree par joueur, jamais par message — un client qui envoie cent
   * annulations en occupe une. Balayee a chaque tour (voir
   * `QUEUE_CANCELLATION_MEMORY_MS`).
   */
  private readonly cancelled = new Map<string, number>();

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
   *
   * Un ticket **gare** par une coupure compte comme un ticket existant : un
   * client qui redemande sa recherche en revenant reprend exactement ou il en
   * etait. Dans tous les cas la place de garage est liberee ici — apres un
   * `join`, la file est la seule verite sur ce joueur.
   */
  async join(playerId: string, mode: QueueMode, nowMs: number): Promise<JoinOutcome> {
    // Chercher un duel dit le contraire de l'avoir annule : ce qui suit ne doit
    // plus etre retenu contre lui.
    this.cancelled.delete(playerId);

    const parked = this.takeParked(playerId, nowMs);
    const stored = await this.tickets.get(playerId);
    const existing = stored ?? parked;

    if (existing !== null && existing.mode === mode) {
      // Le ticket gare pendant la coupure retourne en file ; celui qui n'en est
      // jamais sorti n'a pas besoin d'etre reecrit, et un joueur qui insiste ne
      // doit pas se payer une ecriture par message.
      if (stored === null) await this.tickets.add(existing);
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
   * Appele a l'ouverture d'un match — et par `cancel`, qui est le chemin du
   * joueur. Un ticket qui survit a son joueur fait apparier un absent :
   * l'adversaire obtient un match contre personne, puis un forfait au bout de
   * la periode de grace. C'est le defaut le plus couteux de cette
   * fonctionnalite, et c'est pourquoi il est coupe a trois endroits plutot
   * qu'a un seul.
   *
   * **Un retrait n'est pas une annulation.** Sortir de la file parce qu'un
   * match s'ouvre ne dit rien de ce que le joueur veut faire ensuite ; c'est
   * `cancel` qui porte cette intention, et elle seule.
   */
  async leave(playerId: string): Promise<void> {
    // Une sortie volontaire est definitive : garder la place de garage ferait
    // reprendre, a la prochaine reconnexion, une recherche deja annulee.
    this.parked.delete(playerId);
    await this.tickets.remove(playerId);
  }

  /**
   * Le joueur annule sa recherche (`queue:leave`).
   *
   * Retire le ticket, **et retient l'annulation** — c'est la seule partie qui
   * demande une explication.
   *
   * Un tour d'appariement reclame les deux tickets d'une paire avant de tenter
   * d'ouvrir le match. Entre les deux, le joueur peut annuler : son ticket a
   * deja quitte la file, donc `leave` ne trouve rien a retirer et ne laisse
   * aucune trace. Si l'ouverture echoue ensuite, `requeue` le voit disponible
   * et sans ticket — et le remet a chercher un duel qu'il vient d'annuler.
   *
   * Ce n'est pas un `queue:status` parasite : il redevient **appariable**. Au
   * tour suivant il recoit un `match:found` alors que son client a quitte
   * l'ecran de recherche, ne joue pas, et perd la partie par actions par
   * defaut. En classe, c'est une defaite au classement sur une recherche
   * annulee — une perte de MMR sans consentement, exactement ce que `docs/06`
   * surveille dans l'autre sens.
   *
   * L'annulation est inscrite **avant** la moindre attente : c'est ce qui
   * garantit qu'un `requeue` parti entre-temps la voie deja.
   */
  async cancel(playerId: string, nowMs: number): Promise<void> {
    this.cancelled.set(playerId, nowMs);
    await this.leave(playerId);
  }

  /**
   * Met le ticket de cote pendant que son joueur est absent.
   *
   * Le ticket **sort de la file** : tant qu'il est gare, aucun tour
   * d'appariement ne le voit, donc personne ne recoit un `match:found` contre
   * un absent. Mais il n'est pas detruit, parce qu'une socket perdue n'est pas
   * une recherche annulee (voir `QUEUE_PARKING_MS`).
   */
  async park(playerId: string, nowMs: number): Promise<void> {
    const ticket = await this.tickets.get(playerId);
    if (ticket === null) return;

    await this.tickets.remove(playerId);
    this.parked.set(playerId, { ticket, expiresAtMs: nowMs + QUEUE_PARKING_MS });
  }

  /**
   * Remet en file le ticket d'un joueur qui revient, et le lui annonce.
   *
   * Rend `false` s'il n'y a rien a reprendre : jamais entre en file, sorti
   * volontairement, ou revenu trop tard. Le joueur reste alors libre d'envoyer
   * un `queue:join` — c'est le meme resultat que s'il n'avait jamais attendu.
   *
   * L'anciennete est celle du **premier** `queue:join` : le temps passe hors
   * ligne compte dans l'attente, comme il compte pour un match en cours.
   */
  async resume(playerId: string, nowMs: number): Promise<boolean> {
    const ticket = this.takeParked(playerId, nowMs);
    if (ticket === null) return false;

    await this.tickets.add(ticket);
    this.sendStatus(ticket, nowMs);
    return true;
  }

  /**
   * Remet en file un ticket deja reclame pour un match qui ne s'est pas ouvert.
   *
   * `tick` retire les deux tickets d'une paire **avant** qu'on tente de l'ouvrir
   * — il le faut, sinon le tour suivant rapparierait les memes joueurs. Quand
   * l'ouverture echoue malgre tout (un siege pris entre-temps par une
   * invitation, par exemple), les deux se retrouvent hors de la file et sans
   * match : personne ne les apparie plus, leur compte a rebours continue de
   * tourner, et rien ne le leur dit. C'est le chemin de retour.
   *
   * **L'anciennete est conservee telle quelle** : le joueur remis en file n'a
   * rien fait de mal, c'est son adversaire pressenti qui s'est assis ailleurs.
   * Le renvoyer au bout de la queue lui couterait la fenetre de recherche qu'il
   * avait patiemment elargie.
   */
  async requeue(ticket: QueueTicket, nowMs: number): Promise<void> {
    /**
     * Une annulation ne se rattrape pas.
     *
     * Le joueur a pu envoyer `queue:leave` apres la reclamation de son ticket :
     * il n'y avait alors plus rien a retirer, donc rien ne s'y opposerait ici.
     * Le remettre en file le rendrait a nouveau appariable — et son client,
     * qui a quitte l'ecran de recherche, encaisserait le `match:found` suivant
     * sans le jouer (voir `cancel`).
     *
     * La presence de l'annulation suffit a trancher : elle est effacee des que
     * le joueur redemande une recherche, et balayee sinon. Comparer deux
     * instants supposerait que l'appelant sache dater sa reclamation ; ne rien
     * supposer est plus sur, et ferme aussi la variante ou il se trompe.
     */
    if (this.cancelled.has(ticket.playerId)) return;

    // Un ticket plus recent gagne : le joueur a pu redemander une recherche,
    // dans un autre mode, pendant que l'ouverture echouait.
    if ((await this.tickets.get(ticket.playerId)) !== null) return;

    await this.tickets.add(ticket);
    this.sendStatus(ticket, nowMs);
  }

  /**
   * Reprend une place de garage, et la libere dans tous les cas.
   *
   * Rendre le ticket **et** l'oublier est ce qui garantit qu'un ticket gare ne
   * peut pas se retrouver a la fois en file et au garage.
   */
  private takeParked(playerId: string, nowMs: number): QueueTicket | null {
    const parked = this.parked.get(playerId);
    this.parked.delete(playerId);
    return parked === undefined || parked.expiresAtMs <= nowMs ? null : parked.ticket;
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
    // Les tickets de ceux qui ne sont jamais revenus s'effacent ici : sans ce
    // balayage, le garage grossirait a proportion des coupures reseau.
    for (const [playerId, parked] of this.parked) {
      if (parked.expiresAtMs <= nowMs) this.parked.delete(playerId);
    }

    // Meme balayage pour les annulations : elles n'ont a vivre que le temps
    // d'un tour, et ce tour-ci est deja le suivant.
    for (const [playerId, cancelledAtMs] of this.cancelled) {
      if (cancelledAtMs + QUEUE_CANCELLATION_MEMORY_MS <= nowMs) this.cancelled.delete(playerId);
    }

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
      this.log?.warn(`classement illisible pour ${playerId} : ${describeCause(cause)}`);
      return DEFAULT_MMR;
    }
  }

  /** Rencontres recentes, ou aucune si la memoire est indisponible. */
  private async recentOpponentsOf(playerId: string, nowMs: number): Promise<readonly string[]> {
    try {
      return await this.recent.of(playerId, nowMs);
    } catch (cause) {
      this.log?.warn(`adversaires recents illisibles pour ${playerId} : ${describeCause(cause)}`);
      return [];
    }
  }
}
