import { BALANCE, type BalanceConfig } from './balance.js';
import type { Rng } from './rng.js';

/**
 * Phase de recharge (docs/01-game-design.md §4).
 *
 * Trois orbes sont visibles en permanence pendant six secondes ; toucher une
 * orbe la remplace par la suivante de la sequence. Le client n'envoie que des
 * taps ; c'est ce module, cote serveur, qui rejoue la scene et decide ce qui
 * compte. Un client modifie ne peut donc pas s'offrir de points : un tap sur une
 * orbe qui n'etait pas la, ou trop rapide, est rejete et signale.
 */

export type OrbKind = 'normal' | 'golden';

export interface Orb {
  /** Rang dans la sequence. C'est l'identifiant envoye au client. */
  readonly index: number;
  /** Position horizontale, normalisee dans [0, 1]. */
  readonly x: number;
  /** Position verticale, normalisee dans [0, 1]. */
  readonly y: number;
  readonly kind: OrbKind;
  readonly points: number;
  readonly lifetimeMs: number;
}

export interface RechargeTap {
  /** Instant du tap, en millisecondes depuis le debut de la recharge. */
  readonly atMs: number;
  /** Orbe visee, ou `null` pour un tap dans le vide. */
  readonly orbIndex: number | null;
}

export interface RechargeResult {
  readonly points: number;
  readonly hits: number;
  /** Taps dans le vide : ils cassent le combo. */
  readonly emptyTaps: number;
  /** Orbes parties d'elles-memes : elles cassent le combo. */
  readonly expiredOrbs: number;
  readonly bestCombo: number;
  /** Taps ignores : hors delai, orbe absente, ou au-dela du plafond de cadence. */
  readonly rejectedTaps: number;
  readonly boostPercent: number;
  readonly ultimateGain: number;
  readonly energyGain: number;
}

/**
 * Nombre d'orbes a preparer pour une recharge.
 *
 * Majorant de ce qu'un joueur peut consommer : les orbes visibles au depart,
 * plus tout ce qu'il peut toucher a la cadence maximale autorisee, plus tout ce
 * qui peut expirer dans le temps de jeu cumule des emplacements. Generer la
 * sequence entiere d'avance la rend independante du jeu du joueur, donc
 * reproductible a l'identique lors d'un rejeu.
 */
export function orbSequenceLength(config: BalanceConfig = BALANCE): number {
  const { recharge } = config;
  const durationSeconds = recharge.durationMs / 1_000;
  const maxHits = recharge.maxTapsPerSecond * durationSeconds;
  const shortestLifetimeMs = Math.min(recharge.normalOrb.lifetimeMs, recharge.goldenOrb.lifetimeMs);
  const maxExpirations = Math.floor(
    (recharge.visibleOrbs * recharge.durationMs) / shortestLifetimeMs,
  );
  return recharge.visibleOrbs + maxHits + maxExpirations;
}

/** Tire la sequence d'orbes d'une manche. Identique pour les deux joueurs. */
export function generateOrbSequence(rng: Rng, config: BalanceConfig = BALANCE): readonly Orb[] {
  const { recharge } = config;
  const length = orbSequenceLength(config);
  const sequence: Orb[] = [];

  for (let index = 0; index < length; index += 1) {
    const golden = rng.chance(recharge.goldenOrb.probability);
    const reference = golden ? recharge.goldenOrb : recharge.normalOrb;
    sequence.push({
      index,
      x: rng.nextFloat(),
      y: rng.nextFloat(),
      kind: golden ? 'golden' : 'normal',
      points: reference.points,
      lifetimeMs: reference.lifetimeMs,
    });
  }

  return sequence;
}

interface Slot {
  orb: Orb | null;
  spawnedAtMs: number;
}

/**
 * Rejoue une recharge et compte ce qu'elle rapporte.
 *
 * @param taps Taps envoyes par le client, dans un ordre quelconque.
 * @param sequence Sequence d'orbes de la manche, tiree par `generateOrbSequence`.
 */
