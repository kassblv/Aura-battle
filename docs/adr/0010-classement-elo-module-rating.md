# ADR 0010 — Classement Elo à K variable, dans un module `rating` à part

- Statut : accepté
- Date : 2026-09-20

## Contexte

`docs/05` décrivait le classement sans rien en construire : `Rating.mmr` était *lu* à 1000
par défaut, jamais écrit ; `match:found.league` valait `'bronze'` en dur — qui n'est même pas
une des six ligues du jeu ; `match:end` envoyait un classement et des récompenses figés à
zéro. La boutique, qui ne vend que du cosmétique (ADR 0003), n'avait donc aucune monnaie à
distribuer et restait décorative.

Trois questions se posaient, dans l'ordre où `docs/05` les laissait ouvertes.

**Elo ou Glicko-2 ?** Le modèle de données porte déjà un champ `rd` (« si Glicko-2 »), mais un
champ qui existe n'est pas une décision. Glicko-2 modélise une incertitude par joueur et
converge plus vite pour un nouveau venu — exactement ce qu'on veut pour les cinq matchs de
placement. Son coût, en revanche, n'est pas dans la formule elle-même (raisonnablement
courte) mais dans ce qu'elle suppose : une **période de classement** groupant plusieurs
matchs avant de recalculer une fois, une volatilité `σ` dont le réglage n'a d'intuition que
par la pratique, et un système bien plus difficile à éprouver — la littérature elle-même
prévient qu'il faut le faire tourner une saison entière avant de faire confiance aux
paramètres choisis. Rien de tout cela ne va avec l'architecture retenue ici : chaque match se
règle **seul**, immédiatement à sa fin, jamais en lot. Appliquer Glicko-2 un match à la fois
revient à violer sa propre hypothèse de départ pour ne garder que sa formule — un système
qu'on ne sait pas régler ne vaut pas mieux qu'un système simple qu'on comprend.

**Où vit le calcul ?** `packages/rules` est le moteur d'un **duel** : il ne connaît qu'un
match, une graine, deux sièges, et doit pouvoir rejouer n'importe quel match sans rien savoir
d'une saison ou d'un historique de joueur. Le classement, lui, porte sur une **suite** de
matchs — MMR, LP, ligue, compteur de placement, tous des états qui survivent au match en
cours et n'ont aucun sens à l'intérieur d'un seul. Le confondre avec le moteur de règles
brouillerait une frontière que `docs/02` trace déjà nettement : le moteur dit ce qui est
jouable, la progression dit ce qu'on en retient.

