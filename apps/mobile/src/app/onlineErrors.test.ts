import { describe, expect, it } from 'vitest';
import { onlineErrorText } from './onlineErrors.js';

describe('onlineErrorText', () => {
  /*
    Le verrouillage a eu lieu, avec la pose offerte de la case : rien a
    corriger pour le joueur. Rangee comme une erreur, elle s'affichait plus
    tard sur l'ecran d'invitation, hors contexte et en texte technique.
  */
  it('ne fait pas une erreur de l avertissement de pose', () => {
    expect(
      onlineErrorText('COSMETIC_NOT_OWNED', 'pose non possedee, pose offerte jouee'),
    ).toBeNull();
  });

  it('laisse passer les autres refus tels que le serveur les formule', () => {
    expect(onlineErrorText('INVITE_NOT_FOUND', 'Code introuvable')).toBe('Code introuvable');
  });
});
