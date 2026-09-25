import { msUntilVerdictPanel } from '../arena/round.js';

/**
 * Le rendu qui fait tomber le verdict de la manche.
 *
 * `verdictPanelShown` se lit a l'horloge au moment du rendu, et rien d'autre
 * ne rafraichit l'ecran pendant la revelation : sans ce rendu programme, le
 * verdict n'apparaissait qu'en fin de match.
 *
 * Un minuteur peut tomber une fraction de milliseconde avant l'instant vise
 * (delai fractionnaire arrondi) : on revérifie donc au declenchement, et on
 * reprogramme si le verdict n'est pas encore du.
 */
export interface Timers {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function scheduleVerdictRender(
  read: () => { readonly phase: string; readonly inPhaseMs: number },
  render: () => void,
  timers: Timers = browserTimers,
): () => void {
  let handle: unknown = null;
  const delayNow = (): number | null => {
    const { phase, inPhaseMs } = read();
    return msUntilVerdictPanel(phase, inPhaseMs);
  };
  const arm = (delay: number): void => {
    handle = timers.set(fire, Math.ceil(delay) + 1);
  };
  function fire(): void {
    const delay = delayNow();
    if (delay === null) render();
    else arm(delay);
  }
  const first = delayNow();
  if (first !== null) arm(first);
  return () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
}
