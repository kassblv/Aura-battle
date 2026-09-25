# 04 — Modèle de données (brouillon Prisma)

Point de départ pour `apps/server/prisma/schema.prisma`. À affiner pendant le jalon M3.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Player {
  id           String   @id @default(uuid())
  displayName  String
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  softCurrency Int      @default(0)
  hardCurrency Int      @default(0)
  bannedUntil  DateTime?
  identities   AuthIdentity[]
  ratings      Rating[]
  inventory    InventoryItem[]
  loadout      Loadout?
  matchSeats   MatchSeat[]
  challenges   PlayerChallenge[]
}

model AuthIdentity {
  id         String   @id @default(uuid())
  playerId   String
  provider   AuthProvider
  subject    String            // identifiant d'appareil, code de récupération, email, Apple sub, Google sub
  secretHash String?           // EMAIL seulement : hachage argon2id du mot de passe
  createdAt  DateTime @default(now())
  player     Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  @@unique([provider, subject])
}
enum AuthProvider { DEVICE RECOVERY EMAIL APPLE GOOGLE }

### `RECOVERY` — garder son compte quand le navigateur oublie

Un compte invité vit dans le stockage du navigateur. Sur ordinateur, ce
stockage se vide pour un rien : un nettoyage, une fenêtre privée, un autre
navigateur. Le joueur perd son classement sans avoir rien fait.

Le code de récupération est une **deuxième façon de prouver qu'on est ce
joueur** — une ligne de plus dans cette table, pas un compte à part. Le serveur
n'en garde que l'empreinte SHA-256, dans `subject`, comme pour un appareil.

**Seize symboles de l'alphabet de Crockford, soit quatre-vingts bits.** Le
secret d'appareil en fait 256, et c'est pour cela qu'il est haché *sans sel* :
aucun dictionnaire ne peut exister pour cet espace. Un code lisible par un
humain ne peut pas faire 256 bits — mais recopier ce raisonnement sur un code
de soixante bits mettrait la base à portée d'une attaque hors ligne réaliste le
jour où elle fuiterait. `I`, `L`, `O` et `U` sont exclus : les trois premières
se confondent avec `1` et `0`, la dernière fabrique des mots qu'on ne veut pas
afficher.

Trois règles, et chacune a une raison qui se perd si on ne l'écrit pas :

- **Présenter un code ne le consomme pas.** On joue sur son téléphone et sur
  son ordinateur ; un code à usage unique obligerait à en redemander un après
  chaque appareil.
- **En redemander un remplace l'ancien.** C'est la seule façon de révoquer un
  code qui aurait traîné.
- **Le serveur ne sait pas le réafficher.** Il n'a que l'empreinte, et c'est
  voulu : une fonction « revoir mon code » serait une fonction « voler un compte
  depuis une session ouverte ».

**Le rattachement d'appareil, dans le même geste.** Présenter un code ouvre une
session, mais le navigateur garde *son* secret d'appareil : au rechargement
suivant il rouvrirait le compte invité local et la récupération serait perdue.
Le client tire donc un secret **neuf** (l'ancien appartient encore au compte
abandonné, et se heurterait à `@@unique([provider, subject])`) et l'envoie
**avec le code** : `POST /auth/recovery/claim { code, deviceSecret }` rattache
l'appareil puis ouvre la session. Il n'existe pas de route de rattachement à
part — un jeton volé suffisait à l'appeler (ADR 0013). Le client ne range le
secret neuf qu'une fois la requête acceptée. Là encore : on **ajoute** une
ligne, on n'en déplace aucune, et un joueur garde au plus dix appareils (les
plus anciens sont détachés).

### `EMAIL` — un email et un mot de passe

