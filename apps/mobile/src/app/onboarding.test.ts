import { DISPLAY_NAME_MAX } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { nameHint, needsOnboarding, type StoredIdentity } from './onboarding.js';

const named = (displayName: string): StoredIdentity => ({ playerId: 'p_1', displayName });

describe('needsOnboarding', () => {
  it('accueille un joueur qui n a jamais joue', () => {
    expect(needsOnboarding(null)).toBe(true);
  });

  /**
   * Le serveur baptise les invites « Invite 4417 ». C est un nom de secours,
   * pas un choix : tant qu il n a pas ete change, on considere que le joueur
   * n a pas encore dit qui il etait.
   */
  it('propose de se nommer a qui porte encore un nom d invite', () => {
    expect(needsOnboarding(named('Invite 4417'))).toBe(true);
    expect(needsOnboarding(named('invite 9002'))).toBe(true);
  });

  it('laisse tranquille un joueur qui s est deja nomme', () => {
    expect(needsOnboarding(named('Kassim'))).toBe(false);
  });

  it('ne prend pas un vrai pseudo pour un nom d invite', () => {
    // « Invitation » commence par les memes lettres sans etre un nom de secours.
    expect(needsOnboarding(named('Invitation'))).toBe(false);
    expect(needsOnboarding(named('Inviteur'))).toBe(false);
  });
});

describe('nameHint', () => {
  it('ne reproche rien a un champ encore vide', () => {
    // Afficher une erreur avant la premiere frappe met le joueur en faute
    // pour n avoir rien fait.
    expect(nameHint('')).toBeNull();
  });

  it('accepte un nom valide sans rien dire', () => {
    expect(nameHint('Kassim')).toBeNull();
  });

  it('dit ce qui manque, pas qu il y a une erreur', () => {
    expect(nameHint('K')).toMatch(/2 caract/i);
    expect(nameHint('K'.repeat(DISPLAY_NAME_MAX + 1))).toMatch(/16/);
  });

  it('nomme le probleme quand un caractere est refuse', () => {
    expect(nameHint('Kas<b>')).toMatch(/lettres|caract/i);
  });

  it('explique les espaces doubles plutot que de les rogner en silence', () => {
    expect(nameHint('Kas  sim')).toMatch(/espace/i);
  });

  it('ignore les espaces de bord, comme le schema', () => {
    expect(nameHint('  Kassim  ')).toBeNull();
  });
});
