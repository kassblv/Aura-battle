import { describe, expect, it } from 'vitest';
import {
  BACKUP_STALE_MS,
  BACKUP_LATE_MS,
  backupVerdict,
  overallVerdict,
  type Verdict,
} from './status.js';

const NOW = Date.parse('2026-09-21T20:00:00Z');
const ago = (ms: number): Date => new Date(NOW - ms);

describe('backupVerdict', () => {
  /*
    Le seuil n'est pas rond par hasard : la sauvegarde tourne toutes les
    24 h. Un seuil A 24 h serait franchi par une simple minute de retard du
    cron, et un voyant qui s'allume sans raison est un voyant qu'on apprend a
    ignorer — apres quoi il ne sert plus a rien le jour ou il a raison.
  */
  it('est vert pour une sauvegarde de la nuit', () => {
    expect(backupVerdict(ago(6 * 3_600_000), NOW)).toBe<Verdict>('ok');
  });

  it('tolere un cron en retard', () => {
    expect(backupVerdict(ago(BACKUP_STALE_MS - 1), NOW)).toBe<Verdict>('ok');
  });

  it('avertit quand une nuit a ete sautee', () => {
    expect(backupVerdict(ago(BACKUP_STALE_MS + 1), NOW)).toBe<Verdict>('warn');
  });

  it('alerte quand deux nuits ont ete sautees', () => {
    expect(backupVerdict(ago(BACKUP_LATE_MS + 1), NOW)).toBe<Verdict>('down');
  });

  /*
    Aucune sauvegarde du tout n'est le pire cas, pas un cas inconnu. Le
    presenter comme « pas d'information » laisserait croire a un detail de
    lecture alors que c'est precisement l'etat contre lequel on se protege.
  */
  it('alerte quand il n y a aucune sauvegarde', () => {
    expect(backupVerdict(null, NOW)).toBe<Verdict>('down');
  });

  /* Une date dans le futur est une horloge fausse, pas une sauvegarde fraiche. */
  it('se mefie d une date dans le futur', () => {
    expect(backupVerdict(new Date(NOW + 3_600_000), NOW)).toBe<Verdict>('warn');
  });
});

describe('overallVerdict', () => {
  /*
    Le pire l'emporte. Un tableau de bord qui affiche « tout va bien » en vert
    pendant qu'une ligne est rouge est pire qu'un tableau absent : il apprend
    a ne pas le lire.
  */
  it('prend le pire des verdicts', () => {
    expect(overallVerdict(['ok', 'ok', 'ok'])).toBe<Verdict>('ok');
    expect(overallVerdict(['ok', 'warn', 'ok'])).toBe<Verdict>('warn');
    expect(overallVerdict(['ok', 'warn', 'down'])).toBe<Verdict>('down');
    expect(overallVerdict(['down', 'ok'])).toBe<Verdict>('down');
  });

  it('est vert quand il n y a rien a dire', () => {
    expect(overallVerdict([])).toBe<Verdict>('ok');
  });
});
