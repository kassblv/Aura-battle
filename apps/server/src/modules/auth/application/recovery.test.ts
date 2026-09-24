import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../domain/recovery.js';
import { RecoveryError, RecoveryService } from './recovery.js';
import type { PlayerRecord } from '../domain/ports.js';

/** Depot en memoire : le service se teste sans base. */
function repository(players: PlayerRecord[] = []) {
  const recoveryByPlayer = new Map<string, string>();
  const issuedAt = new Map<string, Date>();
  const calls = { set: 0 };
  return {
    recoveryByPlayer,
    calls,
    port: {
      findById: (id: string) => Promise.resolve(players.find((p) => p.id === id) ?? null),
      findByRecoveryHash: (hash: string) => {
        for (const [playerId, stored] of recoveryByPlayer) {
          if (stored === hash)
            return Promise.resolve(players.find((p) => p.id === playerId) ?? null);
        }
        return Promise.resolve(null);
      },
      findRecoveryIdentity: (hash: string) => {
        for (const [playerId, stored] of recoveryByPlayer) {
          const player = players.find((p) => p.id === playerId);
          if (stored === hash && player !== undefined) {
            return Promise.resolve({ player, issuedAt: issuedAt.get(playerId)! });
          }
        }
        return Promise.resolve(null);
      },
      setRecoveryIdentity: (playerId: string, hash: string) => {
        calls.set++;
        recoveryByPlayer.set(playerId, hash);
        issuedAt.set(playerId, new Date(1_000 * calls.set));
        return Promise.resolve();
      },
    },
  };
}

const ALICE: PlayerRecord = { id: 'p-alice', displayName: 'Alice' };
const BOB: PlayerRecord = { id: 'p-bob', displayName: 'Bob' };

function service(players: PlayerRecord[] = [ALICE, BOB]) {
  const repo = repository(players);
  return { repo, service: new RecoveryService({ players: repo.port }) };
}

describe('issue', () => {
  it('rend un code affichable et le range hache', async () => {
    const { repo, service: sut } = service();
    const code = await sut.issue(ALICE.id);

    expect(code).toMatch(/^AURA(-[0-9A-Z]{4}){4}$/);
    const stored = repo.recoveryByPlayer.get(ALICE.id);
    expect(stored).toBe(hashRecoveryCode(code));
    // Le code lui-meme ne doit exister nulle part cote serveur.
    expect(stored).not.toContain(normalizeRecoveryCode(code));
  });

  it('refuse un joueur qui n existe pas', async () => {
    const { service: sut } = service();
    await expect(sut.issue('p-fantome')).rejects.toThrow(RecoveryError);
  });

  /*
    Regenerer remplace : c'est ce qui rend un code REVOCABLE. Un joueur qui
    pense avoir laisse traîner le sien en demande un nouveau, et l'ancien
    cesse d'ouvrir son compte.
  */
  it('remplace le code precedent', async () => {
    const { repo, service: sut } = service();
    const first = await sut.issue(ALICE.id);
    const second = await sut.issue(ALICE.id);

    expect(second).not.toBe(first);
    expect(repo.recoveryByPlayer.get(ALICE.id)).toBe(hashRecoveryCode(second));
    await expect(sut.claim(first)).rejects.toThrow(RecoveryError);
  });
});

describe('claim', () => {
  it('retrouve le joueur qui a recu le code', async () => {
    const { service: sut } = service();
    const code = await sut.issue(BOB.id);
    await expect(sut.claim(code)).resolves.toEqual(BOB);
  });

  /*
    Un code se recopie a la main : casse, espaces, tirets oublies, `O` lu
    pour un zero. Le refuser pour ca serait perdre un joueur sur une question
    de presentation alors que le code est bon.
  */
  it('accepte le code quelle que soit sa presentation', async () => {
    const { service: sut } = service();
    const code = await sut.issue(BOB.id);
    for (const variant of [code.toLowerCase(), code.replaceAll('-', ''), ` ${code} `]) {
      await expect(sut.claim(variant)).resolves.toEqual(BOB);
    }
  });

  /*
    Presenter un code NE LE CONSOMME PAS : on peut jouer sur son telephone et
    sur son ordinateur. Un code a usage unique obligerait a en redemander un
    apres chaque appareil, et le joueur finirait par ne plus en avoir.
  */
  it('ne consomme pas le code', async () => {
    const { service: sut } = service();
    const code = await sut.issue(BOB.id);
    await sut.claim(code);
    await expect(sut.claim(code)).resolves.toEqual(BOB);
  });

  it('refuse un code inconnu', async () => {
    const { service: sut } = service();
    await expect(sut.claim(formatRecoveryCode(generateRecoveryCode()))).rejects.toThrow(
      RecoveryError,
    );
  });

  /*
    Une saisie mal formee et un code bien forme mais inconnu doivent rendre la
    MEME erreur. Deux messages distincts diraient a qui essaie des codes au
    hasard lesquels ont la bonne forme — une aide qu'on ne lui doit pas.
  */
  it('ne distingue pas une saisie invalide d un code inconnu', async () => {
    const { service: sut } = service();
    const malformed = await sut.claim('pas-un-code').catch((e: unknown) => e);
    const unknown = await sut
      .claim(formatRecoveryCode(generateRecoveryCode()))
      .catch((e: unknown) => e);

    expect(malformed).toBeInstanceOf(RecoveryError);
    expect(unknown).toBeInstanceOf(RecoveryError);
    expect((malformed as RecoveryError).reason).toBe((unknown as RecoveryError).reason);
  });

  it('ne touche pas la base pour une saisie mal formee', async () => {
    const { repo, service: sut } = service();
    await sut.claim('trop-court').catch(() => undefined);
    expect(repo.calls.set).toBe(0);
  });
});

describe('prove', () => {
  /*
    L'age du code sert a changer de mot de passe : un code tout juste delivre
    peut l'avoir ete par un intrus muni d'une session volee.
  */
  it('rend le joueur et l instant ou son code a ete delivre', async () => {
    const { service: sut } = service();
    const code = await sut.issue(ALICE.id);
    await expect(sut.prove(code)).resolves.toEqual({ player: ALICE, issuedAt: new Date(1_000) });
  });

  it('refuse un code inconnu comme claim', async () => {
    const { service: sut } = service();
    await expect(sut.prove('AURA-0000-0000-0000-0000')).rejects.toThrow(RecoveryError);
  });
});