Même principe que le code : une ligne de plus, rattachée par un joueur
connecté (`POST /auth/email/link`), présentée d'ailleurs pour ouvrir le compte
(`POST /auth/email/login`, qui rattache l'appareil dans la même requête).

- **`subject` porte l'adresse normalisée** (rognée, en minuscules), **en
  clair** : c'est un identifiant qu'on cherche, pas un secret. Elle n'est ni
  vérifiée ni jamais écrite à personne — le serveur n'envoie aucun courrier.
- **`secretHash` porte le hachage argon2id du mot de passe** (ADR 0013), nul
  pour tous les autres fournisseurs. Une colonne à part plutôt que dans
  `subject` : `subject` est ce qu'on cherche (unique), le hachage est ce qu'on
  vérifie (salé, donc impossible à chercher).
- **Une adresse par joueur.** La contrainte `(provider, subject)` empêche deux
  joueurs de partager une adresse, pas un joueur d'en avoir deux : le
  rattachement verrouille la ligne du joueur (`FOR UPDATE`) le temps de
  vérifier et d'écrire.
- **Mot de passe oublié : le code de récupération.** `POST /auth/email/password`
  accepte l'ancien mot de passe **ou** le code comme preuve.
- **Rien ne sort :** `GET /auth/email` rend `linked` et l'adresse masquée
  (`k•••@gmail.com`), jamais l'adresse ni le hachage.

model Season {
  id        String   @id @default(uuid())
  number    Int      @unique
  startsAt  DateTime
  endsAt    DateTime
  ratings   Rating[]
}

model Rating {
  playerId     String
  seasonId     String
  mmr          Float    @default(1000)
  rd           Float    @default(350)     // si Glicko-2
  leaguePoints Int      @default(0)
  league       League   @default(SANS_AURA)
  placements   Int      @default(0)
  wins         Int      @default(0)
  losses       Int      @default(0)
  player       Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  season       Season   @relation(fields: [seasonId], references: [id])
  @@id([playerId, seasonId])
  @@index([seasonId, leaguePoints])
}
enum League { SANS_AURA NAISSANTE STABLE RAYONNANTE LEGENDAIRE INFINIE }

model Match {
  id             String      @id @default(uuid())
  mode           MatchMode
  rulesVersion   String
  contentVersion String
  seed           String
  status         MatchStatus @default(IN_PROGRESS)
  endReason      String?
  winnerSeat     Seat?
  isGhost        Boolean     @default(false)
  startedAt      DateTime    @default(now())
  endedAt        DateTime?
  seats          MatchSeat[]
  rounds         MatchRound[]
  events         Json?                        // journal compact des événements, pour rejouer
  @@index([startedAt])
}
enum MatchMode { RANKED CASUAL INVITE SOLO }
enum MatchStatus { IN_PROGRESS ENDED ABORTED }
enum Seat { LEFT RIGHT }

model MatchSeat {
  matchId    String
  seat       Seat
  playerId   String?                          // null pour un fantôme
  ghostOfId  String?
  mmrBefore  Float?
  mmrAfter   Float?
  lpDelta    Int?
  match      Match   @relation(fields: [matchId], references: [id], onDelete: Cascade)
  player     Player? @relation(fields: [playerId], references: [id])
  @@id([matchId, seat])
  @@index([playerId])
}

model MatchRound {
  matchId   String
  round     Int
  result    Json                               // RoundResult de @aura/rules
  match     Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  @@id([matchId, round])
}

model GhostRecording {
  id         String   @id @default(uuid())
  playerId   String
  mmr        Float
  rulesVersion String
  rounds     Json      // choix, timings et profils de recharge par manche
  createdAt  DateTime @default(now())
  @@index([rulesVersion, mmr])
}

model CosmeticItem {
  id          String       @id               // = id du fichier de contenu
  kind        CosmeticKind
  rarity      String
  priceSoft   Int?
  priceHard   Int?
  availableFrom DateTime?
  availableTo   DateTime?
}
enum CosmeticKind { ANIMATION AURA_EFFECT AURA_COLOR OUTFIT HAIR EMOTE BANNER }

model InventoryItem {
  playerId   String
  itemId     String
  acquiredAt DateTime @default(now())
  source     String                           // shop, pass, challenge, gift
  player     Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  @@id([playerId, itemId])
}

model Loadout {
  playerId  String @id
  data      Json                              // animation équipée par mouvement, effet par amplificateur, tenue…
  player    Player @relation(fields: [playerId], references: [id], onDelete: Cascade)
}

model PlayerChallenge {
  playerId  String
  day       String                            // AAAA-MM-JJ, fuseau Europe/Paris
  challengeId String
  progress  Int      @default(0)
  claimedAt DateTime?
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  @@id([playerId, day, challengeId])
}

model SeasonProgress {
  playerId  String
  seasonId  String
  xp        Int       @default(0)             // XP de saison, créditée en fin de match
  premiumAt DateTime?                         // piste premium achetée (jetons)
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  season    Season   @relation(fields: [seasonId], references: [id])
  @@id([playerId, seasonId])
}

model SeasonClaim {
  playerId  String
  seasonId  String
  tier      Int
  track     String                            // free | premium (contrainte CHECK)
  claimedAt DateTime @default(now())
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  season    Season   @relation(fields: [seasonId], references: [id])
  @@id([playerId, seasonId, tier, track])
}

model SuspicionFlag {
  id        String   @id @default(uuid())
  playerId  String
  matchId   String?
  kind      String                            // TAP_RATE, PERFECT_STREAK, TIMING_DISTRIBUTION…
  score     Float
  details   Json
  createdAt DateTime @default(now())
  @@index([playerId, createdAt])
}
```

## Inventaire : ce qui est offert

Les objets offerts ne sont **jamais écrits** dans `InventoryItem` : ils sont ajoutés à la lecture (`ownedWithFree`, module `inventory`), pour l'inventaire comme pour l'apparence annoncée en match. Un objet n'est offert que s'il remplit **toutes** ces conditions (`isOffered`) :

- `rarity = 'default'` — critère explicite, réservé par le contenu à ce qu'il offre ;
- `priceSoft = 0` et `priceHard` nul ;
- ni `availableFrom` ni `availableTo` : un objet limité dans le temps n'est jamais offert pour toujours ;
- un `kind` vendable (`PURCHASABLE_KINDS`).

Un prix de zéro sous une autre rareté est refusé par un test de `@aura/content` (`pricing.test.ts`). Ce qui a été acheté reste possédé quelles que soient ces conditions.

## Passe de saison : réclamer sans payer deux fois

Le palier se **déduit** de `SeasonProgress.xp` (`seasonTierFor`), il n'est pas stocké. Une réclamation insère `SeasonClaim` **puis** crédite, dans une transaction : la clé primaire `(playerId, seasonId, tier, track)` refuse la seconde avant tout crédit. Un cosmétique accordé s'écrit dans `InventoryItem` avec `source = 'pass'` ; s'il est déjà possédé au moment de l'écriture, la ligne n'est pas écrite et le joueur reçoit ses pièces à la place. L'achat du premium marque `premiumAt` (conditionné à `premiumAt IS NULL`) puis débite les jetons (conditionné à `hardCurrency >= prix`), dans une transaction.

## Loadout : un kind par emplacement

`Loadout.data` range chaque objet à sa place (`inventory/domain/slots.ts`) : `outfit` → `OUTFIT`, `hair` → `HAIR`, `auraColor` → `AURA_COLOR`, `auraEffect` → `AURA_EFFECT` (kind lu au catalogue) ; `dances["<style>.t<palier>"]` → une danse de **ce** mouvement ; `signature` → une danse de mouvement. `PUT /inventory/loadout` refuse le reste en `WRONG_SLOT`. Le match rejoue la même règle en lecture (`wearingFrom`) : un loadout ancien mal rangé, ou un objet que le catalogue ne connaît plus, n'est simplement pas annoncé à l'adversaire.

## Redis

| Clé | Contenu | Durée de vie |
|---|---|---|
| `queue:{mode}` | ZSET joueurs par MMR, valeur = `playerId` | tant qu'en file |
| `queue:ticket:{playerId}` | mode, MMR, heure d'entrée, région | 5 min |
| `invite:{code}` | `playerId` hôte | 10 min |
| `match:{id}:node` | nœud propriétaire | durée du match + 1 h |
| `match:{id}:snapshot` | état après chaque manche | durée du match + 1 h |
| `player:{id}:match` | match en cours (pour rejoin) | durée du match |
| `presence:{playerId}` | en ligne | 60 s, rafraîchie |