**Comment le classement rejoint-il `match:end` sans rien devoir au réseau ?** Le calcul en
lui-même doit rester pur et testable comme tout le reste — mais son résultat dépend d'une
lecture, puis d'une écriture, en base. `MatchRuntime` reste synchrone du premier tap au
dernier (règle d'or n°1) ; seule la toute dernière étape, après que le match a déjà son
vainqueur, peut se permettre d'attendre.

## Décision

**Elo à K variable**, comme `docs/05` l'autorise explicitement (« si plus simple au départ »).
Le calcul (`apps/server/src/modules/rating/domain/rating.ts`) est pur : aucune horloge, aucun
Redis, aucun Prisma — même discipline que `@aura/rules`, dans un module séparé.

- **K majoré durant les cinq matchs de placement de la saison** (60, contre 24 ensuite) : le
  rôle qu'une déviation élevée jouerait sous Glicko-2, obtenu sans modéliser d'incertitude
  explicite. `Rating.rd` reste en base, inutilisé, à sa valeur par défaut — le jour d'une
  bascule vers Glicko-2, aucune migration de schéma n'est nécessaire, seul `rating.ts` change.
- **LP : base ±20, corrigée par l'écart entre le MMR d'avant le match et les LP actuels**
  (`docs/05`). Un MMR 1000 (départ) vaut 0 LP (Sans aura) : même échelle, décalée. Un joueur
  sous-classé (MMR au-dessus de ce que ses LP indiquent) gagne plus et perd moins jusqu'à
  rattraper son niveau ; un sur-classé fait le trajet inverse. La correction est plafonnée à
  ±10, strictement en-dessous de la base ±20 : un vainqueur ne repart donc **jamais** avec un
  delta négatif ou nul, ni un perdant avec un delta positif ou nul — l'invariant que `docs/05`
  demande de vérifier par propriété (`rating.test.ts`).
- **Un forfait compte comme une défaite pour le MMR et les LP.** Sans cela, abandonner ne
  coûterait rien de plus qu'un écran fermé plus tôt. **Un double abandon ne change le
  classement de personne** : ni l'un ni l'autre n'a joué la manche qui termine le match
  (`afterReveal`, `@aura/rules`), donc aucun des deux n'a rien démontré.
- **Récompenses** (`softCurrency`, `xp`), barème documenté dans `docs/05` : victoire > nul >
  défaite jouée > **abandon, qui rapporte strictement zéro**. En-dessous même d'une défaite
  jouée jusqu'au bout — sans ce plancher à zéro, la boucle « rejoindre la file, abandonner,
  recommencer » deviendrait plus rentable que jouer, sans le moindre risque de defaite
  prolongée. Cosmétique uniquement au bout de la chaîne (ADR 0003) : ce que `softCurrency`
  achète ne change jamais un score.
- **Six ligues transmises comme des identifiants stables** (`sans_aura`, `naissante`, `stable`,
  `rayonnante`, `legendaire`, `infinie`), pas comme des libellés français figés côté serveur —
  `match:found.league` et `match:end.rating.league{Before,After}` ne portent qu'une chaîne
  (`z.string()`, `packages/protocol`), le client les traduit par ses propres clés i18n
  (CLAUDE.md, règle des langues).
- **Module `rating` séparé de `packages/rules`, sans module NestJS propre.** Le calcul vit dans
  `apps/server/src/modules/rating/domain/rating.ts`, l'orchestration dans
  `rating/application/rating-settlement.service.ts` (`MatchRatingSettlement`, port défini dans
  `match/domain/ports.ts` — même montage que `MatchOpener` pour `MatchOpening`,
  `matchmaking/domain/ports.ts`, ADR 0009), l'adaptateur Prisma dans
  `rating/adapters/prisma-rating.repository.ts`. Pas de `rating.module.ts` : `rating` a besoin
  de `PresenceLeagueCache` (réalisé par `SocketNotifier`, module `match`) pour rafraîchir la
  ligue en cache après un match classé, et `match` a besoin de `MatchRatingSettlement` (réalisé
  dans `rating`) — deux modules Nest se seraient importés l'un l'autre. Tout se câble dans
  `match.module.ts`, exactement comme `matchmaking/` — qui n'a lui non plus jamais eu de
  module Nest propre — l'a déjà résolu (ADR 0009).
- **`MatchRuntime.announceEnd` libère les sièges et le minuteur avant tout le reste, jamais
  après.** Le classement demande une lecture puis une écriture Prisma
  (`RatingSettlementService.settle`, asynchrone — la seule méthode du runtime qui le soit) ;
  une base lente ne doit retarder que l'écran de fin de match, jamais la disponibilité des
  deux joueurs pour le suivant. Un calcul en échec — base injoignable, hors saison — retombe
  sur un classement neutre (0 LP, `sans_aura`) plutôt que de ne jamais envoyer `match:end`.
- **`match:found.league` lit une ligue mise en cache à la connexion** (même construction que le
  nom affiché, `SocketNotifier`, docs/03), **rafraîchie à chaque match classé** via
  `PresenceLeagueCache.setLeague` — sans quoi elle resterait figée à sa valeur de connexion
  pendant toute une session, même après vingt manches classées.

## Conséquences

- `rating.test.ts` couvre par propriété (`fast-check`) : MMR jamais négatif, LP jamais négatifs,
  un vainqueur ne perd jamais de points (MMR et LP), un perdant n'en gagne jamais, le delta MMR
  est zéro-somme entre deux joueurs qui partagent le même K, la ligue rendue correspond toujours
  aux LP rendus, les placements progressent jusqu'à cinq puis se figent, l'abandon rapporte
  strictement moins qu'une défaite jouée.
- `RatingSettlementService` est testé avec des doubles en mémoire pour `RatingLookup` /
  `RatingWriter` / `PresenceLeagueCache` (aucune base) ; `MatchRuntime` est testé avec un faux
  `MatchRatingSettlement` pour vérifier que les sièges se libèrent avant que le classement ne
  réponde, et qu'un échec du calcul retombe sur un classement neutre sans faire tomber le match.
- La réinitialisation douce de fin de saison (`docs/05`) reste **hors périmètre** de ce jalon :
  aucun code ne la traite encore, elle demandera son propre travail.
- Le MMR caché de la partie rapide (« Non — MMR caché séparé », `docs/05`) n'est pas non plus
  traité ici : seuls les matchs `RANKED` écrivent un classement ; les autres modes lisent le
  classement classé existant pour l'afficher, sans jamais l'écrire.
- Bascule vers Glicko-2 un jour : `rd` est déjà en base et déjà porté par `RatingSnapshot`,
  seul `nextMmr`/`nextLeaguePoints` changerait — aucune migration Prisma à prévoir pour ça.
- Le client mobile doit apprendre à afficher `rating.before/after` (des LP, pas un MMR — le MMR
  reste cache, jamais transmis) et à traduire les six identifiants de ligue par ses propres clés
  i18n ; ce travail n'est pas fait ici (hors périmètre : `apps/mobile/`).
