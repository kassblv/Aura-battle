import { describe, expect, it } from 'vitest';
import { inviteFromUrl, INVITE_PATH } from './deepLink.js';

describe('inviteFromUrl', () => {
  it('lit le code d un lien d invitation', () => {
    expect(inviteFromUrl('https://aura.example/duel/AB12CD')).toBe('AB12CD');
  });

  it('accepte le meme chemin en local', () => {
    expect(inviteFromUrl('http://localhost:5173/duel/XYZ789')).toBe('XYZ789');
  });

  /**
   * Un lien se recopie a la main, se colle depuis une conversation, se tape au
   * clavier. Accepter les minuscules et une barre finale evite d'envoyer le
   * joueur sur un ecran vide pour une raison qu'il ne verra jamais.
   */
  it('pardonne la casse et la barre finale', () => {
    expect(inviteFromUrl('https://aura.example/duel/ab12cd/')).toBe('AB12CD');
  });

  it('ignore les espaces autour', () => {
    expect(inviteFromUrl('  https://aura.example/duel/AB12CD  ')).toBe('AB12CD');
  });

  it('ne rend rien pour une page ordinaire', () => {
    expect(inviteFromUrl('https://aura.example/')).toBeNull();
    expect(inviteFromUrl('https://aura.example/boutique')).toBeNull();
  });

  /**
   * Le code respecte le meme format que le protocole, et il est verifie ICI
   * plutot qu'au moment de l'envoi : un lien trafique ne doit pas devenir un
   * message que le serveur devra refuser.
   */
  it('refuse ce qui n est pas un code', () => {
    expect(inviteFromUrl('https://aura.example/duel/ab')).toBeNull();
    expect(inviteFromUrl('https://aura.example/duel/../../etc/passwd')).toBeNull();
    expect(inviteFromUrl('https://aura.example/duel/' + 'A'.repeat(64))).toBeNull();
    expect(inviteFromUrl('https://aura.example/duel/')).toBeNull();
  });

  it('ne se laisse pas avoir par une adresse illisible', () => {
    expect(inviteFromUrl('pas une adresse')).toBeNull();
    expect(inviteFromUrl('')).toBeNull();
  });

  /** Le chemin est partage avec le serveur de liens : une seule constante. */
  it('expose le chemin qu il reconnait', () => {
    expect(INVITE_PATH).toBe('/duel/');
  });
});
