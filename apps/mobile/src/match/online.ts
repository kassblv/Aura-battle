import { BALANCE, type Choice, type Seat } from '@aura/rules';
import type { RechargeTap } from '@aura/rules';
import type { ServerMessage } from '@aura/protocol';
import type { GameClient } from '../net/client.js';

/** Ce que le serveur dit de l apparence de l adversaire. */
export type OpponentCosmetics = ServerMessage<'match:found'>['opponent']['cosmetics'];

/**
 * Le match en ligne, tel que le client le connait.
 *
 * Le serveur fait autorite : ce module n avance aucune phase, ne calcule aucun
 * score, ne devine aucune echeance. Il accumule ce qui arrive et le traduit
 * dans les unites de l ecran — c est tout, et c est deja la ou les erreurs se
 * logent.
 *
 * La traduction qui compte est celle des echeances. Elles arrivent en heure
 * serveur ; les afficher telles quelles donnerait un compte a rebours faux de
 * tout le decalage d horloge, soit des heures sur un telephone regle a la main.
 */

export type OnlinePhase = 'idle' | 'intro' | 'recharge' | 'choice' | 'reveal' | 'ended';

export interface OnlineOrb {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly kind: 'normal' | 'golden';
  readonly points: number;
  readonly lifetimeMs: number;
}

export interface OnlineMeter {
  readonly period: number;
  readonly zone: number;
  readonly perfect: number;
  readonly center: number;
}

export interface OnlineState {
  readonly matchId: string | null;
  readonly seat: Seat | null;
  readonly opponentName: string | null;
  /**
   * L adversaire est un enregistrement, pas quelqu un en ligne.
   *
   * Le serveur le dit (`match:found.ghost`) et le jeu doit le montrer : une
   * file qui se remplit en faisant croire a un humain absent est un mensonge
   * qui decredibilise tout le reste de ce que l ecran affiche.
   */
  readonly opponentIsGhost: boolean;
  /**
   * L apparence publique de l adversaire : tenue, coiffure, couleur, danse
   * signature. Annoncee a l ouverture, figee pour le match.
   *
   * Ni ses danses par mouvement ni ses effets : ceux-la ne se montrent qu avec
   * le coup joue, dans `round:result`.
   */
  readonly opponentCosmetics: OpponentCosmetics;
  readonly phase: OnlinePhase;
  readonly round: number;
  /** Fin de la phase, **en heure locale**. */
  readonly phaseEndsAtMs: number;
  readonly roundsWon: Readonly<Record<Seat, number>>;
  readonly energy: number;
  readonly ultimate: number;
  /** Seul fait public du choix adverse : il a verrouille. Rien d autre. */
  readonly opponentLocked: boolean;
  readonly orbs: readonly OnlineOrb[];
  /**
   * Taps deja declares au serveur.
   *
   * Gardes ici parce que ce sont eux qui decident des orbes encore affichees :
   * l ecran doit dessiner exactement ce que le serveur jugera, et le serveur
   * ne renvoie rien avant la fin de la recharge.
   */
  readonly sentTaps: readonly RechargeTap[];
  readonly meter: OnlineMeter | null;
  readonly lastRound: ServerMessage<'round:result'> | null;
  readonly result: ServerMessage<'match:end'> | null;
}

export interface OnlineMatch {
  readonly state: OnlineState;
  /** Instants relatifs au debut de la phase de recharge. */
  tap(taps: readonly RechargeTap[]): void;
  /**
   * Verrouille le choix.
   *
   * `chargeAtMs` est l instant ou la jauge s est armee, `tapAtMs` celui de
   * l appui — tous deux relatifs au debut de la phase de choix. Le protocole
   * veut les deux : c est leur ecart qui rend un timing plausible, et un tap
   * qui suivrait l armement de moins de 120 ms ne peut pas etre un geste.
   */
  lock(choice: Choice, chargeAtMs: number, tapAtMs: number | null): void;
  forfeit(): void;
  /**
   * Oublie un match TERMINE, pour que l ecran suivant reparte de rien.
   *
   * Sans effet sur un match en cours : quitter un ecran n est pas abandonner,
   * et l abandon a son propre geste (`forfeit`).
   */
  dismiss(): void;
}

