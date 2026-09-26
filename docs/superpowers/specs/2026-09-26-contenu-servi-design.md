# Contenu servi et catalogue vivant — chantier n°11 (M10)

Date : 2026-09-26 · Statut : décidé sur recommandation (« pense à développer le
panel administrateur pour gérer tout cela ») ; relisible. S'appuie sur le
chantier n°10 (panneau qui écrit, ADR 0018).

## Pourquoi

Une danse tendance dure quelques semaines. La publier doit prendre **minutes**,
pas une revue des stores. Aujourd'hui c'est impossible, et pas seulement faute
de serveur :

- les danses d'une case sont listées **en code** (`MOVE_ANIMATIONS`,
  `@aura/content`) — ajouter une danse demande de modifier du TypeScript, ce
  que la règle d'or n° 5 interdit ;
- le client et le serveur embarquent chacun leur copie du contenu ;
- les prix affichés par la boutique sont recalculés par le client, alors que le
  serveur encaisse ceux de `CosmeticItem`.

## Décisions

1. **Registre de contenu construit à l'exécution** (`ContentRegistry`,
   `@aura/content`, pur) à partir d'une liste d'animations validées — plus de
   liste en code. La case d'une danse se lit dans son identifiant
   (`anim.<famille>.t<palier>.<slug>`) ; la **pose offerte** d'une case est
   l'animation de rareté `default` de cette case, et il y en a **exactement
   une** par case (le registre refuse de se construire sinon — règle d'or n° 3,
   ADR 0014). `MOVE_ANIMATIONS` disparaît ; les fonctions actuelles
   (`animationIdsFor`, `defaultAnimationFor`, `moveOfAnimation`…) deviennent des
   méthodes du registre.
2. **Contenu embarqué + contenu publié.** Les JSON de `packages/content/
   animations` restent embarqués des deux côtés (le jeu marche hors ligne et au
   premier lancement). Le serveur y ajoute les animations **publiées** depuis le
   panneau (`ContentAnimation` : id, document JSON, hachage, statut
   `draft | published | retired`, dates).
3. **Servi par le serveur, mis en cache par le client** :
   - `GET /content/manifest` → `contentVersion` (hachage de l'ensemble publié),
     la liste `{ id, hash }` des animations publiées, et le **catalogue**
     (`{ id, kind, rarity, priceSoft, priceHard, availableFrom, availableTo,
     exclusive }`, tiré de `CosmeticItem`).
   - `GET /content/animations/<hash>.json` → le document, **immuable** (cache
     long, le hachage change avec le contenu).
   - Le client garde les documents par hachage (stockage local), ne télécharge
     que ce qui manque, valide chaque document avec le même validateur, et
     construit son registre : embarqué ∪ publié en cache. `match:found.
     contentVersion` lui dit s'il est à jour ; sinon il relit le manifeste avant
     la révélation. Une animation encore absente retombe sur la pose offerte de
     sa case (garde-fou existant) — jamais un échec de manche.
4. **La boutique affiche les prix du serveur** (catalogue du manifeste), plus
   ceux recalculés sur l'appareil.
5. **Panneau — Contenu** :
   - liste des animations (embarquées, en lecture seule ; publiées ; brouillons ;
     retirées), avec leur case, rareté, prix ;
   - **importer** un JSON : validé par le serveur avec `validateAnimation` et les
     invariants du registre (identifiant bien formé et libre, case existante,
     rareté ≠ `default` — une danse publiée ne remplace jamais la pose offerte) ;
     erreurs et avertissements affichés ;
   - **aperçu** : l'animation jouée sur le personnage, dans le panneau ;
   - **publier** / **retirer** (une danse retirée reste à qui la possède ; elle
     n'est plus vendue).
6. **Panneau — Catalogue** : prix (pièces, jetons), rareté, dates de
   disponibilité de chaque cosmétique, avec les garde-fous de la règle d'or
   n° 3 appliqués par le serveur : la pose offerte reste gratuite et ne se
   retire pas ; un exclusif de saison n'a jamais de prix ; prix bornés.

## Étapes

- **11a — registre et service** : `ContentRegistry` (tests d'abord), migration
  de tous les usages de `MOVE_ANIMATIONS` côté serveur et client, manifeste,
  documents par hachage, cache client, boutique aux prix servis.
- **11b — panneau** : pages Contenu (import, aperçu, publication) et Catalogue.

## Critères d'acceptation

- [ ] Registre : une case sans pose offerte, ou avec deux, refuse de se
  construire ; case lue dans l'identifiant ; mêmes réponses que les fonctions
  actuelles sur le contenu embarqué (test d'équivalence).
- [ ] Une danse publiée depuis le panneau est jouable en ligne **sans nouvelle
  version du client** : elle apparaît dans la boutique, s'achète au prix du
  serveur, se joue en match et l'adversaire la voit (test e2e + vérifié à
  l'écran).
- [ ] Hors ligne ou serveur injoignable : le jeu démarre sur le contenu
  embarqué et le dernier cache (test).
- [ ] Import refusé : JSON invalide, identifiant pris, rareté `default`, case
  inconnue (tests) ; chaque publication et chaque changement de prix est
  journalisé (`AdminAction`).
- [ ] Lint, typecheck, tests ; relecture de sécurité (entrée de fichiers par le
  panneau, cache client) et relecture finale.
