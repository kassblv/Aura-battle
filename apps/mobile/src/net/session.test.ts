import { describe, expect, it } from 'vitest';
import type { SecretStore } from './identity.js';
import { loadIdentity, saveIdentity, SESSION_KEY } from './session.js';

function store(initial: Record<string, string> = {}): SecretStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value);
    },
  };
}

const identity = { playerId: 'p_1', displayName: 'Kassim' };

describe('saveIdentity et loadIdentity', () => {
  it('conserve l identite d un lancement a l autre', () => {
    const keychain = store();
    saveIdentity(identity, keychain);
    expect(loadIdentity(keychain)).toEqual(identity);
  });

  it('rend null quand rien n a ete range', () => {
    expect(loadIdentity(store())).toBeNull();
  });

  /**
   * Une identite illisible est traitee comme absente, pas comme une erreur.
   *
   * Migration, ecriture partielle, bidouille manuelle : dans tous les cas la
   * bonne reponse est de redemander au serveur, pas de refuser de demarrer.
   */
  it('ignore une identite corrompue', () => {
    expect(loadIdentity(store({ [SESSION_KEY]: 'pas du json' }))).toBeNull();
    expect(loadIdentity(store({ [SESSION_KEY]: '{"playerId":42}' }))).toBeNull();
    expect(loadIdentity(store({ [SESSION_KEY]: '{"displayName":"Kassim"}' }))).toBeNull();
  });

  /**
   * On ne range **pas** les jetons.
   *
   * Le jeton d acces expire en quinze minutes et se rachete avec le secret
   * d appareil, qui lui est deja au chaud. Le poser en plus dans le stockage du
   * navigateur ajoute une copie a voler sans rien faire gagner.
   */
  it('ne range jamais de jeton', () => {
    const keychain = store();
    saveIdentity({ ...identity }, keychain);
    const raw = keychain.map.get(SESSION_KEY) ?? '';
    expect(raw).not.toMatch(/token/i);
    expect(raw).toContain('Kassim');
  });

  it('survit a un stockage qui refuse d ecrire', () => {
    const failing: SecretStore = {
      read: () => null,
      write: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveIdentity(identity, failing)).not.toThrow();
  });

  it('survit a un stockage qui refuse de lire', () => {
    const failing: SecretStore = {
      read: () => {
        throw new Error('bloque');
      },
      write: () => undefined,
    };
    expect(loadIdentity(failing)).toBeNull();
  });
});
