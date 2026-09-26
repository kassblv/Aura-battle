/**
 * La logique des formulaires, hors de React pour etre testee.
 *
 * Les bornes viennent du contrat (`@aura/protocol`, admin.ts) : un motif de
 * 3 a 200 caracteres, une part entiere de 1 a 100. On les redit ici pour
 * parler a l'administrateur AVANT l'envoi ; le client d'API revalide de toute
 * facon avec le schema strict, et le serveur une troisieme fois.
 */

export type Checked<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export const REASON_MIN = 3;
export const REASON_MAX = 200;

/** Motif obligatoire (bannir, lever un bannissement). */
export function requiredReason(raw: string): Checked<string> {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: 'Le motif est obligatoire.' };
  if (value.length < REASON_MIN)
    return { ok: false, error: `Le motif doit faire au moins ${REASON_MIN} caractères.` };
  if (value.length > REASON_MAX)
    return { ok: false, error: `Le motif ne doit pas dépasser ${REASON_MAX} caractères.` };
  return { ok: true, value };
}

/** Motif facultatif (drapeaux, evenements) : vide = absent ; sinon memes bornes. */
export function optionalReason(raw: string): Checked<string | undefined> {
  if (raw.trim().length === 0) return { ok: true, value: undefined };
  return requiredReason(raw);
}

/** La part d'une nouvelle mesure : un entier de 1 a 100. */
export function parseRollout(raw: string): Checked<number> {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: 'La part est un nombre entier de 1 à 100.' };
  const value = Number(text);
  if (value < 1 || value > 100)
    return { ok: false, error: 'La part est comprise entre 1 et 100 %.' };
  return { ok: true, value };
}

export type BanDuration = '1d' | '7d' | '30d' | 'permanent' | 'date';

export const BAN_DURATIONS: readonly { readonly id: BanDuration; readonly label: string }[] = [
  { id: '1d', label: '1 jour' },
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: 'permanent', label: 'Définitif' },
  { id: 'date', label: 'Jusqu’à une date précise' },
];

const DAY_MS = 86_400_000;
const DAYS: Readonly<Record<'1d' | '7d' | '30d', number>> = { '1d': 1, '7d': 7, '30d': 30 };

/**
 * La fin du bannissement, en ISO UTC, ou `null` pour « definitif ».
 *
 * `dateInput` est la valeur d'un `<input type="datetime-local">`
 * (`2026-10-01T18:30`), lue dans le fuseau du navigateur — celui de la
 * personne qui bannit, qui pense en heure locale. Elle doit etre future.
 */
export function banUntil(
  duration: BanDuration,
  nowMs: number,
  dateInput = '',
): Checked<string | null> {
  if (duration === 'permanent') return { ok: true, value: null };
  if (duration !== 'date')
    return { ok: true, value: new Date(nowMs + DAYS[duration] * DAY_MS).toISOString() };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(dateInput)) {
    return { ok: false, error: 'Choisis une date et une heure de fin.' };
  }
  const at = new Date(dateInput).getTime();
  if (Number.isNaN(at)) return { ok: false, error: 'Date de fin illisible.' };
  if (at <= nowMs) return { ok: false, error: 'La date de fin doit être dans le futur.' };
  return { ok: true, value: new Date(at).toISOString() };
}

/** Le libelle de la duree pour la confirmation : « jusqu'au 3 oct. 2026, 18:30 » ou « définitivement ». */
export function describeBan(until: string | null): string {
  if (until === null) return 'définitivement';
  const at = new Date(until);
  return `jusqu’au ${at.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`;
}
