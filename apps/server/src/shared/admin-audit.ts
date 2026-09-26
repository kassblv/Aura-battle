/**
 * Une ligne du journal d'administration (`AdminAction`, ADR 0018).
 *
 * Toute ecriture du panneau en produit une, **dans la meme transaction** que
 * l'ecriture elle-meme : une ecriture sans trace n'a pas lieu. Le type vit ici,
 * partage, parce que chaque module qui accepte une ecriture du panneau (drapeaux,
 * evenements, joueurs) la journalise dans SA transaction — le journal n'est pas
 * un appel qu'on ferait apres coup et qu'on pourrait oublier.
 *
 * Pas d'auteur : un seul secret aujourd'hui, le journal dit quoi, pas qui.
 */
export interface AdminAuditEntry {
  /** `flag.pause`, `flag.resume`, `flag.new-measure`, `event.override`, `player.ban`, `player.unban`. */
  readonly action: string;
  /** Ce sur quoi porte l'action : un drapeau, une semaine, un joueur. */
  readonly target: string;
  /** Etat avant, tel qu'on le montrera ; `null` s'il n'y avait rien. */
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  /** Heure serveur. */
  readonly atMs: number;
}
