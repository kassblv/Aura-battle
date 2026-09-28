import type { Unit } from '../api/dashboard.js';

/** Formats d'affichage, en francais. Purs : l'instant courant est un parametre. */

const LOCALE = 'fr-FR';

export function number(value: number, digits = 2): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: digits });
}

/** Une valeur selon son unite : part en %, duree en s, sinon un nombre. */
export function measure(value: number | null, unit: Unit): string {
  if (value === null) return '—';
  if (unit === 'ratio') return `${number(value * 100, 1)} %`;
  if (unit === 'ms') return `${number(value / 1000, 1)} s`;
  return number(value, 2);
}

/** Ecart relatif de `value` a `reference` (0,1 : 10 % de plus), ou `null` s'il ne se calcule pas. */
export function gap(value: number | null, reference: number | null): number | null {
  if (value === null || reference === null || reference === 0) return null;
  return (value - reference) / reference;
}

/** Un ecart en %, signe (`+9 %`, `−12,5 %`) ; zero n'a pas de signe. */
export function signedPercent(ratio: number | null): string {
  if (ratio === null) return '—';
  const magnitude = number(Math.abs(ratio) * 100, 1);
  if (magnitude === '0') return '0 %';
  return `${ratio > 0 ? '+' : '−'}${magnitude} %`;
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} j`;
}

export function ago(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'date inconnue';
  return `il y a ${duration(Math.max(0, (nowMs - at) / 1000))}`;
}

export function dateTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Un jour, lu en UTC : les semaines d'evenement sont des semaines UTC. */
export function utcDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function time(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString(LOCALE);
}

/** JSON lisible pour l'avant/apres du journal. `undefined` se dit « rien ». */
export function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[valeur illisible]';
  }
}

/** Noms des drapeaux connus ; un drapeau inconnu s'affiche tel quel. */
const FLAG_NAMES: Readonly<Record<string, string>> = { intentBubble: 'Bulle d’intention' };
export const flagName = (flag: string): string => FLAG_NAMES[flag] ?? flag;

export const WEEK_MS = 7 * 86_400_000;
