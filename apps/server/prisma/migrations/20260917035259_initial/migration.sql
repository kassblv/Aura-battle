-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('DEVICE', 'APPLE', 'GOOGLE');

-- CreateEnum
CREATE TYPE "League" AS ENUM ('SANS_AURA', 'NAISSANTE', 'STABLE', 'RAYONNANTE', 'LEGENDAIRE', 'INFINIE');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('RANKED', 'CASUAL', 'INVITE', 'SOLO');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('IN_PROGRESS', 'ENDED', 'ABORTED');

-- CreateEnum
CREATE TYPE "Seat" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "CosmeticKind" AS ENUM ('ANIMATION', 'AURA_EFFECT', 'AURA_COLOR', 'OUTFIT', 'HAIR', 'EMOTE', 'BANNER');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "softCurrency" INTEGER NOT NULL DEFAULT 0,
    "hardCurrency" INTEGER NOT NULL DEFAULT 0,
    "bannedUntil" TIMESTAMP(3),

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "playerId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "mmr" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "leaguePoints" INTEGER NOT NULL DEFAULT 0,
    "league" "League" NOT NULL DEFAULT 'SANS_AURA',
    "placements" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("playerId","seasonId")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "mode" "MatchMode" NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "endReason" TEXT,
    "winnerSeat" "Seat",
    "isGhost" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "events" JSONB,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSeat" (
    "matchId" TEXT NOT NULL,
    "seat" "Seat" NOT NULL,
    "playerId" TEXT,
    "ghostOfId" TEXT,
    "mmrBefore" DOUBLE PRECISION,
    "mmrAfter" DOUBLE PRECISION,
    "lpDelta" INTEGER,

    CONSTRAINT "MatchSeat_pkey" PRIMARY KEY ("matchId","seat")
);

-- CreateTable
CREATE TABLE "MatchRound" (
    "matchId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "MatchRound_pkey" PRIMARY KEY ("matchId","round")
);

-- CreateTable
CREATE TABLE "GhostRecording" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "mmr" DOUBLE PRECISION NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "rounds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GhostRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CosmeticItem" (
    "id" TEXT NOT NULL,
    "kind" "CosmeticKind" NOT NULL,
    "rarity" TEXT NOT NULL,
    "priceSoft" INTEGER,
    "priceHard" INTEGER,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),

    CONSTRAINT "CosmeticItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "playerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("playerId","itemId")
);

-- CreateTable
CREATE TABLE "Loadout" (
    "playerId" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "Loadout_pkey" PRIMARY KEY ("playerId")
);

-- CreateIndex
CREATE INDEX "AuthIdentity_playerId_idx" ON "AuthIdentity"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_playerId_expiresAt_idx" ON "RefreshToken"("playerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Season_number_key" ON "Season"("number");

-- CreateIndex
CREATE INDEX "Rating_seasonId_leaguePoints_idx" ON "Rating"("seasonId", "leaguePoints");

-- CreateIndex
CREATE INDEX "Match_startedAt_idx" ON "Match"("startedAt");

-- CreateIndex
CREATE INDEX "MatchSeat_playerId_idx" ON "MatchSeat"("playerId");

-- CreateIndex
CREATE INDEX "GhostRecording_rulesVersion_mmr_idx" ON "GhostRecording"("rulesVersion", "mmr");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSeat" ADD CONSTRAINT "MatchSeat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSeat" ADD CONSTRAINT "MatchSeat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRound" ADD CONSTRAINT "MatchRound_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CosmeticItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loadout" ADD CONSTRAINT "Loadout_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
