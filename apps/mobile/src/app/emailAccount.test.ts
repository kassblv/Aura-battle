import { PASSWORD_MIN } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { FORGOT_PASSWORD_HINT, emailFailureMessage, emailFormProblem } from './emailAccount.js';

describe('emailFormProblem', () => {
  const good = { email: 'kassim@gmail.com', password: 'aura du dimanche' };

  it('ne dit rien d un formulaire correct', () => {
    expect(emailFormProblem('link', { ...good, confirm: good.password })).toBeNull();
    expect(emailFormProblem('login', good)).toBeNull();
  });

  /*
    Un champ vide ne recoit pas d erreur : afficher « adresse invalide » avant
    la premiere frappe met le joueur en faute pour n avoir rien fait. Le bouton
    reste simplement inactif.
  */
  it('ne reproche rien a un formulaire encore vide', () => {
    expect(emailFormProblem('link', { email: '', password: '', confirm: '' })).toBeNull();
  });

  it('signale une adresse mal formee', () => {
    expect(emailFormProblem('login', { ...good, email: 'kassim' })).toMatch(/adresse/i);
  });

  it('cite la longueur minimale depuis la constante partagee', () => {
    expect(emailFormProblem('link', { ...good, password: 'court', confirm: 'court' })).toContain(
      String(PASSWORD_MIN),
    );
  });

  /*
    A la connexion, la longueur n'est pas verifiee : un mot de passe choisi
    sous une ancienne regle doit encore passer.
  */
  it('n applique pas la longueur a la connexion', () => {
    expect(emailFormProblem('login', { ...good, password: 'court' })).toBeNull();
  });

  it('exige une confirmation identique quand on choisit un mot de passe', () => {
    expect(emailFormProblem('link', { ...good, confirm: 'autre chose' })).toMatch(/identiques/i);
    expect(emailFormProblem('change', { ...good, confirm: 'autre chose' })).toMatch(/identiques/i);
  });

  it('refuse l adresse comme mot de passe avant l aller-retour', () => {
    expect(
      emailFormProblem('link', {
        ...good,
        password: 'Kassim@Gmail.com',
        confirm: 'Kassim@Gmail.com',
      }),
    ).toMatch(/adresse/i);
  });
});

describe('emailFailureMessage', () => {
  it('dit la meme chose pour une adresse inconnue et un mauvais mot de passe', () => {
    // Le serveur ne distingue pas les deux ; l interface non plus.
    expect(emailFailureMessage('INVALID_CREDENTIALS')).toMatch(/email ou mot de passe/i);
  });

  it('renvoie vers le code de recuperation quand la porte est fermee', () => {
    expect(emailFailureMessage('TOO_MANY_ATTEMPTS')).toMatch(/code de récupération/);
  });

  it('a un message pour chaque refus que le serveur sait dire', () => {
    for (const code of [
      'EMAIL_UNAVAILABLE',
      'EMAIL_ALREADY_LINKED',
      'EMAIL_NOT_LINKED',
      'PASSWORD_TOO_COMMON',
      'PASSWORD_MATCHES_EMAIL',
      'PASSWORD_TOO_SHORT',
      'PASSWORD_REQUIRED',
      'RECOVERY_CODE_TOO_RECENT',
      'BUSY',
      'UNREACHABLE',
    ]) {
      expect(emailFailureMessage(code)).not.toBe(emailFailureMessage('???'));
    }
  });
});

describe('FORGOT_PASSWORD_HINT', () => {
  // Aucun courrier ne part jamais : le code est la seule porte de secours, et
  // le joueur doit l apprendre a l endroit ou il bute.
  it('renvoie vers le code de recuperation', () => {
    expect(FORGOT_PASSWORD_HINT).toBe('Mot de passe oublié ? Utilise ton code de récupération.');
  });
});
