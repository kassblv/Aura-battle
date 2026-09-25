-- AlterTable
ALTER TABLE "MatchSeat" ADD COLUMN     "queueWaitMs" INTEGER;

-- CreateTable
CREATE TABLE "ProductEvent" (
    "playerId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("playerId","matchId","kind")
);

-- CreateIndex
CREATE INDEX "ProductEvent_matchId_kind_idx" ON "ProductEvent"("matchId", "kind");

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
