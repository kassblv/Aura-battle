import { emailSchema } from '@aura/protocol';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords.js';
import { emailAttemptKey, ipBucket, maskEmail, normalizeEmail, passwordProblem } from './email.js';

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
  /*
    Le protocole compte en unites UTF-16 avant normalisation ; ce qui est
    hache, c'est la forme NFKC. « ﬁ » (une ligature) compte pour un caractere
    a la saisie et devient « fi » : c'est la longueur hachee qui compte.
  */
  it('compte la longueur apres normalisation, en caracteres', () => {
    expect(passwordProblem('😀😀😀😀', 'k@gmail.com')).toBe('TOO_SHORT');
    expect(passwordProblem('aura du soir', 'k@gmail.com')).toBeNull();
  });

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
  const KEY = 'une-cle-serveur-assez-longue';

  it('ne contient pas l adresse en clair', () => {
    const key = emailAttemptKey('kassim@gmail.com', KEY);
    expect(key).not.toContain('kassim');
    expect(key).not.toContain('gmail');
  });

  it('est stable, et identique quelle que soit la saisie', () => {
    expect(emailAttemptKey(' Kassim@Gmail.com', KEY)).toBe(
      emailAttemptKey('kassim@gmail.com', KEY),
    );
  });

  /*
    Sans cle, l'empreinte d'une adresse se retrouverait en hachant des
    adresses candidates : un journal fuite deviendrait un annuaire.
  */
  it('depend de la cle du serveur, pas seulement de l adresse', () => {
    expect(emailAttemptKey('kassim@gmail.com', KEY)).not.toBe(
      emailAttemptKey('kassim@gmail.com', 'une-autre-cle-de-serveur'),
    );
    expect(emailAttemptKey('kassim@gmail.com', KEY)).not.toContain(
      createHash('sha256').update('kassim@gmail.com').digest('hex'),
    );
  });
});

describe('ipBucket', () => {
  it('garde une adresse IPv4 telle quelle', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
  });

  it('ramene une IPv4 vue en IPv6 a son adresse IPv4', () => {
    expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  /* Un abonne IPv6 recoit un /64 entier : chaque adresse ne vaut pas un compteur. */
  it('range toute une IPv6 dans son prefixe /64', () => {
    const a = ipBucket('2001:db8:1234:5678::1');
    expect(a).toBe('2001:db8:1234:5678::/64');
    expect(ipBucket('2001:0db8:1234:5678:abcd:ef01:2345:6789')).toBe(a);
    expect(ipBucket('2001:db8:1234:5679::1')).not.toBe(a);
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
  });

  it('refuse une adresse absente ou illisible plutot que de la partager', () => {
    expect(ipBucket(undefined)).toBeNull();
    expect(ipBucket('')).toBeNull();
    expect(ipBucket('pas une ip')).toBeNull();
  });
});
