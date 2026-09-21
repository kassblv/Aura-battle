import { describe, expect, it } from 'vitest';
import { AdminStatusService } from './admin-status.service.js';
import { createErrorLog } from '../domain/error-log.js';
import type { AdminProbes } from '../domain/ports.js';

const NOW = Date.parse('2026-09-21T20:00:00Z');

const probes = (over: Partial<AdminProbes> = {}): AdminProbes => ({
  database: () =>
    Promise.resolve({
      players: 12,
      matchesTotal: 40,
      matchesLastDay: 3,
      rankedPlayers: 9,
      lastMatchAt: new Date(NOW - 3_600_000),
    }),
  queue: () => Promise.resolve({ waiting: 1 }),
  lastBackup: () => Promise.resolve(new Date(NOW - 6 * 3_600_000)),
  ...over,
});

const service = (over: Partial<AdminProbes> = {}) =>
  new AdminStatusService({
    probes: probes(over),
    errors: createErrorLog(() => NOW),
    now: () => NOW,
    uptimeSeconds: () => 3_600,
    commit: 'd9d7e4b',
    builtAt: () => '2026-09-21T20:00:00Z',
  });

describe('AdminStatusService', () => {
  it('rend tout au vert quand tout va bien', async () => {
    const status = await service().read();
    expect(status.overall).toBe('ok');
    expect(status.components.every((c) => c.verdict === 'ok')).toBe(true);
  });

  /*
    Une sonde qui ne repond pas EST le verdict. L'afficher comme « inconnu »
    en gris laisserait croire a un detail de lecture, alors que c'est
    exactement ce qu'on surveille.
  */
  it('passe au rouge quand la base ne repond pas', async () => {
    const status = await service({ database: () => Promise.resolve(null) }).read();
    expect(status.overall).toBe('down');
    expect(status.components.find((c) => c.name === 'Base de données')?.verdict).toBe('down');
  });

  it('passe au rouge quand la file ne repond pas', async () => {
    const status = await service({ queue: () => Promise.resolve(null) }).read();
    expect(status.components.find((c) => c.name === 'File d’attente')?.verdict).toBe('down');
  });

  it('avertit quand la sauvegarde a saute une nuit', async () => {
    const status = await service({
      lastBackup: () => Promise.resolve(new Date(NOW - 30 * 3_600_000)),
    }).read();
    expect(status.overall).toBe('warn');
  });

  /*
    Une sonde qui LEVE ne doit pas emporter le tableau de bord : c'est
    justement quand quelque chose casse qu'on vient le regarder.
  */
  it('survit a une sonde qui leve', async () => {
    const status = await service({
      database: () => Promise.reject(new Error('connexion refusee')),
    }).read();
    expect(status.overall).toBe('down');
  });

  it('rend les chiffres de la base', async () => {
    const status = await service().read();
    expect(status.database).toMatchObject({ players: 12, matchesLastDay: 3 });
  });

  it('rend la duree de fonctionnement et le commit deploye', async () => {
    const status = await service().read();
    expect(status.uptimeSeconds).toBe(3_600);
    expect(status.commit).toBe('d9d7e4b');
  });

  /*
    Coolify ne fournit PAS le commit pour un deploiement par compose : la
    variable reste vide (verifie sur le serveur). L'instant de construction,
    lui, est grave par la construction elle-meme et ne depend de personne —
    « image construite il y a deux heures » repond a l'essentiel de « quelle
    version tourne ».
  */
  it('rend l instant de construction de l image', async () => {
    expect((await service().read()).builtAt).toBe('2026-09-21T20:00:00Z');
  });

  it('avoue ne pas savoir quand l image ne le dit pas', async () => {
    const sans = new AdminStatusService({
      probes: probes(),
      errors: createErrorLog(() => NOW),
      now: () => NOW,
      uptimeSeconds: () => 60,
      commit: 'abc',
      builtAt: () => null,
    });
    expect((await sans.read()).builtAt).toBeNull();
  });

  /*
    Le compteur d'erreurs se lit A COTE de la duree de fonctionnement : remis
    a zero au redemarrage, il ne trompe personne tant que les deux sont
    affiches ensemble.
  */
  it('rend les erreurs recentes', async () => {
    const errors = createErrorLog(() => NOW);
    errors.record('base injoignable');
    const status = await new AdminStatusService({
      probes: probes(),
      errors,
      now: () => NOW,
      uptimeSeconds: () => 60,
      commit: 'abc',
      builtAt: () => null,
    }).read();

    expect(status.errors.total).toBe(1);
    expect(status.errors.recent[0]?.message).toBe('base injoignable');
  });
});
