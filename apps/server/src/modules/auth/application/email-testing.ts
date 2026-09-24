import { EmailIdentityConflictError } from '../domain/ports.js';
import type {
  EmailIdentityRecord,
  EmailIdentityRepository,
  PasswordHasher,
  PlayerRecord,
} from '../domain/ports.js';

/**
 * Doubles du service email, partages par ses tests et ceux du controleur.
 *
 * Deux copies de ces doubles finiraient par dire deux choses differentes du
 * contrat — et les tests qui s'appuient sur l'une ou l'autre ne se
 * contrediraient jamais, puisqu'ils ne se voient pas.
 */

/**
 * Hachage factice : lisible et rapide, mais qui garde la forme d'un vrai.
 * Il compte ses appels — c'est par la qu'on voit le hachage factice d'une
 * adresse inconnue.
 */
export function fakePasswordHasher() {
  const calls = { hash: 0, verify: 0, verifiedAgainst: [] as string[] };
  const hasher: PasswordHasher = {
    hash: (password) => {
      calls.hash++;
      return Promise.resolve(`h(${password})`);
    },
    verify: (hash, password) => {
      calls.verify++;
      calls.verifiedAgainst.push(hash);
      return Promise.resolve(hash === `h(${password})`);
    },
  };
  return { hasher, calls };
}

/** Depot en memoire, fidele au contrat : une adresse par joueur, un joueur par adresse. */
export function memoryEmailIdentities(players: readonly PlayerRecord[]) {
  const rows: EmailIdentityRecord[] = [];
  /** Identites DEVICE : empreinte du secret -> joueur. */
  const devices = new Map<string, string>();
  const port: EmailIdentityRepository = {
    findById: (id) => Promise.resolve(players.find((p) => p.id === id) ?? null),
    findByEmail: (email) => Promise.resolve(rows.find((r) => r.email === email) ?? null),
    findEmailOf: (playerId) => Promise.resolve(rows.find((r) => r.playerId === playerId) ?? null),
    linkEmailIdentity: (playerId, email, secretHash) => {
      if (rows.some((r) => r.playerId === playerId)) return Promise.resolve('ALREADY_LINKED');
      if (rows.some((r) => r.email === email)) {
        return Promise.reject(new EmailIdentityConflictError());
      }
      rows.push({ playerId, email, secretHash });
      return Promise.resolve('LINKED');
    },
    setPasswordHash: (playerId, secretHash, keepDeviceHash) => {
      const index = rows.findIndex((r) => r.playerId === playerId);
      if (index < 0) return Promise.resolve(false);
      rows[index] = { ...rows[index]!, secretHash };
      for (const [hash, owner] of devices) {
        if (owner === playerId && hash !== keepDeviceHash) devices.delete(hash);
      }
      return Promise.resolve(true);
    },
  };
  return { rows, devices, port };
}
