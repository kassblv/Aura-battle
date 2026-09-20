import type { AmplifierLevel, Style, Tier, TimingQuality } from '@aura/rules';
import { searchRange } from './pairing.js';
import type { QueueMode, QueueTicket } from './ticket.js';

/**
 * Fantomes : decision pure (docs/05-matchmaking-ranking.md, § « Fantomes »).
 *
 * Deux questions, et rien d'autre : *a cet instant, ce ticket doit-il basculer
 * vers un fantome ?* et *lequel ?* Ni base de donnees, ni horloge, ni socket —
 * le temps est un parametre, comme dans `pairing.ts`, ce qui permet d'eprouver
 * une bascule a vingt-cinq secondes sans attendre vingt-cinq secondes.
 *
 * Ce module ne rejoue rien. Le rejeu est un probleme d'execution, il vit dans
 * `application/ghost-director.ts` ; ici on ne fait que **choisir**.
 */

/**
 * Attente au bout de laquelle la file bascule vers un fantome (docs/05).
 *
 * « Classe : fantome apres 25 s. Partie rapide : fantome apres 12 s. » La
 * partie rapide bascule plus tot parce qu'elle ne classe personne : on y perd
 * moins a jouer contre un enregistrement qu'a regarder un ecran de recherche.
 */
export const GHOST_FALLBACK_MS: Readonly<Record<QueueMode, number>> = Object.freeze({
  ranked: 25_000,
  casual: 12_000,
});

/**
 * Prefixe des identifiants de siege fantome.
 *
 * **Un fantome n'est pas un `playerId`.** Il occupe pourtant un siege, et tout
 * le module match indexe ses sieges par identifiant de joueur : `createMatch`
 * refuse deux sieges identiques, `seatedIn` retrouve un joueur, le notifier
 * adresse ses messages. Lui donner l'identifiant du joueur enregistre serait la
 * pire des solutions — ce joueur deviendrait « occupe » alors qu'il dort, et un
 * second match contre le meme fantome serait refuse.
 *
 * On fabrique donc un identifiant **synthetique et unique par match**, reconnu
 * a son prefixe. Il ne sort jamais : aucun message du protocole ne transporte
 * d'identifiant de joueur, et `MatchSeat.playerId` recoit `null` (docs/04).
 * Le seul endroit ou le joueur d'origine est ecrit est `MatchSeat.ghostOfId`.
 */
export const GHOST_SEAT_PREFIX = 'ghost:';

/**
 * Nom montre a la place de celui du joueur enregistre.
 *
 * **On ne donne pas le nom de quelqu'un qui n'est pas la.** Le drapeau `ghost`
 * dit deja la verite et le client affichera « Adversaire en differe » (docs/05),
 * mais un nom reel en face de ce badge laisserait croire que cette personne-la
 * vient de se connecter — et un badge discret se rate. Un nom neutre ne peut
 * pas etre confondu, et il ne revele pas non plus a un joueur qui l'a affronte
 * en differe.
 */
export const GHOST_DISPLAY_NAME = 'Aura en differe';

/** Identifiant de siege pour ce rejeu. `nonce` le rend unique par match. */
export function ghostSeatId(recordingId: string, nonce: string): string {
  return `${GHOST_SEAT_PREFIX}${recordingId}:${nonce}`;
}

/** Vrai si ce siege est tenu par un rejeu et non par une personne. */
export function isGhostSeatId(playerId: string): boolean {
  return playerId.startsWith(GHOST_SEAT_PREFIX);
}

/**
 * Une manche enregistree.
 *
 * Exactement ce que `round:result` a deja rendu public des deux sieges. Le
 * rejeu ne transporte donc aucune information que le match d'origine n'avait
 * pas revelee — et surtout pas la graine, les orbes ni les instants de tap :
 * un fantome rejoue sur **une autre** sequence et une autre jauge, seul son
 * niveau de jeu se transporte.
 */
export interface GhostRound {
  readonly move: { readonly style: Style; readonly tier: Tier };
  readonly amplifier: AmplifierLevel;
  readonly useUltimate: boolean;
  /** Qualite et ecart au centre de la jauge, tels que le moteur les a juges. */
  readonly timing: { readonly quality: TimingQuality; readonly delta: number };
  /** Points marques a la recharge — le « profil de recharge » de docs/05. */
  readonly rechargePoints: number;
  /** Taps envoyes pendant la recharge : la seule valeur qui se rejoue telle quelle. */
  readonly rechargeTaps: number;
}

