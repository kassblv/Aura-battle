import { MemoryQueueStore } from './memory-queue.store.js';
import { describeQueueStoreContract } from './queue-store.contract.js';

/**
 * La reference du contrat se verifie elle-meme.
 *
 * Elle sert de double dans les tests du service : si elle s'ecartait du
 * contrat, tous ces tests mentiraient a l'unisson.
 */
describeQueueStoreContract('memoire', () =>
  Promise.resolve({
    store: new MemoryQueueStore(),
    close: () => Promise.resolve(),
  }),
);
