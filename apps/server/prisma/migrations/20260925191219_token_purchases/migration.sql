-- CreateTable
CREATE TABLE "TokenPurchase" (
    "eventId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "store" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenPurchase_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "TokenPurchase_playerId_idx" ON "TokenPurchase"("playerId");

-- AddForeignKey
ALTER TABLE "TokenPurchase" ADD CONSTRAINT "TokenPurchase_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
