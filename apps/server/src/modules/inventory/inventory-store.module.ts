import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaInventoryRepository } from './adapters/prisma-inventory.repository.js';

/**
 * Le depot d'inventaire, en un seul exemplaire pour tout le processus.
 *
 * Deux modules en ont besoin : `inventory` (la boutique, le vestiaire) et
 * `match` (ce que porte un joueur, a la connexion et a chaque changement). Il
 * etait declare par les deux, donc construit deux fois — et le catalogue, que
 * le depot garde en memoire, lu et garde deux fois. Un module a part plutot
 * qu'un export de l'un vers l'autre : `inventory` importe deja `match`, et le
 * depot n'appartient pas au match.
 *
 * `AuthModule` pour `PrismaService`, seulement.
 */
@Module({
  imports: [AuthModule],
  providers: [PrismaInventoryRepository],
  exports: [PrismaInventoryRepository],
})
export class InventoryStoreModule {}