export function evaluateRecharge(
  taps: readonly RechargeTap[],
  sequence: readonly Orb[],
  config: BalanceConfig = BALANCE,
): RechargeResult {
  const { recharge } = config;

  const slots: Slot[] = [];
  let nextOrb = 0;
  for (; nextOrb < recharge.visibleOrbs; nextOrb += 1) {
    slots.push({ orb: sequence[nextOrb] ?? null, spawnedAtMs: 0 });
  }

  let points = 0;
  let hits = 0;
  let emptyTaps = 0;
  let expiredOrbs = 0;
  let rejectedTaps = 0;
  let combo = 0;
  let bestCombo = 0;
  /** Instants des taps comptabilises, pour le plafond de cadence. */
  let countedAt: number[] = [];

  const fillSlot = (slot: Slot, atMs: number): void => {
    slot.orb = sequence[nextOrb] ?? null;
    slot.spawnedAtMs = atMs;
    nextOrb += 1;
  };

  /** Fait disparaitre les orbes dont la duree de vie s'acheve avant `untilMs`. */
  const expireUntil = (untilMs: number): void => {
    for (const slot of slots) {
      // Une orbe peut expirer plusieurs fois de suite dans un meme intervalle :
      // sa remplacante peut expirer elle aussi avant qu'on arrive a `untilMs`.
      while (slot.orb !== null && slot.spawnedAtMs + slot.orb.lifetimeMs <= untilMs) {
        const expiresAtMs = slot.spawnedAtMs + slot.orb.lifetimeMs;
        expiredOrbs += 1;
        combo = 0;
        fillSlot(slot, expiresAtMs);
      }
    }
  };

  const chronological = [...taps].sort((left, right) => left.atMs - right.atMs);

  for (const tap of chronological) {
    if (tap.atMs < 0 || tap.atMs > recharge.durationMs) {
      rejectedTaps += 1;
      continue;
    }

    expireUntil(tap.atMs);

    countedAt = countedAt.filter((at) => at > tap.atMs - 1_000);
    if (countedAt.length >= recharge.maxTapsPerSecond) {
      rejectedTaps += 1;
      continue;
    }

    if (tap.orbIndex === null) {
      countedAt.push(tap.atMs);
      emptyTaps += 1;
      combo = 0;
      continue;
    }

    const slot = slots.find((candidate) => candidate.orb?.index === tap.orbIndex);
    if (slot?.orb == null) {
      // Orbe jamais apparue, deja touchee ou deja expiree : le client ment ou
      // a du retard. On ignore sans casser le combat en cours.
      rejectedTaps += 1;
      continue;
    }

    countedAt.push(tap.atMs);
    hits += 1;
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    points += slot.orb.points;
    if (combo >= recharge.comboThreshold) {
      points += recharge.comboBonusPoints;
    }
    fillSlot(slot, tap.atMs);
  }

  expireUntil(recharge.durationMs);

  return {
    points,
    hits,
    emptyTaps,
    expiredOrbs,
    bestCombo,
    rejectedTaps,
    boostPercent: Math.min(points * recharge.boostPercentPerPoint, recharge.boostPercentMax),
    ultimateGain: Math.min(points * recharge.ultimatePerPoint, recharge.ultimateMaxPerRecharge),
    energyGain: Math.min(Math.floor(points / recharge.pointsPerEnergy), recharge.energyMaxPerRound),
  };
}

/** Une orbe affichee, et ce qu'il lui reste a vivre. */
export interface LiveOrb {
  /** Emplacement occupe, de 0 a `visibleOrbs - 1`. Stable d'une image a l'autre. */
  readonly slot: number;
  readonly orb: Orb;
  /** Part de duree de vie restante, de 1 a 0. */
  readonly remaining: number;
}

/**
 * Les orbes visibles a un instant donne.
 *
 * Le client doit dessiner **exactement** ce que le moteur jugera. Recalculer
 * l'occupation des emplacements dans l'interface serait une seconde
 * implementation de la regle : le jour ou les deux divergent, un joueur tape
 * une orbe qu'il voit et que le moteur a deja retiree, et son tap lui est
 * compte comme un coup dans le vide — sans qu'aucune erreur ne soit visible
 * nulle part.
 *
 * La fonction rejoue donc la meme mecanique d'emplacements que
 * `evaluateRecharge`, jusqu'a `atMs`. Elle reste pure et ne juge rien : les
 * points, le combo et les refus restent l'affaire de l'evaluation.
 */
export function liveOrbs(
  taps: readonly RechargeTap[],
  sequence: readonly Orb[],
  atMs: number,
  config: BalanceConfig = BALANCE,
): readonly LiveOrb[] {
  const { recharge } = config;
  if (atMs < 0 || atMs > recharge.durationMs) return [];

  const slots: Slot[] = [];
  let nextOrb = 0;
  for (; nextOrb < recharge.visibleOrbs; nextOrb += 1) {
    slots.push({ orb: sequence[nextOrb] ?? null, spawnedAtMs: 0 });
  }

  const fillSlot = (slot: Slot, spawnedAtMs: number): void => {
    slot.orb = sequence[nextOrb] ?? null;
    slot.spawnedAtMs = spawnedAtMs;
    nextOrb += 1;
  };

  const expireUntil = (untilMs: number): void => {
    for (const slot of slots) {
      while (slot.orb !== null && slot.spawnedAtMs + slot.orb.lifetimeMs <= untilMs) {
        fillSlot(slot, slot.spawnedAtMs + slot.orb.lifetimeMs);
      }
    }
  };

  for (const tap of [...taps].sort((left, right) => left.atMs - right.atMs)) {
    if (tap.atMs < 0 || tap.atMs > atMs) continue;
    expireUntil(tap.atMs);
    if (tap.orbIndex === null) continue;
    // Un tap sur une orbe qui n'est pas affichee ne fait rien disparaitre : le
    // moteur le compte comme un coup dans le vide, l'ecran doit faire pareil.
    const hit = slots.find((slot) => slot.orb !== null && slot.orb.index === tap.orbIndex);
    if (hit !== undefined) fillSlot(hit, tap.atMs);
  }
  expireUntil(atMs);

  const live: LiveOrb[] = [];
  slots.forEach((slot, index) => {
    if (slot.orb === null) return;
    const age = atMs - slot.spawnedAtMs;
    live.push({
      slot: index,
      orb: slot.orb,
      remaining: Math.min(1, Math.max(0, 1 - age / slot.orb.lifetimeMs)),
    });
  });
  return live;
}
