import { describe, expect, it } from 'vitest';
import { DEVICE_SECRET_KEY, deviceSecret, type SecretStore } from './identity.js';

/** Trousseau en memoire : le vrai est le stockage de l appareil. */
function store(
  initial: Record<string, string> = {},
): SecretStore & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value);
    },
  };
}

/** Generateur previsible : les octets deviennent verifiables. */
const bytes = (fill: number) => (length: number) => new Uint8Array(length).fill(fill);

describe('deviceSecret', () => {
  it('tire un secret au format que le serveur attend', () => {
    const secret = deviceSecret(store(), bytes(0xab));
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('le range pour les lancements suivants', () => {
    const keychain = store();
    const first = deviceSecret(keychain, bytes(0x01));
    expect(keychain.map.get(DEVICE_SECRET_KEY)).toBe(first);
  });

  /**
   * Un secret regenere est un compte perdu.
   *
   * Il vaut mot de passe : c est lui, et lui seul, qui rattache l appareil a un
   * joueur. En retirer un nouveau au deuxieme lancement creerait un second
   * compte vide, et le premier — avec ses cosmetiques et son classement —
   * deviendrait inaccessible.
   */
  it('ne regenere jamais un secret deja range', () => {
    const keychain = store();
    const first = deviceSecret(keychain, bytes(0x01));
    const second = deviceSecret(keychain, bytes(0x02));
    expect(second).toBe(first);
  });

  it('remplace un secret range illisible', () => {
    // Stockage corrompu, ecriture partielle, migration rateee : un secret qui
    // ne respecte pas le format serait refuse a chaque connexion, pour
    // toujours. Mieux vaut repartir que rester bloque dehors.
    const keychain = store({ [DEVICE_SECRET_KEY]: 'pas-un-secret' });
    const secret = deviceSecret(keychain, bytes(0x0f));
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toBe('pas-un-secret');
  });

  it('refuse un secret trop court range par erreur', () => {
    const keychain = store({ [DEVICE_SECRET_KEY]: 'abcdef' });
    expect(deviceSecret(keychain, bytes(0x0f))).toHaveLength(64);
  });

  it('survit a un stockage qui refuse d ecrire', () => {
    // Navigation privee, quota plein : on joue quand meme, le compte sera
    // simplement celui d une session.
    const failing: SecretStore = {
      read: () => null,
      write: () => {
        throw new Error('quota');
      },
    };
    expect(() => deviceSecret(failing, bytes(0x22))).not.toThrow();
  });

  it('survit a un stockage qui refuse de lire', () => {
    const failing: SecretStore = {
      read: () => {
        throw new Error('bloque');
      },
      write: () => undefined,
    };
    expect(deviceSecret(failing, bytes(0x22))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tire des secrets differents pour des appareils differents', () => {
    expect(deviceSecret(store(), bytes(0x01))).not.toBe(deviceSecret(store(), bytes(0x02)));
  });
});
