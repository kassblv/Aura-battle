/**
 * Le secret d'administration, garde le temps de l'onglet.
 *
 * `sessionStorage` et jamais `localStorage` : le secret disparait avec
 * l'onglet, ce qui est le bon comportement pour la cle la plus precieuse du
 * systeme (ADR 0018) sur une machine qui peut etre partagee. Chaque acces est
 * protege : un stockage bloque (navigation privee stricte) ne doit pas faire
 * tomber le panneau, seulement demander le secret a chaque rechargement.
 */

export const SESSION_KEY = 'aura.admin';

export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): SessionStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readToken(store: SessionStore | null = defaultStore()): string | null {
  try {
    const value = store?.getItem(SESSION_KEY) ?? null;
    return value === null || value === '' ? null : value;
  } catch {
    return null;
  }
}

export function saveToken(token: string, store: SessionStore | null = defaultStore()): void {
  try {
    store?.setItem(SESSION_KEY, token);
  } catch {
    // Stockage refuse : le secret vit en memoire le temps de la page.
  }
}

export function clearToken(store: SessionStore | null = defaultStore()): void {
  try {
    store?.removeItem(SESSION_KEY);
  } catch {
    // Rien a effacer si le stockage est inaccessible.
  }
}
