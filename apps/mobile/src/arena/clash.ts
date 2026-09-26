import type { Seat } from '@aura/rules';
import type { Vec3 } from './fx.js';
import { clamp, easeOut } from './math.js';
import type { ParticleSink } from './particles.js';

/**
 * Le choc des auras (port de « Choc des auras » du prototype :
 * `startClash`, `updateClash`, et le bloc `if(clash && ...)` de `fillParticles`).
 *
 * Deux faisceaux partent de la poitrine des combattants, se rejoignent au
 * milieu, et le point de rencontre glisse vers le perdant au moment du contact.
 * C est **la** lecture du resultat : le sens dans lequel le point part dit qui
 * l emporte, avant tout bandeau et sans un mot de francais.
 *
 * Tout est calcule ici et pose dans le puits a particules — donc dans les deux
 * memes tampons que le reste : aucun appel de dessin supplementaire.
 */

/** Duree totale du choc, en millisecondes. Reprise du prototype. */
export const CLASH_DURATION_MS = 950;

/** Part de la duree au bout de laquelle les faisceaux se touchent. */
export const CLASH_HIT_AT = 0.45;

/** Decalage horizontal du depart d un faisceau : il sort du corps, pas du nez. */
const MUZZLE_OFFSET = 0.18;

/**
 * Hauteur de poitrine d un combattant, en metres.
 *
 * Le prototype suivait `f.cy`, le centre courant du squelette, qui monte avec
 * un salto. Une hauteur fixe est plus lisible : deux faisceaux qui se
 * rejoignent a la meme altitude se lisent comme une rencontre, deux faisceaux
 * qui se croisent en biais comme un rate.
 */
export const CHEST_HEIGHT = 1.05;

/** Points echantillonnes le long d un faisceau. */
const BEAM_SAMPLES = 40;

/** Epaisseur du halo colore et du coeur blanc, en metres. */
const BEAM_HALO_SIZE = 0.15;
const BEAM_CORE_SIZE = 0.05;

/** Amplitude du tremblement d un faisceau, en metres. Coupe en mouvement reduit. */
const BEAM_JITTER = 0.025;

export interface ClashSpec {
  readonly winner: Seat | null;
  readonly counter: Seat | null;
  readonly ultimate: Seat | null;
}

/**
 * De combien le point de rencontre part chez le perdant.
 *
 * Le prototype poussait de 0,17 quelle que soit l issue. Ici la poussee dit
 * **comment** la manche a ete gagnee : au score, par un contre, ou par un
 * Ultime — que le joueur doit reconnaitre sans lire le verdict. Une manche
 * nulle ne pousse pas : les deux faisceaux calent au centre.
 */
export function clashBias(spec: ClashSpec): number {
  if (spec.winner === null) return 0;
  const direction = spec.winner === 'a' ? 1 : -1;
  const strength = spec.ultimate === spec.winner ? 0.3 : spec.counter === spec.winner ? 0.24 : 0.17;
  return direction * strength;
}

/**
 * Ou se rencontrent les faisceaux, en fraction du segment a → b.
 *
 * 0,5 tant que rien n est tranche, puis le point glisse au moment du contact.
 */
export function meetingFraction(progress: number, bias: number): number {
  if (progress <= CLASH_HIT_AT) return 0.5;
  return 0.5 + bias * easeOut(clamp((progress - CLASH_HIT_AT) / 0.25, 0, 1));
}

/** Avancee du faisceau vers le point de rencontre, entre 0 et 1. */
export function beamGrowth(progress: number): number {
  return easeOut(clamp(progress / CLASH_HIT_AT, 0, 1));
}

/** Effacement des faisceaux sur le dernier tiers. */
export function beamFade(progress: number): number {
  return progress > 0.7 ? clamp(1 - (progress - 0.7) / 0.3, 0, 1) : 1;
}

/**
 * Le faisceau le plus lourd qu on puisse pousser.
 *
 * Sert aussi d echelle a l intensite de l aura (`auraIntensity`) : sans une
 * valeur nommee, le facteur de normalisation serait un 1,6 recopie ailleurs,
 * qui cesserait d etre vrai au premier ajustement.
 */
export const BEAM_WEIGHT_ULTIMATE = 1.6;
export const BEAM_WEIGHT_COUNTER = 1.35;

/**
 * Poids d un faisceau : ce qu il pese dans la rencontre.
 *
 * Celui qui a contre ou lache son Ultime pousse un trait plus epais, et le
 * perdant maigrit une fois touche. Un joueur distrait voit deux traits de meme
 * taille se croiser ; celui qui regarde voit lequel entre dans l autre.
 */
export function beamWeight(spec: ClashSpec, seat: Seat, progress: number): number {
  let weight = 1;
  if (spec.ultimate === seat) weight = BEAM_WEIGHT_ULTIMATE;
  else if (spec.counter === seat) weight = BEAM_WEIGHT_COUNTER;

  if (progress > CLASH_HIT_AT && spec.winner !== null && spec.winner !== seat) {
    // Le faisceau du perdant s ecrase : il ne s eteint pas, il cede.
    weight *= 1 - 0.45 * easeOut(clamp((progress - CLASH_HIT_AT) / 0.35, 0, 1));
  }
  return weight;
}

