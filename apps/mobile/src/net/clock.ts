/**
 * Horloge synchronisee sur le serveur.
 *
 * `CLAUDE.md` en fait une regle : on ne compare jamais une heure client a une
 * heure serveur sans l offset mesure par `ping`/`pong`. La raison n est pas
 * cosmetique — le serveur juge la plausibilite des instants declares a 400 ms
 * pres (docs/06), et l horloge d un telephone reglee a la main peut etre a des
 * heures de la verite. Un tap date avec un mauvais offset arrive comme une
 * declaration invraisemblable, et c est le joueur qui recolte le soupcon.
 *
 * La mesure est celle d un aller-retour : le serveur repond `serverTime`, et si
 * le trajet etait symetrique, cet instant correspond au milieu de l aller-
 * retour cote client. L ecart entre les deux est l offset.
 */

/**
 * Nombre de mesures conservees.
 *
 * Une fenetre glissante, pas un record absolu : un unique aller-retour chanceux
 * au demarrage figerait l offset pour toute la partie, et l horloge cesserait
 * de suivre la derive de l appareil.
 */
export const SYNC_WINDOW = 8;

export interface ClockSample {
  /** Instant d envoi du `ping`, sur l horloge locale. */
  readonly sentAtMs: number;
  /** `serverTime` du `pong`. */
  readonly serverTimeMs: number;
  /** Instant de reception du `pong`, sur l horloge locale. */
  readonly receivedAtMs: number;
}

export interface SyncedClock {
  readonly synced: boolean;
  /** A ajouter a une heure locale pour obtenir l heure serveur. `null` avant mesure. */
  readonly offsetMs: number | null;
  /** Aller-retour de la mesure retenue, en millisecondes. */
  readonly roundTripMs: number | null;
  readonly sampleCount: number;
  observe(sample: ClockSample): void;
  toServerTime(clientMs: number): number;
  toClientTime(serverMs: number): number;
}

interface Measure {
  readonly offsetMs: number;
  readonly roundTripMs: number;
}

const isFinitePositive = (value: number): boolean => Number.isFinite(value);

export function createSyncedClock(): SyncedClock {
  const window: Measure[] = [];

  /**
   * La meilleure mesure est la plus rapide, pas la plus recente.
   *
   * Un trajet long a forcement ete retarde d un cote ou de l autre, et rien ne
   * dit lequel : son estimation est donc la moins fiable. Le trajet le plus
   * court est celui qui a le moins de place pour mentir.
   */
  const best = (): Measure | null =>
    window.reduce<Measure | null>(
      (fastest, measure) =>
        fastest === null || measure.roundTripMs < fastest.roundTripMs ? measure : fastest,
      null,
    );

  const requireOffset = (): number => {
    const measure = best();
    if (measure === null) {
      throw new Error("horloge non synchronisee : aucun aller-retour n'a abouti");
    }
    return measure.offsetMs;
  };

  return {
    get synced(): boolean {
      return window.length > 0;
    },

    get offsetMs(): number | null {
      return best()?.offsetMs ?? null;
    },

    get roundTripMs(): number | null {
      return best()?.roundTripMs ?? null;
    },

    get sampleCount(): number {
      return window.length;
    },

    observe(sample) {
      const { sentAtMs, serverTimeMs, receivedAtMs } = sample;
      if (![sentAtMs, serverTimeMs, receivedAtMs].every(isFinitePositive)) return;

      const roundTripMs = receivedAtMs - sentAtMs;
      // Une reponse arrivee avant sa question ne decrit aucun trajet possible :
      // l horloge locale a saute pendant la mesure.
      if (roundTripMs < 0) return;

      window.push({ roundTripMs, offsetMs: serverTimeMs - (sentAtMs + receivedAtMs) / 2 });
      if (window.length > SYNC_WINDOW) window.shift();
    },

    toServerTime(clientMs) {
      return clientMs + requireOffset();
    },

    toClientTime(serverMs) {
      return serverMs - requireOffset();
    },
  };
}

/**
 * L'heure serveur estimee, en millisecondes depuis l'epoque.
 *
 * `perfNowMs` est l'horloge locale de la mesure (`performance.now()`), et
 * `wallNowMs` l'horloge murale (`Date.now()`), seul repli tant qu'aucun
 * aller-retour n'a abouti. Pour une ANNONCE (l'evenement de la semaine), jamais
 * pour un instant de jeu : ceux-la restent relatifs au debut de phase.
 */
export function estimatedServerNow(
  clock: SyncedClock | null,
  perfNowMs: number,
  wallNowMs: number,
): number {
  return clock?.synced === true ? clock.toServerTime(perfNowMs) : wallNowMs;
}
