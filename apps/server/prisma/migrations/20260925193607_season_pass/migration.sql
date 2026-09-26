-- CreateTable
CREATE TABLE "SeasonProgress" (
    "playerId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "premiumAt" TIMESTAMP(3),

    CONSTRAINT "SeasonProgress_pkey" PRIMARY KEY ("playerId","seasonId")
);

-- CreateTable
CREATE TABLE "SeasonClaim" (
    "playerId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "track" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonClaim_pkey" PRIMARY KEY ("playerId","seasonId","tier","track")
);

-- AddForeignKey
ALTER TABLE "SeasonProgress" ADD CONSTRAINT "SeasonProgress_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonProgress" ADD CONSTRAINT "SeasonProgress_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonClaim" ADD CONSTRAINT "SeasonClaim_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonClaim" ADD CONSTRAINT "SeasonClaim_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ecrit a la main : Prisma ne connait pas les CHECK. Une piste inconnue ne
-- doit jamais pouvoir occuper une cle de reclamation.
ALTER TABLE "SeasonClaim" ADD CONSTRAINT "SeasonClaim_track_check" CHECK ("track" IN ('free', 'premium'));
