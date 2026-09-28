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
 * **Deux bornes, parce qu'une tache peut ne jamais finir.** Un echec liberait
 * deja la file ; une tache *pendante* — une requete partie vers une base
 * devenue muette — la gardait pour toujours, et chaque nouvel appel du joueur
 * s'empilait derriere elle.
 *
 * - `releaseAfterMs` : passe ce delai depuis son DEBUT, une tache cede la file
 *   a la suivante, qu'elle ait abouti ou non. Elle continue de tourner, et son
 *   resultat revient toujours a son appelant : seul l'ordre est relache.
 * - `maxDepth` : au plus tant de taches par cle, en cours et en attente
 *   confondues. Au-dela, `run` rejette aussitot par `KeyedSerializerFullError`,
 *   sans rien executer.
 *
 * La limite de debit de l'appelant borne le RYTHME auquel un joueur remplit sa
 * file ; elle ne dit rien de sa PROFONDEUR, qui depend du temps que met chaque
 * tache a se vider. Une base lente de quelques secondes suffit a transformer
 * un debit tout a fait legal en une file qui grossit sans fin : c'est
 * `maxDepth` qui la borne, pas la limite de debit.
 */
export interface KeyedSerializerOptions {
  /** Taches au plus par cle, celle en cours comprise. Entier strictement positif. */
  readonly maxDepth: number;
  /** Duree, depuis son debut, apres laquelle une tache cede la file. */
  readonly releaseAfterMs: number;
  /** Prevenu chaque fois qu'une tache cede la file par delai plutot que par sa fin. */
  readonly onOverdue?: () => void;
}

/** La file de cette cle est pleine : la tache n'a pas ete executee. */
export class KeyedSerializerFullError extends Error {
  constructor() {
    super('file pleine');
    this.name = 'KeyedSerializerFullError';
  }
}

interface Line {
  /** Resolue quand la derniere tache de la file cede sa place (jamais rejetee). */
  tail: Promise<void>;
  /** Taches qui n'ont pas encore cede leur place. */
  depth: number;
}

export class KeyedSerializer {
  private readonly lines = new Map<string, Line>();

  constructor(private readonly options: KeyedSerializerOptions) {
    if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1) {
      throw new RangeError(`maxDepth invalide : ${String(options.maxDepth)}`);
    }
    if (!Number.isFinite(options.releaseAfterMs) || options.releaseAfterMs <= 0) {
      throw new RangeError(`releaseAfterMs invalide : ${String(options.releaseAfterMs)}`);
    }
  }

  /** Nombre de cles qui ont du travail en cours ou en attente. */
  get size(): number {
    return this.lines.size;
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.lines.get(key);
    if (existing !== undefined && existing.depth >= this.options.maxDepth) {
      return Promise.reject(new KeyedSerializerFullError());
    }
    const line = existing ?? { tail: Promise.resolve(), depth: 0 };
    const previous = line.tail;

    let release!: () => void;
    const released = new Promise<void>((done) => {
      release = done;
    });
    line.tail = released;
    line.depth += 1;
    this.lines.set(key, line);

    void released.then(() => {
      line.depth -= 1;
      // Seule la DERNIERE tache de la file retire la cle : une tache arrivee
      // entre-temps a deja remplace la queue.
      if (this.lines.get(key) === line && line.tail === released) this.lines.delete(key);
    });

    return previous.then(() => {
      const timer = setTimeout(() => {
        this.options.onOverdue?.();
        release();
      }, this.options.releaseAfterMs);
      // Le minuteur ne doit pas, a lui seul, retenir le processus a l'arret.
      timer.unref();

      // `new Promise` et non `task()` nu : une exception levee avant la
      // premiere attente devient un rejet, rendu a l'appelant, au lieu de
      // laisser la file sans personne pour la liberer.
      const result = new Promise<T>((resolve) => {
        resolve(task());
      });
      // L'echec d'une tache appartient a son appelant : il libere la file comme
      // un succes, et ne fait pas echouer la suivante.
      const done = () => {
        clearTimeout(timer);
        release();
      };
      void result.then(done, done);
      return result;
    });
  }
}
