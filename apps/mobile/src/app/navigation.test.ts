import { describe, expect, it } from 'vitest';
import { canLeave, navigate, openingScreen, type Navigation } from './navigation.js';

const at = (screen: Navigation['screen'], matchRunning = false): Navigation => ({
  screen,
  matchRunning,
});

describe('openingScreen', () => {
  it('ouvre sur l accueil, pas sur un match', () => {
    // Un jeu qui demarre dans une partie qu on n a pas demandee vole le
    // premier geste du joueur.
    expect(openingScreen()).toEqual({ screen: 'home', matchRunning: false });
  });
});

describe('navigate', () => {
  it('va de l accueil au profil et en revient', () => {
    expect(navigate(at('home'), 'profile').screen).toBe('profile');
    expect(navigate(at('profile'), 'home').screen).toBe('home');
  });

  it('marque le match comme en cours quand on le lance', () => {
    expect(navigate(at('home'), 'match')).toEqual({ screen: 'match', matchRunning: true });
  });

  it('rend la main a l accueil une fois le match fini', () => {
    expect(navigate(at('match', true), 'home')).toEqual({ screen: 'home', matchRunning: false });
  });

  /**
   * Regle d or n°3 : un cosmetique ne touche jamais un score. On ferme donc la
   * porte au moment ou la question pourrait se poser — et accessoirement, un
   * panneau de vestiaire en pleine manche recouvrirait les commandes.
   */
  it('refuse d ouvrir le vestiaire pendant une manche', () => {
    const during = at('match', true);
    expect(navigate(during, 'wardrobe')).toBe(during);
  });

  it('laisse le vestiaire ouvert depuis l accueil et le profil', () => {
    expect(navigate(at('home'), 'wardrobe').screen).toBe('wardrobe');
    expect(navigate(at('profile'), 'wardrobe').screen).toBe('wardrobe');
  });

  it('ne fabrique pas un nouvel etat pour un ecran deja affiche', () => {
    const state = at('profile');
    expect(navigate(state, 'profile')).toBe(state);
  });
});

describe('canLeave', () => {
  it('retient le joueur pendant une manche', () => {
    // Quitter en pleine manche, c est un forfait : cela se demande, cela ne se
    // fait pas d un appui de travers sur un bouton de navigation.
    expect(canLeave(at('match', true))).toBe(false);
  });

  it('laisse partir partout ailleurs', () => {
    expect(canLeave(at('home'))).toBe(true);
    expect(canLeave(at('profile'))).toBe(true);
    expect(canLeave(at('wardrobe'))).toBe(true);
    expect(canLeave(at('match', false))).toBe(true);
  });
});
