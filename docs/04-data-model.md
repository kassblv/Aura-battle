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
  subject    String            // identifiant d'appareil, Apple sub, Google sub
  createdAt  DateTime @default(now())
  player     Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  @@unique([provider, subject])
}
enum AuthProvider { DEVICE APPLE GOOGLE }

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
