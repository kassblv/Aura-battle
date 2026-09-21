import { useSyncExternalStore } from 'react';

/**
 * La largeur de la fenetre, relue quand elle change.
 *
 * `useSyncExternalStore` plutot qu un `useState` plus un `useEffect` : la
 * valeur est lue au moment du rendu, donc le premier rendu porte deja la vraie
 * largeur. Avec un effet, le panneau apparaitrait une image a la largeur
 * plancher avant de sauter a la sienne — un sursaut a l ouverture de la
 * boutique, a chaque ouverture.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  // Sur iOS, une rotation ne declenche pas toujours `resize` au bon moment :
  // l evenement d orientation, lui, arrive a coup sur.
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    // Hors navigateur, zero : `panelLayout` en fait sa largeur plancher.
    () => 0,
  );
}
