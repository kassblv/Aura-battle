import { describe, expect, it } from 'vitest';
import { TokenBucket } from './rate-limit.js';

describe('TokenBucket — limite de debit par socket', () => {
  it('laisse passer jusqu a la capacite', () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    for (let i = 0; i < 5; i += 1) {
      expect(bucket.tryConsume(0)).toBe(true);
    }
  });

  it('refuse une fois la capacite epuisee', () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 });
    for (let i = 0; i < 3; i += 1) bucket.tryConsume(0);
    expect(bucket.tryConsume(0)).toBe(false);
  });

  it('se recharge avec le temps', () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 10 });
    bucket.tryConsume(0);
    bucket.tryConsume(0);
    expect(bucket.tryConsume(0)).toBe(false);
    // 10 jetons par seconde : 100 ms suffisent pour en regagner un.
    expect(bucket.tryConsume(100)).toBe(true);
  });

  it('ne se recharge jamais au-dela de sa capacite', () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 100 });
    bucket.tryConsume(0);
    bucket.tryConsume(0);
    // Une heure d'inactivite ne donne pas droit a une rafale illimitee.
    expect(bucket.tryConsume(3_600_000)).toBe(true);
    expect(bucket.tryConsume(3_600_000)).toBe(true);
    expect(bucket.tryConsume(3_600_000)).toBe(false);
  });

  it('ignore une horloge qui recule', () => {
    // Deux messages horodates en desordre ne doivent pas creer de jetons.
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1 });
    expect(bucket.tryConsume(1_000)).toBe(true);
    expect(bucket.tryConsume(0)).toBe(false);
  });

  it('accepte de consommer plusieurs jetons d un coup', () => {
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 });
    expect(bucket.tryConsume(0, 6)).toBe(true);
    expect(bucket.tryConsume(0, 6)).toBe(false);
    expect(bucket.tryConsume(0, 4)).toBe(true);
  });

  it('rend le nombre de jetons restants', () => {
    const bucket = new TokenBucket({ capacity: 4, refillPerSecond: 1 });
    bucket.tryConsume(0);
    expect(bucket.remaining(0)).toBe(3);
  });
});

describe('TokenBucket — reglages du protocole', () => {
  it('encaisse une rafale de taps sans bloquer un joueur honnete', () => {
    // docs/03 : envoi groupe toutes les 500 ms, plus les messages de choix et
    // les ping. Un joueur normal reste tres en dessous de la limite.
    const bucket = new TokenBucket({ capacity: 30, refillPerSecond: 15 });
    let accepte = 0;
    for (let ms = 0; ms < 10_000; ms += 500) {
      if (bucket.tryConsume(ms)) accepte += 1;
    }
    expect(accepte).toBe(20);
  });

  it('coupe un client qui inonde la socket', () => {
    const bucket = new TokenBucket({ capacity: 30, refillPerSecond: 15 });
    let refuse = 0;
    for (let i = 0; i < 200; i += 1) {
      if (!bucket.tryConsume(0)) refuse += 1;
    }
    expect(refuse).toBe(170);
  });
});
