import { PasswordHasherBusyError, type PasswordHasher } from '../domain/ports.js';

/**
 * Plafond global du hachage des mots de passe (ADR 0013).
 *
 * Les limites de tentatives bornent un attaquant par adresse email et par IP,
 * pas le serveur dans son ensemble : mille IP sur mille adresses passent
 * toutes sous les seuils, et chaque essai coute 19 Mio et des dizaines de
 * millisecondes. Ce decorateur borne ce qui tourne ensemble (`maxConcurrent`)
 * et ce qui attend (`maxQueued`) ; au-dela il refuse tout de suite, et la
 * route repond 503 plutot que de faire tomber le conteneur.
 */
export interface BoundedHasherOptions {
  readonly maxConcurrent: number;
  readonly maxQueued: number;
}

export class BoundedPasswordHasher implements PasswordHasher {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly inner: PasswordHasher,
    private readonly options: BoundedHasherOptions,
  ) {}

  hash(password: string): Promise<string> {
    return this.run(() => this.inner.hash(password));
  }

  verify(hash: string, password: string): Promise<boolean> {
    return this.run(() => this.inner.verify(hash, password));
  }

  private async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.options.maxConcurrent) {
      if (this.waiting.length >= this.options.maxQueued) throw new PasswordHasherBusyError();
      // La place est cedee directement par celui qui sort : `running` ne
      // redescend pas entre les deux, donc personne ne double la file.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) this.running -= 1;
      else next();
    }
  }
}
