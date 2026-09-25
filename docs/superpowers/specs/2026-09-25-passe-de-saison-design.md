# Passe de saison — chantier n°6

Date : 2026-09-25 · Statut : décidé sur recommandation (« continue jusqu'au
bout », « je te fais confiance sur les recommandations ») ; relisible.

## Pourquoi

Le niveau monte toujours, mais il ne mène nulle part de précis. Une saison
donne un **horizon daté** : trente paliers, huit semaines, des récompenses
visibles d'avance. C'est la raison de revenir demain — et celle d'acheter des
jetons sans jamais acheter de puissance (règle d'or n° 3).

## Règles

- **XP de saison** : l'expérience de chaque match joué pendant la saison, créditée
  dans la même transaction que l'XP du joueur. 30 paliers de 100 XP (≈ 2 à 3
  matchs par jour sur 8 semaines pour tout finir).
- **Piste gratuite** : des pièces à chaque palier, des jetons aux paliers 5, 15
  et 25, un cosmétique aux paliers 10, 20 et 30.
- **Piste premium** : **500 💎**, payés en jetons (jamais en argent directement).
  Elle rend 200 💎 sur la saison (20 💎 tous les trois paliers) et des
  cosmétiques plus rares. Achetable à tout moment : les paliers déjà atteints
  deviennent réclamables d'un coup — le moment le plus fort du passe.
- **Réclamer** : un appui par récompense (le geste qui fait plaisir), et « Tout
  récupérer ». Le serveur seul juge l'XP, les paliers, la piste premium et ce qui
  a déjà été réclamé, et accorde dans une transaction.
- **Un cosmétique déjà possédé** se change en pièces, à son prix du catalogue :
  une récompense n'est jamais vide.
- **Les données du passe sont du contenu** (`SEASON_PASS`, `@aura/content`,
  règle d'or n° 5), lues par le serveur ET le client.

## Hors périmètre (itération suivante)

- **Cosmétiques exclusifs de saison** : il faut du contenu neuf et une règle
  « jamais en boutique » que `isOffered` et la boutique ne connaissent pas
  encore. La v1 récompense avec des cosmétiques du catalogue.
- ~~**Saison 2**~~ : fait. Le seed garde toujours la saison suivante d'avance
  (`seasonsToCreate`).

## Architecture

- `@aura/content` : `SEASON_PASS` (paliers, XP par palier, prix premium,
  récompenses des deux pistes) et `seasonTierFor(xp)`.
- `@aura/protocol` : `seasonStateSchema` (réponse), `seasonClaimRequestSchema`
  (`{ tier, track }`, strict).
- Serveur, module `season` : `SeasonProgress (playerId, seasonId, xp,
  premiumAt)` et `SeasonClaim (playerId, seasonId, tier, track)` ; `GET /season`,
  `POST /season/claim`, `POST /season/premium`. Règle de réclamation pure,
  testée. Crédit de l'XP de saison dans `PrismaRatingRepository.credit`.
- Mobile : écran « Saison » en paysage (piste horizontale, deux rangées), case
  du rail avec pastille des récompenses à réclamer, « Palier N atteint » en fin
  de duel en ligne (`match:end` ne porte pas l'XP de saison ; le protocole n'a
  pas été changé pour ça).

## Critères d'acceptation

- [x] Règle de réclamation testée : palier non atteint, premium absent, déjà
  réclamé, cosmétique déjà possédé → pièces, piste inconnue.
- [x] Achat du premium : jetons insuffisants, déjà premium, débit exact.
- [x] Crédit de l'XP de saison dans la transaction de fin de match (test contre
  Postgres).
- [x] Écran vérifié à l'écran en 844×390 ; aucune donnée calculée par le client
  n'est crue.
- [x] lint, typecheck, tests ; relecture de sécurité (points importants corrigés).
- [ ] Relecture finale.