/** Halo blanc au point de contact : gros et bref, puis dilate et efface. */
export function coreGlow(progress: number): { readonly alpha: number; readonly size: number } {
  if (progress < CLASH_HIT_AT) return { alpha: 0, size: 0 };
  const k = clamp(1 - (progress - CLASH_HIT_AT) / (1 - CLASH_HIT_AT), 0, 1);
  return { alpha: 0.9 * k, size: 0.5 + 0.9 * (1 - k) };
}

export type ClashEnds = Readonly<Record<Seat, Vec3>>;
export type ClashColors = Readonly<Record<Seat, string>>;

export interface ClashUpdate {
  /** Vrai pour la seule image ou les faisceaux viennent de se toucher. */
  readonly hit: boolean;
  /** Point de rencontre courant, ou `null` si aucun choc n est en cours. */
  readonly point: Vec3 | null;
}

const IDLE: ClashUpdate = Object.freeze({ hit: false, point: null });

export interface Clash {
  readonly active: boolean;
  /** Avancement, entre 0 et 1. */
  readonly progress: number;
  readonly point: Vec3 | null;
  /**
   * Ce que pese le faisceau de ce siege, maintenant. Zero hors du choc.
   *
   * L aura des combattants lit ce nombre plutot que de rededuire le vainqueur
   * de son cote : c est deja ce que `beamWeight` exprime, et deux expressions
   * du meme fait finissent toujours par se contredire.
   */
  weight(seat: Seat): number;
  start(spec: ClashSpec): void;
  stop(): void;
  setReducedMotion(reduced: boolean): void;
  /** Avance le choc. `ends` donne la poitrine de chaque combattant. */
  update(deltaMs: number, ends: ClashEnds): ClashUpdate;
  /** Pose les faisceaux. `elapsedMs` ne sert qu au tremblement. */
  draw(sink: ParticleSink, colors: ClashColors, elapsedMs: number): void;
}

export function createClash(): Clash {
  let spec: ClashSpec | null = null;
  let elapsed = 0;
  let hit = false;
  let reducedMotion = false;
  let ends: ClashEnds | null = null;
  let point: Vec3 | null = null;

  return {
    get active() {
      return spec !== null;
    },
    get progress() {
      return spec === null ? 0 : clamp(elapsed / CLASH_DURATION_MS, 0, 1);
    },
    get point() {
      return point;
    },

    weight(seat): number {
      if (spec === null) return 0;
      return beamWeight(spec, seat, clamp(elapsed / CLASH_DURATION_MS, 0, 1));
    },

    start(next): void {
      spec = next;
      elapsed = 0;
      hit = false;
      point = null;
    },

    stop(): void {
      spec = null;
      point = null;
      ends = null;
    },

    setReducedMotion(reduced): void {
      reducedMotion = reduced;
    },

    update(deltaMs, nextEnds): ClashUpdate {
      if (spec === null) return IDLE;
      elapsed += Math.max(0, deltaMs);
      ends = nextEnds;

      if (elapsed >= CLASH_DURATION_MS) {
        const last = point;
        spec = null;
        point = null;
        ends = null;
        // Un choc trop court pour avoir atteint le contact le signale quand
        // meme : le verdict ne doit jamais rester sans son coup.
        return hit ? IDLE : { hit: true, point: last };
      }

      const progress = elapsed / CLASH_DURATION_MS;
      const fraction = meetingFraction(progress, clashBias(spec));
      point = {
        x: nextEnds.a.x + (nextEnds.b.x - nextEnds.a.x) * fraction,
        y: (nextEnds.a.y + nextEnds.b.y) / 2,
        z: (nextEnds.a.z + nextEnds.b.z) / 2,
      };

      if (!hit && progress >= CLASH_HIT_AT) {
        hit = true;
        return { hit: true, point };
      }
      return { hit: false, point };
    },

    draw(sink, colors, elapsedMs): void {
      if (spec === null || ends === null || point === null) return;
      const progress = elapsed / CLASH_DURATION_MS;
      const growth = beamGrowth(progress);
      const fade = beamFade(progress);

      for (const seat of ['a', 'b'] as const) {
        const end = ends[seat];
        const weight = beamWeight(spec, seat, progress);
        // Le faisceau sort du cote de l adversaire : `a` est a gauche.
        const facing = seat === 'a' ? 1 : -1;
        const startX = end.x + MUZZLE_OFFSET * facing;
        const color = colors[seat];

        for (let i = 0; i <= BEAM_SAMPLES; i++) {
          const u = i / BEAM_SAMPLES;
          const jitter = reducedMotion ? 0 : Math.sin(elapsedMs / 40 + i * 1.7) * BEAM_JITTER;
          const x = startX + (point.x - startX) * growth * u;
          const y = end.y + (point.y - end.y) * growth * u + jitter;
          const z = end.z + (point.z - end.z) * growth * u + jitter;
          sink.add(x, y, z, color, 0.55 * fade, BEAM_HALO_SIZE * weight);
          sink.add(x, y, z, '#ffffff', 0.8 * fade, BEAM_CORE_SIZE * weight);
        }
      }

      const glow = coreGlow(progress);
      if (glow.alpha > 0) {
        sink.add(point.x, point.y, point.z, '#ffffff', glow.alpha, glow.size);
      }
    },
  };
}
