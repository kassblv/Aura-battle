import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { MatchClock, TimerScheduler } from '../domain/ports.js';

/**
 * Echeances de phase, sur `setTimeout`.
 *
 * Une seule echeance vivante par match : programmer la suivante annule la
 * precedente. Sans cela, un match qui enchaine les phases accumulerait des
 * minuteurs orphelins qui se declencheraient sur un etat depasse.
 */
@Injectable()
export class TimeoutScheduler implements TimerScheduler, OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  schedule(key: string, atMs: number, run: () => void): void {
    this.cancel(key);
    // Une echeance deja passee se declenche au prochain tour de boucle plutot
    // que jamais : un serveur charge ne doit pas bloquer une manche.
    const delay = Math.max(0, atMs - Date.now());
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        run();
      }, delay),
    );
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /** A l'arret du serveur, aucun minuteur ne doit retenir le processus. */
  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

/** Horloge systeme, en millisecondes depuis l'epoque. */
@Injectable()
export class SystemMatchClock implements MatchClock {
  now(): number {
    return Date.now();
  }
}
