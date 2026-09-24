import { emailSchema } from '@aura/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords.js';
import { emailAttemptKey, maskEmail, normalizeEmail, passwordProblem } from './email.js';

describe('normalizeEmail', () => {
  it('rogne et met en minuscules', () => {
    expect(normalizeEmail('  Kassim@Gmail.COM ')).toBe('kassim@gmail.com');
  });

  /*
    Le schema du protocole normalise deja, et le domaine ne doit pas dire
    autre chose : si les deux divergeaient, l'adresse rangee a la liaison et
    celle cherchee a la connexion ne seraient plus la meme chaine.
  */
  it('dit la meme chose que le schema du protocole', () => {
    fc.assert(
      fc.property(fc.emailAddress(), fc.boolean(), (email, shout) => {
        const typed = ` ${shout ? email.toUpperCase() : email} `;
        const parsed = emailSchema.safeParse(typed);
        if (parsed.success) expect(normalizeEmail(typed)).toBe(parsed.data);
      }),
    );
  });
});

describe('maskEmail', () => {
  it('garde la premiere lettre et le domaine', () => {
    expect(maskEmail('kassim@gmail.com')).toBe('k•••@gmail.com');
  });

  it('ne revele pas la longueur de la partie locale', () => {
    expect(maskEmail('k@gmail.com')).toBe('k•••@gmail.com');
    expect(maskEmail('kassimpiscine@gmail.com')).toBe('k•••@gmail.com');
  });

  it('ne rend jamais l adresse entiere', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const local = email.slice(0, email.lastIndexOf('@'));
        if (local.length > 1) expect(maskEmail(email)).not.toContain(local);
      }),
    );
  });
});

describe('passwordProblem', () => {
  it('accepte une phrase de passe', () => {
    expect(passwordProblem('aura du dimanche soir', 'k@gmail.com')).toBeNull();
  });

  it('refuse les mots de passe les plus courants, quelle que soit la casse', () => {
    expect(passwordProblem('password', 'k@gmail.com')).toBe('TOO_COMMON');
    expect(passwordProblem('Azertyuiop', 'k@gmail.com')).toBe('TOO_COMMON');
    expect(passwordProblem('12345678', 'k@gmail.com')).toBe('TOO_COMMON');
  });

  it('refuse le nom du jeu, premier essai de qui vise ses joueurs', () => {
    expect(passwordProblem('aurabattle', 'k@gmail.com')).toBe('TOO_COMMON');
  });

  it('refuse l adresse elle-meme, ou sa partie locale', () => {
    expect(passwordProblem('kassim@gmail.com', 'kassim@gmail.com')).toBe('MATCHES_EMAIL');
    expect(passwordProblem('KASSIMPISCINE', 'kassimpiscine@gmail.com')).toBe('MATCHES_EMAIL');
  });

  /*
    La liste doit etre utile : un mot de passe de moins de huit caracteres est
    deja refuse par le protocole, donc une entree plus courte n'y protege de
    rien et ne fait que gonfler le fichier.
  */
  it('ne contient que des entrees que la longueur minimale laisserait passer', () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(200);
    for (const entry of COMMON_PASSWORDS) {
      expect(entry.length).toBeGreaterThanOrEqual(8);
      expect(entry).toBe(entry.toLowerCase());
    }
  });
});

describe('emailAttemptKey', () => {
  /*
    La cle du compteur de tentatives vit dans Redis, qui n'est pas la base des
    joueurs : on n'y recopie pas d'adresses. Une empreinte suffit a compter.
  */
  it('ne contient pas l adresse en clair', () => {
    const key = emailAttemptKey('kassim@gmail.com');
    expect(key).not.toContain('kassim');
    expect(key).not.toContain('gmail');
  });

  it('est stable, et identique quelle que soit la saisie', () => {
    expect(emailAttemptKey(' Kassim@Gmail.com')).toBe(emailAttemptKey('kassim@gmail.com'));
  });
});
