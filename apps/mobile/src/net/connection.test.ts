import { describe, expect, it } from 'vitest';
import {
  BACKOFF_CEILING_MS,
  BACKOFF_STEP_MS,
  createConnection,
  type Connection,
} from './connection.js';

/** Gigue figee : les delais deviennent verifiables au lieu d etre approximatifs. */
const steady = (value: number) => () => value;

const fresh = (jitter = 0.5): Connection => createConnection({ random: steady(jitter) });

describe('createConnection', () => {
  it('demarre hors ligne, sans match en cours', () => {
    const link = fresh();
    expect(link.status).toBe('offline');
    expect(link.matchId).toBeNull();
    expect(link.attempts).toBe(0);
  });

  it('se connecte sans attendre la premiere fois', () => {
    const link = fresh();
    expect(link.nextDelayMs()).toBe(0);
    link.connecting();
    expect(link.status).toBe('connecting');
    link.opened();
    expect(link.status).toBe('online');
  });
});

describe('reconnexion', () => {
  it('espace les tentatives, de plus en plus', () => {
    const link = fresh();
    link.connecting();
    link.opened();

    link.lost();
    const first = link.nextDelayMs();
    link.connecting();
    link.failed();
    const second = link.nextDelayMs();
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it('plafonne l attente : une coupure longue ne doit pas devenir un abandon', () => {
    const link = fresh(1);
    link.connecting();
    link.opened();
    link.lost();
    for (let i = 0; i < 20; i++) {
      link.connecting();
      link.failed();
    }
    expect(link.nextDelayMs()).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
  });

  /**
   * La gigue evite que tous les clients coupes par la meme panne reviennent
   * exactement ensemble — c est ce qui transforme un incident reseau en coup de
   * belier sur le serveur au moment ou il se remet.
   */
  it('brouille les delais entre appareils', () => {
    const early = createConnection({ random: steady(0) });
    const late = createConnection({ random: steady(1) });
    for (const link of [early, late]) {
      link.connecting();
      link.opened();
      link.lost();
    }
    expect(early.nextDelayMs()).toBeLessThan(late.nextDelayMs());
    expect(early.nextDelayMs()).toBeGreaterThanOrEqual(BACKOFF_STEP_MS / 2);
  });

  it('repart de zero apres une reconnexion reussie', () => {
    const link = fresh();
    link.connecting();
    link.opened();
    link.lost();
    link.connecting();
    link.failed();
    expect(link.attempts).toBeGreaterThan(0);

    link.connecting();
    link.opened();
    expect(link.attempts).toBe(0);
    expect(link.nextDelayMs()).toBe(0);
  });
});

describe('reprise de match', () => {
  it('retient le match en cours', () => {
    const link = fresh();
    link.connecting();
    link.opened();
    link.joinedMatch('m_42');
    expect(link.matchId).toBe('m_42');
  });

  /**
   * `CLAUDE.md` : une application mobile peut etre suspendue en plein match.
   * Au retour, elle ne redemarre pas une partie — elle demande l etat.
   */
  it('demande une reprise, jamais un nouveau match', () => {
    const link = fresh();
    link.connecting();
    link.opened();
    link.joinedMatch('m_42');
    link.lost();
    link.connecting();
    link.opened();
    expect(link.resumeAction()).toEqual({ type: 'rejoin', matchId: 'm_42' });
  });

  it('ne demande rien quand aucun match n est en cours', () => {
    const link = fresh();
    link.connecting();
    link.opened();
    expect(link.resumeAction()).toBeNull();
  });

  /**
   * Un match termine ne doit plus etre reclame : le serveur repondrait par une
   * erreur, et le client insisterait a chaque reconnexion.
   */
  it('oublie le match une fois termine', () => {
    const link = fresh();
    link.connecting();
    link.opened();
    link.joinedMatch('m_42');
    link.leftMatch();
    link.lost();
    link.connecting();
    link.opened();
    expect(link.matchId).toBeNull();
    expect(link.resumeAction()).toBeNull();
  });

  it('garde le match a travers plusieurs echecs d affilee', () => {
    const link = fresh();
    link.connecting();
    link.opened();
    link.joinedMatch('m_7');
    link.lost();
    for (let i = 0; i < 5; i++) {
      link.connecting();
      link.failed();
    }
    expect(link.matchId).toBe('m_7');
    link.connecting();
    link.opened();
    expect(link.resumeAction()).toEqual({ type: 'rejoin', matchId: 'm_7' });
  });
});

describe('etats impossibles', () => {
  it('ignore une ouverture qu on n a pas demandee', () => {
    const link = fresh();
    link.opened();
    expect(link.status).toBe('offline');
  });

  it('ignore une perte quand on est deja hors ligne', () => {
    const link = fresh();
    link.lost();
    expect(link.status).toBe('offline');
    expect(link.attempts).toBe(0);
  });

  it('distingue une premiere connexion d une reprise', () => {
    const link = fresh();
    link.connecting();
    expect(link.status).toBe('connecting');
    link.opened();
    link.lost();
    link.connecting();
    // Le libelle importe : l interface dit « reconnexion », pas « connexion ».
    expect(link.status).toBe('reconnecting');
  });
});
