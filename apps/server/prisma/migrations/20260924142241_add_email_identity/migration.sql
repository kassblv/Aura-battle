-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "AuthIdentity" ADD COLUMN     "secretHash" TEXT;
