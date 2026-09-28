import { describe, expect, it, vi } from 'vitest';
import type { MediaMatcher, MediaQueryLike } from './reducedMotion.js';
import { REDUCED_MOTION_QUERY, watchReducedMotion } from './reducedMotion.js';

/** Faux media query, pilotable a la main. */
function fakeMatcher(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const query: MediaQueryLike = {
    matches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const asked: string[] = [];
  const matcher: MediaMatcher = {
    matchMedia: (q) => {
      asked.push(q);
      return query;
    },
  };
  return {
    matcher,
    asked,
    listeners,
    emit(next: boolean) {
      query.matches = next;
      for (const listener of [...listeners]) listener({ matches: next });
    },
  };
}

describe('watchReducedMotion', () => {
  it('interroge la media query standard', () => {
    const fake = fakeMatcher(false);
    watchReducedMotion(fake.matcher);
    expect(fake.asked).toEqual([REDUCED_MOTION_QUERY]);
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('reflete la preference au demarrage', () => {
    expect(watchReducedMotion(fakeMatcher(true).matcher).reduced).toBe(true);
    expect(watchReducedMotion(fakeMatcher(false).matcher).reduced).toBe(false);
  });

  // L app peut passer en arriere-plan pendant que le reglage systeme change.
  it('suit le reglage quand il change en cours de route', () => {
    const fake = fakeMatcher(false);
    const watcher = watchReducedMotion(fake.matcher);
    const seen = vi.fn();
    watcher.subscribe(seen);

    fake.emit(true);

    expect(watcher.reduced).toBe(true);
    expect(seen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('laisse se desabonner', () => {
    const fake = fakeMatcher(false);
    const watcher = watchReducedMotion(fake.matcher);
    const seen = vi.fn();
    watcher.subscribe(seen)();
    fake.emit(true);
    expect(seen).not.toHaveBeenCalled();
  });

  it('lache la media query quand on le libere', () => {
    const fake = fakeMatcher(false);
    watchReducedMotion(fake.matcher).dispose();
    expect(fake.listeners.size).toBe(0);
  });

  // Tests et rendu serveur tournent sans DOM : on ne doit pas planter.
  it('suppose le mouvement autorise quand il n y a pas de media query', () => {
    const watcher = watchReducedMotion(null);
    expect(watcher.reduced).toBe(false);
    expect(() => watcher.subscribe(vi.fn())()).not.toThrow();
    expect(() => watcher.dispose()).not.toThrow();
  });
});
