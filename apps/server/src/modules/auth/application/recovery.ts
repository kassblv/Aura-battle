import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../domain/recovery.js';
import type { PlayerRecord, RecoveryIdentityRepository } from '../domain/ports.js';

/**
 * Delivrer et presenter un code de recuperation.
 *
 * Deux cas d'usage seulement. Un joueur authentifie **demande** un code, qu'il
 * note. Un visiteur, de n'importe ou, **presente** ce code et retrouve le
 * compte auquel il appartient.
 *
 * Le service ne fabrique pas de session : il rend le joueur, et l'appelant
 * ouvre la session par le chemin habituel. Un second chemin d'emission de
 * jetons serait un second endroit ou la rotation, l'expiration et la revocation
 * pourraient diverger.
 */

export type RecoveryFailure = 'UNKNOWN_PLAYER' | 'INVALID_RECOVERY_CODE';

export class RecoveryError extends Error {
  constructor(readonly reason: RecoveryFailure) {
    super(reason);
    this.name = 'RecoveryError';
  }
}

export interface RecoveryDependencies {
  readonly players: RecoveryIdentityRepository;
}

export class RecoveryService {
  constructor(private readonly deps: RecoveryDependencies) {}

  /**
   * Delivre un code au joueur, en remplacant le precedent.
   *
   * Remplacer est ce qui rend un code **revocable** : quelqu'un qui pense
   * avoir laisse trainer le sien en demande un nouveau, et l'ancien cesse
   * d'ouvrir son compte. Le serveur ne garde que le hache — il est donc
   * incapable de reafficher un code deja delivre, et c'est voulu : une
   * fonction « revoir mon code » serait une fonction « voler un compte depuis
   * une session ouverte ».
   */
  async issue(playerId: string): Promise<string> {
    const player = await this.deps.players.findById(playerId);
    if (player === null) throw new RecoveryError('UNKNOWN_PLAYER');

    const code = generateRecoveryCode();
    await this.deps.players.setRecoveryIdentity(player.id, hashRecoveryCode(code));
    return formatRecoveryCode(code);
  }

  /**
   * Retrouve le joueur auquel ce code appartient.
   *
   * **Presenter un code ne le consomme pas.** On joue sur son telephone et sur
   * son ordinateur : un code a usage unique obligerait a en redemander un
   * apres chaque appareil, et le joueur finirait par ne plus en avoir.
   *
   * Une saisie mal formee et un code bien forme mais inconnu rendent la **meme**
   * erreur. Deux messages distincts diraient a qui essaie des codes au hasard
   * lesquels ont la bonne forme, ce qui reduit son travail sans rien apporter a
   * personne.
   */
  async claim(input: string): Promise<PlayerRecord> {
    const canonical = normalizeRecoveryCode(input);
    if (canonical === null) throw new RecoveryError('INVALID_RECOVERY_CODE');

    const player = await this.deps.players.findByRecoveryHash(hashRecoveryCode(canonical));
    if (player === null) throw new RecoveryError('INVALID_RECOVERY_CODE');
    return player;
  }
}
