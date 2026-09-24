import { describe, expect, it } from 'vitest';
import { describeCause, describeErrorKind, MAX_CAUSE_CHARS } from './describe-cause.js';

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

/**
 * Plus strict encore : le nom et le code, sans une ligne du message. Pour les
 * chemins ou le message ne sert a rien et peut tout recopier — l'ecriture d'un
 * achat, par exemple, ou il porterait l'identifiant du joueur et de l'objet.
 */
describe('describeErrorKind', () => {
  it('garde le nom et le code, rien du message', () => {
    const error = Object.assign(new Error('insert into "InventoryItem" values (p-1)'), {
      code: 'P1001',
    });
    error.name = 'PrismaClientKnownRequestError';

    expect(describeErrorKind(error)).toBe('PrismaClientKnownRequestError [P1001]');
  });

  it('se contente du nom sans code', () => {
    expect(describeErrorKind(new TypeError('p-1 est indefini'))).toBe('TypeError');
  });

  it('ne recopie rien de ce qui n est pas une erreur', () => {
    expect(describeErrorKind({ token: 'secret' })).toBe('cause inconnue');
  });

  /* Un code maison peut, lui aussi, etre ecrit a partir des donnees. */
  it('ignore un code qui n est pas une constante courte', () => {
    const error = Object.assign(new Error('x'), { code: 'player p-1 introuvable' });
    expect(describeErrorKind(error)).toBe('Error');
  });
});
