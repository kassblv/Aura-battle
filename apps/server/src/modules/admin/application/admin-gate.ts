import { constantTimeEquals } from '../../../shared/constant-time.js';

/** Essais de secret rates tolérés par adresse et par fenetre (ADR 0018). */
export const ADMIN_FAILURE_LIMIT = 10;
export const ADMIN_FAILURE_WINDOW_MS = 60_000;
/** Adresses suivies au plus : au-dela, on oublie les fenetres echues, puis les plus anciennes. */
const MAX_TRACKED = 10_000;

const BEARER = 'Bearer ';
/** Cle commune aux requetes sans adresse : un compteur partage vaut mieux qu'aucun. */
const UNKNOWN_ADDRESS = '?';

/**
 * `OK` : le secret est bon. `DISABLED` : aucun secret configure, le panneau
 * n'existe pas (404). `UNAUTHORIZED` : mauvais secret (401). `RATE_LIMITED` :
 * trop d'essais rates depuis cette adresse (429).
 */
export type AdminVerdict = 'OK' | 'DISABLED' | 'UNAUTHORIZED' | 'RATE_LIMITED';

/**
 * La porte du panneau d'administration (docs/10, ADR 0018).
 *
 * Trois regles, dans cet ordre :
 *
 * 1. **Sans `ADMIN_TOKEN`, rien n'existe** — pas meme un refus. Annoncer
 *    « interdit » dirait a qui cherche qu'il y a quelque chose a chercher.
 * 2. **Une adresse qui a rate dix fois dans la minute est refusee**, meme si
 *    elle presente ensuite le bon secret : sinon la limite ne limiterait rien.
 *    Seuls les ECHECS comptent — le panneau relit l'etat toutes les quinze
 *    secondes, et ses appels reussis ne doivent pas l'enfermer dehors.
 * 3. **Comparaison a temps constant** : une egalite de chaines qui sort au
 *    premier octet different laisse deviner le secret octet par octet.
 *
 * En memoire du processus, comme les autres limites par cle (ADR 0012 : un
 * seul conteneur). Le secret fait trente-deux caracteres au moins : la limite
 * n'est pas ce qui le protege d'une recherche exhaustive, elle coupe court au
 * bruit et rend une attaque visible.
 */
export class AdminGate {
  private readonly token: () => string;
  private readonly now: () => number;
  /** Par adresse : debut de la fenetre en cours et echecs dans cette fenetre. */
  private readonly failures = new Map<string, { startMs: number; count: number }>();

  constructor(deps: { token: () => string; now: () => number }) {
    this.token = deps.token;
    this.now = deps.now;
  }

  /** Nombre d'adresses suivies, pour verifier que la memoire reste bornee. */
  get trackedAddresses(): number {
    return this.failures.size;
  }

  check(authorization: string | undefined, ip: string | undefined): AdminVerdict {
    const secret = this.token();
    if (secret === '') return 'DISABLED';

    const key = ip === undefined || ip === '' ? UNKNOWN_ADDRESS : ip;
    const nowMs = this.now();
    const entry = this.windowOf(key, nowMs);
    if (entry !== null && entry.count >= ADMIN_FAILURE_LIMIT) return 'RATE_LIMITED';

    const offered =
      authorization?.startsWith(BEARER) === true ? authorization.slice(BEARER.length) : '';
    if (constantTimeEquals(offered, secret)) return 'OK';

    this.recordFailure(key, entry, nowMs);
    return 'UNAUTHORIZED';
  }

  /** La fenetre en cours de cette adresse, ou `null` si elle est echue ou absente. */
  private windowOf(key: string, nowMs: number): { startMs: number; count: number } | null {
    const entry = this.failures.get(key);
    if (entry === undefined) return null;
    // Une horloge qui recule ne prolonge pas une fenetre : elle la clot.
    if (nowMs - entry.startMs >= ADMIN_FAILURE_WINDOW_MS || nowMs < entry.startMs) {
      this.failures.delete(key);
      return null;
    }
    return entry;
  }

  private recordFailure(
    key: string,
    entry: { startMs: number; count: number } | null,
    nowMs: number,
  ): void {
    if (entry !== null) {
      entry.count += 1;
      return;
    }
    if (this.failures.size >= MAX_TRACKED) this.sweep(nowMs);
    this.failures.set(key, { startMs: nowMs, count: 1 });
  }

  /**
   * Oublie les fenetres echues, puis les plus anciennes jusqu'a neuf dixiemes
   * de la borne : balayer a chaque insertion une fois plein couterait un
   * parcours complet par requete.
   */
  private sweep(nowMs: number): void {
    for (const [key, entry] of this.failures) {
      if (nowMs - entry.startMs >= ADMIN_FAILURE_WINDOW_MS) this.failures.delete(key);
    }
    const target = Math.floor(MAX_TRACKED * 0.9);
    for (const key of this.failures.keys()) {
      if (this.failures.size <= target) break;
      this.failures.delete(key);
    }
  }
}
