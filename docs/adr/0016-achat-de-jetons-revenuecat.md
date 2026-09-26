# 0016 — L'achat de jetons passe par RevenueCat, et c'est le serveur qui crédite

Date : 2026-09-25 · Statut : accepté (choix du propriétaire : RevenueCat).

## Contexte

Les jetons se gagnent en jouant (ADR 0015) ; on veut aussi les vendre. Sur iOS
et Android, un bien numérique se vend par les **achats intégrés des stores** :
StoreKit et Google Play Billing, avec leurs reçus à valider et leurs
remboursements. Deux intégrations, deux formats de reçus, et une fraude
connue (reçus rejoués ou forgés).

## Décision

- **RevenueCat** fait le pont avec les deux stores : un SDK Capacitor
  (`@revenuecat/purchases-capacitor`, épinglé en 13.6.1) et la validation des
  reçus de son côté. Gratuit jusqu'à 2 500 $ de revenus mensuels, puis 1 %.
- **Le téléphone ne crédite rien.** Il ouvre la feuille de paiement du store.
  RevenueCat valide le reçu et prévient **notre serveur** par webhook
  (`POST /payments/revenuecat`), qui crédite `hardCurrency`. Le téléphone relit
  sa bourse ensuite (règle d'or n° 1).
- **La quantité vient de notre catalogue** (`TOKEN_PACKS`, `@aura/content`),
  jamais de l'événement. Le prix, lui, est celui des stores, affiché tel que
  RevenueCat le rend (monnaie et taxes locales).
- **Deux anti-rejeux.** L'identifiant d'événement (clé primaire de
  `TokenPurchase`) et la transaction du store (`store`, `transactionId`,
  unique) : une même transaction peut produire deux événements distincts. La
  ligne et le crédit vont dans la même transaction de base.
- **L'acheteur est le joueur.** Le SDK est configuré avec l'identifiant du
  joueur (`appUserID`).
- **Un achat payé ne disparaît jamais en silence.** Un produit inconnu, un
  acheteur anonyme ou un joueur supprimé : la ligne s'inscrit avec
  `status = UNATTRIBUTED` et sa raison, pour que le support la rende.
- **Route fermée sans secret** (`REVENUECAT_WEBHOOK_AUTH`, 32 caractères
  minimum, comparé à longueur constante, normalisé sans « Bearer » ni
  espaces). Les achats de test (`SANDBOX`) ne sont crédités qu'avec
  `REVENUECAT_SANDBOX=1`, **refusé en production** ; un environnement absent
  vaut un test.
- **Un remboursement reprend ce qui reste**, jamais en dessous de zéro, sous
  verrou de la ligne du joueur. Ce qui avait été dépensé est noté
  (`refundedTokens`, et un `warn` qui dit combien) pour que le support tranche.
- **Les types non traités s'acquittent avant toute autre validation** :
  refusés, RevenueCat les renverrait jusqu'à épuisement.
- **La trace de vente survit au compte** (`onDelete: SetNull`).
- **Pas de SDK de paiement dans le navigateur** : import dynamique derrière
  `isNative()`. Le web dit que les jetons s'achètent dans l'application.

## Conséquences

- Mise en service : voir « Achat de jetons » dans `docs/10-exploitation.md`.
- Tout événement valide est acquitté en 200, même ignoré. Seule une panne de
  la base rend une erreur, pour que RevenueCat renvoie plus tard.
- Le farm de jetons par collusion (M7) devient plus sensible dès que les
  jetons se vendent : à traiter avant l'ouverture des ventes.
