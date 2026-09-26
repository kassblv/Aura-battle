-- CreateEnum
CREATE TYPE "FlagGroup" AS ENUM ('treatment', 'control');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "intentBubble" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FlagAssignment" (
    "playerId" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "group" "FlagGroup" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagAssignment_pkey" PRIMARY KEY ("playerId","flag")
);

-- CreateIndex
CREATE INDEX "FlagAssignment_flag_group_idx" ON "FlagAssignment"("flag", "group");

-- AddForeignKey
ALTER TABLE "FlagAssignment" ADD CONSTRAINT "FlagAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

