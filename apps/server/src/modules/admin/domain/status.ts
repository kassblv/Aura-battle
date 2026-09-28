/**
 * Les verdicts du tableau de bord d'administration.
 *
 * Pur : on donne des faits bruts, il rend une couleur. C'est ce qui permet de
 * verifier les seuils sans attendre qu'une sauvegarde vieillisse.
 */

export type Verdict = 'ok' | 'warn' | 'down';

/**
 * Au-dela, une nuit a ete sautee.
 *
 * Vingt-six heures et non vingt-quatre : la sauvegarde tourne toutes les
 * vingt-quatre heures, et un seuil pose exactement la serait franchi par une
 * minute de retard du cron. Un voyant qui s'allume sans raison est un voyant
 * qu'on apprend a ignorer — apres quoi il ne sert plus a rien le jour ou il a
 * raison.
 */
export const BACKUP_STALE_MS = 26 * 3_600_000;

/** Au-dela, deux nuits ont ete sautees : ce n'est plus un retard. */
export const BACKUP_LATE_MS = 50 * 3_600_000;

export function backupVerdict(lastSuccess: Date | null, nowMs: number): Verdict {
  // Aucune sauvegarde est le PIRE cas, pas un cas inconnu : le presenter
  // comme « pas d'information » laisserait croire a un detail de lecture
  // alors que c'est l'etat contre lequel on se protege.
  if (lastSuccess === null) return 'down';

  const age = nowMs - lastSuccess.getTime();
  // Une date dans le futur est une horloge fausse, pas une sauvegarde fraiche.
  if (age < 0) return 'warn';
  if (age > BACKUP_LATE_MS) return 'down';
  return age > BACKUP_STALE_MS ? 'warn' : 'ok';
}

const SEVERITY: Readonly<Record<Verdict, number>> = { ok: 0, warn: 1, down: 2 };

/**
 * Le pire l'emporte.
 *
 * Un tableau de bord qui affiche « tout va bien » en vert pendant qu'une ligne
 * est rouge est pire qu'un tableau absent : il apprend a ne pas le lire.
 */
export function overallVerdict(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>(
    (worst, current) => (SEVERITY[current] > SEVERITY[worst] ? current : worst),
    'ok',
  );
}
