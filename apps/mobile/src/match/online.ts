import type { Choice, Seat } from '@aura/rules';
import type { RechargeTap } from '@aura/rules';
import type { ServerMessage } from '@aura/protocol';
import type { GameClient } from '../net/client.js';

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
}

/**
 * Aucune option pour l instant, et surtout pas d horloge.
 *
 * Le pilote ne lit jamais l heure : le serveur donne les echeances, et la seule
 * conversion necessaire passe par l horloge deja tenue par le client.
 */
export type OnlineOptions = Record<string, never>;

const EMPTY: OnlineState = {
  matchId: null,
  seat: null,
  opponentName: null,
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
  let state: OnlineState = EMPTY;
  /** Compteur d actions, croissant : il rend les renvois idempotents. */
  let seq = 0;

  /** Heure serveur vers heure locale. Sans horloge synchronisee, on ne traduit pas. */
  const toLocal = (serverMs: number): number =>
    client.clock.synced ? client.clock.toClientTime(serverMs) : serverMs;

  client.on('match:found', (data) => {
    state = {
      ...EMPTY,
      matchId: data.matchId,
      seat: data.seat,
      opponentName: data.opponent.displayName,
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
      ...EMPTY,
      matchId: data.matchId,
      seat: data.seat,
      opponentName: state.opponentName,
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
  };
}
