/**
 * Execute les taches d'une meme cle l'une apres l'autre, dans l'ordre
 * d'arrivee ; celles de cles differentes avancent en parallele.
 *
 * Une chaine de promesses par cle. La cle est retiree des que sa chaine se
 * vide : la memoire est bornee par le nombre de cles qui ont du travail EN
 * COURS, pas par le nombre de cles jamais vues.
 *
 * **Dans le processus, pas au-dela.** Comme `KeyedTokenBuckets`, ce verrou ne
 * tient que parce que le jeu tourne dans un seul conteneur (ADR 0012) ; au
 * multi-noeud, il faudrait un verrou partage (Redis) ou un ordre tenu par la
 * base.
 *
 * La longueur d'une file n'est pas bornee ici : c'est la limite de debit de
 * l'appelant qui borne ce qu'un joueur peut y empiler.
 */
export class KeyedSerializer {
  /** Pour chaque cle occupee, la fin de sa derniere tache (jamais rejetee). */
  private readonly tails = new Map<string, Promise<void>>();

  /** Nombre de cles qui ont du travail en cours ou en attente. */
  get size(): number {
    return this.tails.size;
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // `then(task)` et non `task()` : une exception levee avant la premiere
    // attente devient un rejet, rendu a l'appelant, au lieu de casser la file.
    const result = previous.then(task);
    // La queue de la file ne rejette jamais : l'echec d'une tache appartient a
    // son appelant, et ne doit ni bloquer ni faire echouer la suivante.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      // Seule la DERNIERE tache de la file retire la cle : une tache arrivee
      // entre-temps a deja remplace la queue.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
