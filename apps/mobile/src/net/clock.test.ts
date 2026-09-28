import { describe, expect, it } from 'vitest';
import { createSyncedClock, estimatedServerNow, SYNC_WINDOW } from './clock.js';

/** Aller-retour symetrique : le serveur repond pile au milieu du trajet. */
const symmetric = (sentAtMs: number, roundTripMs: number, offsetMs: number) => ({
  sentAtMs,
  receivedAtMs: sentAtMs + roundTripMs,
  serverTimeMs: sentAtMs + roundTripMs / 2 + offsetMs,
});

describe('createSyncedClock', () => {
  it('ne pretend rien tant qu il n a pas mesure', () => {
    const clock = createSyncedClock();
    expect(clock.synced).toBe(false);
    expect(clock.offsetMs).toBeNull();
    // Rendre zero serait pire que refuser : un tap date avec un faux offset
    // arrive au serveur comme une declaration invraisemblable, et c est le
    // joueur qui recolte le soupcon (docs/06).
    expect(() => clock.toServerTime(1000)).toThrow(/synchron/i);
  });

  it('deduit l offset du milieu de l aller-retour', () => {
    const clock = createSyncedClock();
    clock.observe(symmetric(1000, 40, 5000));
    expect(clock.offsetMs).toBeCloseTo(5000, 6);
    expect(clock.roundTripMs).toBe(40);
    expect(clock.synced).toBe(true);
  });

  it('convertit dans les deux sens sans perte', () => {
    const clock = createSyncedClock();
    clock.observe(symmetric(1000, 40, 5000));
    expect(clock.toClientTime(clock.toServerTime(1234))).toBeCloseTo(1234, 6);
  });

  /**
   * On garde l aller-retour le plus court de la fenetre.
   *
   * Un trajet long a forcement ete retarde d un cote ou de l autre, et rien ne
   * dit lequel : son estimation d offset est donc la moins fiable. Le trajet le
   * plus court est celui qui a le moins de place pour mentir.
   */
  it('retient la mesure la plus rapide, pas la plus recente', () => {
    const clock = createSyncedClock();
    clock.observe(symmetric(1000, 20, 5000));
    clock.observe(symmetric(2000, 400, 5000));
    expect(clock.roundTripMs).toBe(20);
    expect(clock.offsetMs).toBeCloseTo(5000, 6);
  });

  it('adopte une mesure plus rapide des qu elle arrive', () => {
    const clock = createSyncedClock();
    clock.observe(symmetric(1000, 300, 5000));
    clock.observe(symmetric(2000, 12, 5000));
    expect(clock.roundTripMs).toBe(12);
  });

  /**
   * La fenetre glisse : sans cela, un unique aller-retour chanceux au
   * demarrage figerait l offset pour toute la partie, et l horloge cesserait de
   * suivre la derive de l appareil.
   */
  it('oublie les mesures sorties de la fenetre', () => {
    const clock = createSyncedClock();
    clock.observe(symmetric(0, 5, 1000));
    for (let i = 1; i <= SYNC_WINDOW; i++) clock.observe(symmetric(i * 1000, 60, 2000));
    expect(clock.roundTripMs).toBe(60);
    expect(clock.offsetMs).toBeCloseTo(2000, 6);
  });

  it('garde la fenetre bornee', () => {
    const clock = createSyncedClock();
    for (let i = 0; i < SYNC_WINDOW * 4; i++) clock.observe(symmetric(i * 100, 30, 100));
    expect(clock.sampleCount).toBe(SYNC_WINDOW);
  });

  /**
   * Un echantillon dont la reponse precede l envoi ne decrit aucun trajet
   * possible : l horloge de l appareil a saute pendant la mesure. L accepter
   * donnerait un offset aberrant, et `performance.now()` n est justement pas
   * cense sauter.
   */
  it('refuse une reponse arrivee avant sa question', () => {
    const clock = createSyncedClock();
    clock.observe({ sentAtMs: 1000, receivedAtMs: 900, serverTimeMs: 5000 });
    expect(clock.synced).toBe(false);
  });

  it('refuse un echantillon dont une valeur n est pas finie', () => {
    const clock = createSyncedClock();
    clock.observe({ sentAtMs: 0, receivedAtMs: Number.NaN, serverTimeMs: 5000 });
    clock.observe({ sentAtMs: 0, receivedAtMs: 10, serverTimeMs: Number.POSITIVE_INFINITY });
    expect(clock.synced).toBe(false);
  });

  it('accepte un aller-retour instantane', () => {
    // Deux onglets sur la meme machine : c est rare, ce n est pas invalide.
    const clock = createSyncedClock();
    clock.observe({ sentAtMs: 500, receivedAtMs: 500, serverTimeMs: 9000 });
    expect(clock.roundTripMs).toBe(0);
    expect(clock.offsetMs).toBeCloseTo(8500, 6);
  });

  /**
   * Le decalage se mesure, il ne se devine pas. Une horloge d appareil reglee
   * a la main peut etre a des heures de la verite — et le serveur, lui, juge
   * des taps a 400 ms pres (docs/06).
   */
  it('supporte un appareil tres desynchronise', () => {
    const clock = createSyncedClock();
    const hours = 3 * 3600 * 1000;
    clock.observe(symmetric(1000, 50, -hours));
    expect(clock.offsetMs).toBeCloseTo(-hours, 3);
    expect(clock.toServerTime(1000)).toBeCloseTo(1000 - hours, 3);
  });
});

/*
  L'accueil annonce l'evenement de la semaine : sur l'heure SERVEUR quand elle
  est mesuree, sinon sur l'horloge murale. Un telephone mal regle autour du
  lundi 00:00 UTC annoncait sinon une autre variante que celle du match.
*/
describe('estimatedServerNow', () => {
  it('suit le serveur des qu un aller-retour a abouti', () => {
    const clock = createSyncedClock();
    // Au milieu du trajet (1 000 en local), le serveur lisait 5 000 000.
    clock.observe({ sentAtMs: 990, serverTimeMs: 5_000_000, receivedAtMs: 1_010 });
    expect(estimatedServerNow(clock, 2_000, 123)).toBe(5_001_000);
  });

  it('retombe sur l horloge murale avant toute mesure', () => {
    expect(estimatedServerNow(createSyncedClock(), 2_000, 123)).toBe(123);
    expect(estimatedServerNow(null, 2_000, 123)).toBe(123);
  });
});
