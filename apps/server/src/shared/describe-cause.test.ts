import { describe, expect, it } from 'vitest';
import { describeCause, MAX_CAUSE_CHARS } from './describe-cause.js';

/**
 * Ce qu'un journal a le droit de recopier d'une erreur.
 *
 * Ce resume existe parce qu'une erreur de Prisma reproduit les **arguments
 * refuses** dans son message et dans sa pile : la journaliser telle quelle
 * publierait ce qu'on venait d'essayer d'ecrire. La regle est la meme partout
 * ailleurs, d'ou ce module partage plutot qu'une seconde version par appelant.
 */
describe('describeCause', () => {
  it('garde le nom et la premiere ligne du message', () => {
    const error = new Error('table introuvable');
    error.name = 'PrismaClientKnownRequestError';

    expect(describeCause(error)).toBe('PrismaClientKnownRequestError: table introuvable');
  });

  /**
   * Les messages de Prisma commencent par un saut de ligne et deroulent
   * ensuite l'appel fautif, argument par argument. Tout ce qui suit la
   * premiere ligne est donc precisement ce qu'on ne veut pas ecrire.
   */
  it('coupe tout ce qui suit la premiere ligne', () => {
    const error = new Error(
      'Invalid `prisma.match.create()` invocation\n  seed: "graine-secrete",\n  events: [...]',
    );

    const resume = describeCause(error);

    expect(resume).not.toContain('graine-secrete');
    expect(resume).not.toContain('\n');
  });

  it('tronque une premiere ligne trop longue', () => {
    const error = new Error('x'.repeat(5_000));

    expect(describeCause(error).length).toBeLessThanOrEqual(MAX_CAUSE_CHARS + 'Error: '.length);
  });

  /**
   * Le code d'erreur passe entier : c'est une constante du client Prisma, il
   * ne peut rien recopier de ce qu'on ecrivait, et sans lui le resume d'une
   * erreur dont le message commence par un saut de ligne serait vide.
   */
  it('conserve le code d erreur quand il y en a un', () => {
    const error: Error & { code?: string } = new Error('\n  contrainte violee');
    error.name = 'PrismaClientKnownRequestError';
    error.code = 'P2002';

    expect(describeCause(error)).toContain('[P2002]');
  });

  /** Une promesse rejetee peut porter n'importe quoi, y compris un objet. */
  it('ne recopie rien de ce qui n est pas une erreur', () => {
    expect(describeCause({ token: 'secret' })).toBe('cause inconnue');
    expect(describeCause('mot de passe')).toBe('cause inconnue');
    expect(describeCause(null)).toBe('cause inconnue');
  });
});
