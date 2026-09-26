import { describe, expect, it } from 'vitest';
import { ERROR_LOG_CAPACITY, ERROR_WINDOW_MS, createErrorLog } from './error-log.js';

const NOW = Date.parse('2026-09-21T20:00:00Z');

describe('createErrorLog', () => {
  it('compte ce qu on lui donne', () => {
    const t = NOW;
    const log = createErrorLog(() => t);
    log.record('base injoignable');
    log.record('redis coupe');
    expect(log.since(ERROR_WINDOW_MS).total).toBe(2);
  });

  /*
    La fenetre est glissante : ce qui date de plus de vingt-quatre heures ne
    dit plus rien de l'etat actuel, et le garder ferait rougir un tableau de
    bord pour un incident deja resolu la veille.
  */
  it('oublie ce qui sort de la fenetre', () => {
    let t = NOW;
    const log = createErrorLog(() => t);
    log.record('vieille panne');
    t = NOW + ERROR_WINDOW_MS + 1;
    log.record('panne recente');

    expect(log.since(ERROR_WINDOW_MS).total).toBe(1);
  });

  it('rend les dernieres, les plus recentes d abord', () => {
    let t = NOW;
    const log = createErrorLog(() => t);
    log.record('premiere');
    t += 1_000;
    log.record('seconde');

    expect(log.since(ERROR_WINDOW_MS).recent.map((e) => e.message)).toEqual([
      'seconde',
      'premiere',
    ]);
  });

  /*
    Une borne, parce qu'un serveur qui part en boucle d'erreur en produit des
    milliers par minute. C'est la meme lecon que le protocole : une structure
    dont quelqu'un d'autre choisit la taille a besoin de sa propre borne.
  */
  it('ne grandit pas sans fin', () => {
    const log = createErrorLog(() => NOW);
    for (let i = 0; i < ERROR_LOG_CAPACITY * 3; i++) log.record(`panne ${String(i)}`);

    const vue = log.since(ERROR_WINDOW_MS);
    expect(vue.recent.length).toBeLessThanOrEqual(ERROR_LOG_CAPACITY);
    // Le TOTAL, lui, reste vrai : on perd le detail, jamais le compte.
    expect(vue.total).toBe(ERROR_LOG_CAPACITY);
  });

  it('garde les plus recentes quand il deborde', () => {
    let t = NOW;
    const log = createErrorLog(() => t);
    for (let i = 0; i < ERROR_LOG_CAPACITY + 5; i++) {
      log.record(`panne ${String(i)}`);
      t += 10;
    }
    expect(log.since(ERROR_WINDOW_MS).recent[0]?.message).toBe(
      `panne ${String(ERROR_LOG_CAPACITY + 4)}`,
    );
  });

  it('borne la longueur d un message', () => {
    const log = createErrorLog(() => NOW);
    log.record('x'.repeat(5_000));
    expect((log.since(ERROR_WINDOW_MS).recent[0]?.message ?? '').length).toBeLessThanOrEqual(300);
  });
});
