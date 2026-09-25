import { browserStore, type ProgressStore } from './persist.js';

/**
 * L'ecran d'accueil (« Choisis ton nom ») passe une fois pour toutes.
 *
 * Nomme ou remis a plus tard, il ne se represente pas au lancement suivant :
 * un jeu qui redemande la meme chose a chaque ouverture apprend a son joueur
 * a fermer la fenetre sans lire. Le souvenir est propre a l'appareil — le
 * nom, lui, vit sur le serveur, et se change dans le profil (`NameEditor`).
 *
 * Un stockage bloque (navigation privee) leve au lieu de rendre `null` : on
 * absorbe, et le pire qui arrive est qu'on redemande.
 */
export const GREETED_KEY = 'aura.greeted';

export function greetingStore(): ProgressStore {
  return browserStore(GREETED_KEY);
}

export function wasGreeted(store: ProgressStore): boolean {
  try {
    return store.read() === '1';
  } catch {
    return false;
  }
}

export function markGreeted(store: ProgressStore): void {
  try {
    store.write('1');
  } catch {
    // Rien a faire : on redemandera au prochain lancement.
  }
}