/**
 * Aucune option pour l instant, et surtout pas d horloge.
 *
 * Le pilote ne lit jamais l heure : le serveur donne les echeances, et la seule
 * conversion necessaire passe par l horloge deja tenue par le client.
 */
export type OnlineOptions = Record<string, never>;

/**
 * Aucun match : l etat d avant toute connexion.
 *
 * Exporte parce qu il sert aussi de point de depart aux comparaisons d un
 * consommateur — le son, par exemple, se declenche sur un bord entre deux
 * instantanes et a besoin d un premier terme qui ne sonne rien.
 */
export const EMPTY_ONLINE_STATE: OnlineState = {
  matchId: null,
  seat: null,
  opponentName: null,
  opponentIsGhost: false,
  opponentCosmetics: {},
  phase: 'idle',
  round: 1,
  phaseEndsAtMs: 0,
  roundsWon: { a: 0, b: 0 },
  energy: 0,
  ultimate: 0,
  opponentLocked: false,
  orbs: [],
  sentTaps: [],
  meter: null,
  lastRound: null,
  result: null,
};

export function createOnlineMatch(client: GameClient): OnlineMatch {
  let state: OnlineState = EMPTY_ONLINE_STATE;
  /**
   * Compteur d actions, croissant : il rend les renvois idempotents.
   *
   * Il part de l heure murale, pas de 0. Le serveur retient le dernier `seq`
   * recu pour tout le match et jette ce qui n est pas au-dessus ; or ce
   * compteur est recree a chaque nouveau jeton d acces — rechargement, reprise
   * depuis l arriere-plan, jeton renouvele en pleine partie. Reparti de 0, il
   * faisait refuser en silence tous les taps et le verrouillage restants.
   */
  let seq = Date.now();

  /** Heure serveur vers heure locale. Sans horloge synchronisee, on ne traduit pas. */
  const toLocal = (serverMs: number): number =>
    client.clock.synced ? client.clock.toClientTime(serverMs) : serverMs;

  client.on('match:found', (data) => {
    state = {
      ...EMPTY_ONLINE_STATE,
      matchId: data.matchId,
      seat: data.seat,
      opponentName: data.opponent.displayName,
      opponentIsGhost: data.ghost,
      opponentCosmetics: data.opponent.cosmetics,
    };
  });

  /**
   * L identifiant de match s apprend de **n importe quel** message de match.
   *
   * Le deduire du seul `match:found` suppose qu on l a vu : une reconnexion en
   * pleine recharge livre `recharge:start` sans rien d autre, et le joueur se
   * retrouverait alors incapable de taper — le pilote refusant d envoyer sans
   * identifiant. Chaque message de match porte le sien : autant le prendre.
   */
  const adopt = (matchId: string): void => {
    if (state.matchId !== matchId) state = { ...state, matchId };
  };

  client.on('round:intro', (data) => {
    adopt(data.matchId);
    state = {
      ...state,
      phase: 'intro',
      round: data.round,
      phaseEndsAtMs: toLocal(data.endsAt),
      roundsWon: data.roundsWon,
      energy: data.energy,
      ultimate: data.ult,
      // Une nouvelle manche efface ce qu on savait de la precedente.
      opponentLocked: false,
      orbs: [],
      sentTaps: [],
      meter: null,
      lastRound: null,
    };
  });

  client.on('recharge:start', (data) => {
    adopt(data.matchId);
    state = {
      ...state,
      phase: 'recharge',
      round: data.round,
      phaseEndsAtMs: toLocal(data.endsAt),
      orbs: data.orbs,
      sentTaps: [],
    };
  });

  client.on('choice:start', (data) => {
    adopt(data.matchId);
    state = {
      ...state,
      phase: 'choice',
      round: data.round,
      phaseEndsAtMs: toLocal(data.endsAt),
      meter: data.meter,
      energy: data.energy,
      ultimate: data.ult,
    };
  });

  client.on('opponent:locked', (data) => {
    adopt(data.matchId);
    state = { ...state, opponentLocked: true };
  });

  client.on('round:result', (data) => {
    adopt(data.matchId);
    state = {
      ...state,
      phase: 'reveal',
      /*
        `round:result` ne porte pas d echeance, et la revelation peut partir
        AVANT celle du choix : le serveur revele des que les deux ont verrouille.
        Garder l echeance du choix faisait croire a l ecran que la revelation
        venait de commencer, du debut a la fin — le verdict, qui attend la fin
        du choc, ne s affichait jamais. La duree est la meme regle des deux
        cotes (`@aura/rules`), et l instant de reception est le debut a une
        latence pres : c est une horloge d animation, pas un arbitrage.
      */
      phaseEndsAtMs: client.now() + BALANCE.phases.revealMs,
      round: data.round,
      roundsWon: data.roundsWon,
      lastRound: data,
      opponentLocked: false,
    };
  });

  client.on('match:end', (data) => {
    state = { ...state, phase: 'ended', result: data };
  });

  /**
   * Reprise apres coupure.
   *
   * L instantane ne contient que ce que le destinataire avait deja le droit de
   * voir. On le prend tel quel plutot que de le fusionner avec ce qu on croyait
   * savoir : apres une absence, la memoire du client est la moins fiable des
   * deux sources.
   */
  client.on('match:state', (data) => {
    state = {
      ...EMPTY_ONLINE_STATE,
      matchId: data.matchId,
      seat: data.seat,
      /**
       * Le serveur d'abord, notre memoire ensuite.
       *
       * Apres un rechargement, il n'y a plus de memoire du tout : c'est
       * exactement le cas d'une application mobile tuee en arriere-plan, et le
       * joueur finissait sa partie contre « Adversaire ». Le repli garde le
       * nom quand un annuaire injoignable prive l'instantane du sien.
       */
      opponentName: data.opponent?.displayName ?? state.opponentName,
      // Une reprise ne doit pas faire disparaitre l avertissement.
      opponentIsGhost: state.opponentIsGhost,
      opponentCosmetics: data.opponent?.cosmetics ?? state.opponentCosmetics,
      phase: data.phase,
      round: data.round,
      phaseEndsAtMs: toLocal(data.endsAt),
      roundsWon: data.roundsWon,
      energy: data.energy,
      ultimate: data.ult,
      opponentLocked: data.opponentLocked,
      orbs: data.orbs ?? [],
      // Le serveur retient les taps deja recus : les nôtres sont a oublier,
      // sinon une reconnexion les compterait deux fois a l affichage.
      sentTaps: [],
      meter: data.meter ?? null,
    };
  });

  return {
    get state(): OnlineState {
      return state;
    },

    tap(taps) {
      // Sans match ouvert, il n y a personne a qui parler — et le serveur
      // refuserait un identifiant vide plutot que de l ignorer.
      if (state.matchId === null || taps.length === 0) return;
      client.send('recharge:taps', {
        matchId: state.matchId,
        round: state.round,
        // Le compteur rend les renvois idempotents : apres une coupure, le
        // serveur reconnait un paquet deja vu au lieu de compter deux fois.
        seq: seq++,
        // Le schema exige des instants croissants, et il a raison de ne pas
        // s en remettre a l ordre d arrivee.
        taps: [...taps]
          .sort((left, right) => left.atMs - right.atMs)
          .map((tap) => ({ orbIndex: tap.orbIndex, t: tap.atMs })),
      });
      state = { ...state, sentTaps: [...state.sentTaps, ...taps] };
    },

    lock(choice, chargeAtMs, tapAtMs) {
      if (state.matchId === null) return;
      client.send('choice:lock', {
        matchId: state.matchId,
        round: state.round,
        seq: seq++,
        move: choice.move,
        amp: choice.amplifier,
        ult: choice.useUltimate,
        timing: { chargeAt: chargeAtMs, tapAt: tapAtMs },
      });
    },

    forfeit() {
      if (state.matchId === null) return;
      client.send('match:forfeit', { matchId: state.matchId });
    },

    dismiss() {
      if (state.phase === 'ended') state = EMPTY_ONLINE_STATE;
    },
  };
}
