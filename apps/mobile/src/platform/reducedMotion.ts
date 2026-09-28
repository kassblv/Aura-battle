/**
 * Preference systeme « moins d animation ».
 *
 * Le prototype la lit une fois au chargement. Sur mobile, le reglage peut
 * changer pendant que l application dort en arriere-plan : on le suit donc en
 * continu plutot que de le figer au demarrage.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Le strict necessaire d un `MediaQueryList`, pour pouvoir le simuler. */
export interface MediaQueryLike {
  matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

export interface MediaMatcher {
  matchMedia(query: string): MediaQueryLike;
}

export interface ReducedMotionWatcher {
  /** Vrai si l utilisateur demande moins d animation. */
  readonly reduced: boolean;
  /** Renvoie la fonction de desabonnement. */
  subscribe(listener: (reduced: boolean) => void): () => void;
  dispose(): void;
}

/** Renvoie l objet global s il sait repondre aux media queries, sinon `null`. */
export function defaultMatcher(): MediaMatcher | null {
  const candidate = globalThis as Partial<MediaMatcher>;
  return typeof candidate.matchMedia === 'function' ? (candidate as MediaMatcher) : null;
}

export function watchReducedMotion(
  matcher: MediaMatcher | null = defaultMatcher(),
): ReducedMotionWatcher {
  const listeners = new Set<(reduced: boolean) => void>();
  // Hors navigateur (tests, rendu serveur), on suppose le mouvement autorise :
  // c est le comportement par defaut du prototype.
  const query = matcher?.matchMedia(REDUCED_MOTION_QUERY) ?? null;
  let reduced = query?.matches ?? false;

  const onChange = (event: { matches: boolean }): void => {
    reduced = event.matches;
    for (const listener of [...listeners]) {
      listener(reduced);
    }
  };
  query?.addEventListener('change', onChange);

  return {
    get reduced(): boolean {
      return reduced;
    },

    subscribe(listener: (reduced: boolean) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      listeners.clear();
      query?.removeEventListener('change', onChange);
    },
  };
}
