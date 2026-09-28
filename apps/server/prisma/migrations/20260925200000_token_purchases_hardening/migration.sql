-- DropForeignKey
ALTER TABLE "TokenPurchase" DROP CONSTRAINT "TokenPurchase_playerId_fkey";

-- AlterTable
ALTER TABLE "TokenPurchase" ADD COLUMN     "appUserId" TEXT NOT NULL,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "refundEventId" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL,
ADD COLUMN     "transactionId" TEXT NOT NULL,
ALTER COLUMN "playerId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "TokenPurchase_status_idx" ON "TokenPurchase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TokenPurchase_store_transactionId_key" ON "TokenPurchase"("store", "transactionId");

-- AddForeignKey
ALTER TABLE "TokenPurchase" ADD CONSTRAINT "TokenPurchase_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

