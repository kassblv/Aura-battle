-- CreateTable
CREATE TABLE "PlayerChallenge" (
    "playerId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "challengeId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "PlayerChallenge_pkey" PRIMARY KEY ("playerId","day","challengeId")
);

-- CreateIndex
CREATE INDEX "PlayerChallenge_playerId_day_idx" ON "PlayerChallenge"("playerId", "day");

-- AddForeignKey
ALTER TABLE "PlayerChallenge" ADD CONSTRAINT "PlayerChallenge_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