/** Un match enregistre, du point de vue d'un seul joueur. */
export interface GhostRecording {
  readonly id: string;
  /** Joueur dont ce jeu provient. Sert a ne jamais l'opposer a lui-meme. */
  readonly playerId: string;
  readonly mmr: number;
  /**
   * Version du moteur au moment de l'enregistrement.
   *
   * Un enregistrement d'une autre version a pu etre produit sous d'autres
   * couts, d'autres paliers, d'autres gains de jauge : le rejouer tel quel
   * donnerait un adversaire absurde, trop faible ou trop fort. docs/05 exige
   * « de meme `rulesVersion` », et c'est une egalite, pas une preference.
   */
  readonly rulesVersion: string;
  readonly rounds: readonly GhostRound[];
}

/**
 * Ce ticket a-t-il assez attendu pour meriter un fantome ?
 *
 * L'attente compte depuis l'entree en file, pas depuis la derniere
 * reconnexion : un joueur qui passe sous un tunnel a l'ecran de recherche ne
 * doit pas voir son compteur revenir a zero (meme anciennete que
 * `MatchmakingQueue.resume`).
 */
export function shouldFallBackToGhost(
  ticket: QueueTicket,
  nowMs: number,
  /**
   * Delais applicables. Injectables pour la seule raison qui vaille : un test
   * de bout en bout ne peut pas attendre vingt-cinq secondes reelles par
   * scenario. Les valeurs du document restent celles par defaut, et elles sont
   * verifiees telles quelles dans `ghost.test.ts`.
   */
  fallbackMs: Readonly<Record<QueueMode, number>> = GHOST_FALLBACK_MS,
): boolean {
  return nowMs - ticket.enqueuedAtMs >= fallbackMs[ticket.mode];
}

/**
 * Choisit l'enregistrement a opposer a ce ticket, ou `null`.
 *
 * Quatre refus, dans l'ordre ou ils comptent :
 *
 * - **version differente** : docs/05 l'exige, et un enregistrement d'une autre
 *   version de regles rejouerait des choix payes a d'autres prix ;
 * - **soi-meme** : s'affronter soi-meme n'apprend rien, et le joueur
 *   reconnaitrait ses propres manches ;
 * - **aucune manche** : un enregistrement vide ne rejoue rien, le fantome
 *   subirait trois manches d'actions par defaut. Ce serait une victoire
 *   offerte, donc des LP offerts ;
 * - **hors fenetre** : la meme fenetre que l'appariement humain
 *   (`searchRange`), et elle s'elargit de la meme facon. Un fantome n'est pas
 *   une raison d'accepter un ecart de niveau qu'on refuserait a un humain — et
 *   comme la fenetre s'ouvre avec l'attente, un joueur isole finit toujours par
 *   trouver, sans qu'on ait a inventer un second bareme.
 *
 * Parmi ce qui reste, on preferera un adversaire pas rencontre recemment, puis
 * le MMR le plus proche, puis l'identifiant — exactement la politique de
 * `pairTickets`. Une rencontre recente n'est pas interdite, seulement reportee :
 * refuser le seul enregistrement disponible ramenerait la file vide qu'on
 * cherche precisement a supprimer.
 */
export function selectGhost(
  candidates: readonly GhostRecording[],
  ticket: QueueTicket,
  nowMs: number,
  rulesVersion: string,
): GhostRecording | null {
  const range = searchRange(nowMs - ticket.enqueuedAtMs);

  const eligible = candidates.filter(
    (candidate) =>
      candidate.rulesVersion === rulesVersion &&
      candidate.playerId !== ticket.playerId &&
      candidate.rounds.length > 0 &&
      Math.abs(candidate.mmr - ticket.mmr) <= range,
  );

  let best: { recording: GhostRecording; gap: number; recent: boolean } | null = null;
  for (const recording of eligible) {
    const gap = Math.abs(recording.mmr - ticket.mmr);
    const recent = ticket.recentOpponents.includes(recording.playerId);
    const better =
      best === null ||
      (!recent && best.recent) ||
      (recent === best.recent &&
        (gap < best.gap || (gap === best.gap && recording.id < best.recording.id)));
    if (better) best = { recording, gap, recent };
  }

  return best?.recording ?? null;
}
