/**
 * « Les identifiants de ce joueur viennent de changer. »
 *
 * Le module d'authentification ne connait pas les sockets du module match — il
 * ne doit pas les connaitre, c'est le module match qui depend de lui. Il
 * publie donc un evenement, et le module match s'y abonne pour fermer les
 * sockets du joueur : une socket deja ouverte par l'intrus survivrait sinon au
 * changement de mot de passe, puisque son jeton n'est verifie qu'au handshake.
 */
export type CredentialsListener = (playerId: string) => void;

export class CredentialsEvents {
  private readonly listeners: CredentialsListener[] = [];

  subscribe(listener: CredentialsListener): void {
    this.listeners.push(listener);
  }

  /** Un abonne qui leve n'empeche pas les autres d'etre prevenus. */
  publish(playerId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(playerId);
      } catch {
        // Fermer une socket deja fermee, par exemple : rien a rattraper.
      }
    }
  }
}
