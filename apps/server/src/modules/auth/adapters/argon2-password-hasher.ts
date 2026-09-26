import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../domain/ports.js';

/**
 * Hachage des mots de passe : argon2id (ADR 0013).
 *
 * `@node-rs/argon2` plutot que `argon2` : binaire precompile par plateforme,
 * **aucun script d'installation** — rien a decider dans `allowBuilds`, rien a
 * compiler dans l'image Docker.
 *
 * Parametres OWASP (Password Storage Cheat Sheet) : 19 Mio, deux passes, un
 * fil. Ecrits en toutes lettres alors que ce sont les defauts de la
 * bibliotheque : **un defaut n'est pas un contrat**, et une mise a jour qui
 * les baisserait affaiblirait chaque nouveau hache sans que rien ne bouge ici.
 * Le hache est au format PHC et porte ses parametres : les relever plus tard
 * ne casse aucun mot de passe existant.
 */
export const ARGON2_OPTIONS = Object.freeze({
  // `Algorithm.Argon2id` vaut 2, mais c'est un `const enum` ambiant, que
  // `isolatedModules` interdit de lire. La valeur est donc ecrite, et un test
  // verifie que le hache produit commence bien par `$argon2id$`.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      // La comparaison finale est a temps constant dans la bibliotheque.
      return await verify(stored, password);
    } catch {
      // Hache illisible : un refus, pas une 500 qu'on distinguerait d'un refus.
      return false;
    }
  }
}
