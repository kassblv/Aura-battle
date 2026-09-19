import { describe, expect, it } from 'vitest';
import { readBearer } from './bearer.js';

describe('readBearer', () => {
  it('lit un en-tete bien forme', () => {
    expect(readBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepte la casse du schema : les clients HTTP ne s accordent pas dessus', () => {
    expect(readBearer('bearer abc')).toBe('abc');
    expect(readBearer('BEARER abc')).toBe('abc');
  });

  it('refuse un en-tete absent', () => {
    expect(readBearer(undefined)).toBeNull();
    expect(readBearer('')).toBeNull();
  });

  it('refuse un autre schema d authentification', () => {
    // `Basic` porte un couple identifiant/mot de passe : le lire comme un
    // jeton enverrait un mot de passe au verificateur, et donc au journal.
    expect(readBearer('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('refuse un schema sans jeton', () => {
    expect(readBearer('Bearer')).toBeNull();
    expect(readBearer('Bearer    ')).toBeNull();
  });

  it('refuse un en-tete a rallonge', () => {
    // Un jeton signe tient tres largement sous 4 Ko ; au-dela, c est un abus.
    expect(readBearer(`Bearer ${'a'.repeat(5000)}`)).toBeNull();
  });

  it('refuse un jeton contenant un espace', () => {
    // Deux valeurs collees, ou un en-tete injecte : dans les deux cas on ne
    // sait pas laquelle verifier, et deviner serait pire que refuser.
    expect(readBearer('Bearer abc def')).toBeNull();
  });

  it('accepte un en-tete recu plusieurs fois, en prenant le premier', () => {
    expect(readBearer(['Bearer abc', 'Bearer xyz'])).toBe('abc');
  });

  it('refuse une valeur qui n est pas une chaine', () => {
    expect(readBearer(42 as unknown as string)).toBeNull();
  });
});
