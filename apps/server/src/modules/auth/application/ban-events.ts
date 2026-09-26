/**
 * « Ce joueur vient d'etre banni. » (ADR 0018)
 *
 * Meme forme que `CredentialsEvents`, pour la meme raison : le panneau ne
 * connait pas les sockets ni les matchs en cours — il ne doit pas les
 * connaitre. Il publie, et le module match s'y abonne pour faire perdre le
 * match en cours par forfait puis fermer les sockets du banni.
 *
 * En memoire du processus : le jeu tourne dans un seul conteneur (ADR 0012).
 * Au multi-noeud, un banni assis sur un autre noeud garderait sa socket
 * jusqu'a sa prochaine verification de jeton — a porter sur Redis alors.
 */
export type BanListener = (playerId: string) => void;

export class PlayerBanEvents {
  private readonly listeners: BanListener[] = [];

  subscribe(listener: BanListener): void {
    this.listeners.push(listener);
  }

  /** Un abonne qui leve n'empeche pas les autres d'etre prevenus. */
  publish(playerId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(playerId);
      } catch {
        // Un match deja termine, une socket deja fermee : rien a rattraper.
      }
    }
  }
}
