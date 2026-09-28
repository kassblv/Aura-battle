import { defineConfig, env } from 'prisma/config';

/**
 * Le CLI Prisma 7 ne lit plus `.env` tout seul, et le notre vit a la racine du
 * monorepo. `process.loadEnvFile` est natif depuis Node 20 : pas de dependance
 * a ajouter pour ca. L'echec est silencieux a dessein — en CI les variables
 * viennent de l'environnement, il n'y a pas de fichier a charger.
 */
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // Pas de fichier .env : on se fie a l'environnement.
}

/**
 * Configuration du CLI Prisma.
 *
 * Depuis la version 7, l'URL de connexion ne vit plus dans `schema.prisma` :
 * les commandes de migration la lisent ici, et l'application la passe au client
 * via un adaptateur de driver. Un schema sans secret est un schema qu'on peut
 * publier sans y penser.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    /**
     * Chemin explicite vers `tsx`, et non `tsx` tout court.
     *
     * Prisma lance cette commande telle quelle, sans ajouter `node_modules/.bin`
     * au PATH comme le ferait un script npm. Le nom nu marche sur une machine de
     * developpement parce qu'un shell interactif l'y trouve deja ; dans un
     * conteneur il donne `ENOENT`, et l'amorcage echoue apres un deploiement
     * annonce reussi.
     */
    seed: 'node_modules/.bin/tsx prisma/seed.ts',
  },
});
