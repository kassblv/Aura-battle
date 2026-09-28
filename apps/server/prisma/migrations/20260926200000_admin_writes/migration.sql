-- Panneau d'administration qui ecrit (ADR 0018) : journal, reglages de drapeaux
-- avec epoque, evenement force, motif de bannissement. Les affectations
-- existantes prennent l'epoque 1 (DEFAULT), dont le hachage est inchange.
-- DropIndex
DROP INDEX "FlagAssignment_flag_group_idx";

-- AlterTable
ALTER TABLE "FlagAssignment" DROP CONSTRAINT "FlagAssignment_pkey",
ADD COLUMN     "epoch" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "FlagAssignment_pkey" PRIMARY KEY ("playerId", "flag", "epoch");

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "bannedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FlagSetting" (
    "flag" TEXT NOT NULL,
    "rollout" INTEGER NOT NULL,
    "measureRollout" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "measureStartedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlagSetting_pkey" PRIMARY KEY ("flag")
);

-- CreateTable
CREATE TABLE "RuleEventOverride" (
    "week" INTEGER NOT NULL,
    "variant" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleEventOverride_pkey" PRIMARY KEY ("week")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAction_at_idx" ON "AdminAction"("at");

-- CreateIndex
CREATE INDEX "FlagAssignment_flag_epoch_group_idx" ON "FlagAssignment"("flag", "epoch", "group");

