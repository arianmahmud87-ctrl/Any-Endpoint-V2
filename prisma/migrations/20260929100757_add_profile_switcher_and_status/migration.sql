-- AlterTable
ALTER TABLE "CodexCredential" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "intelligentSwitcher" BOOLEAN NOT NULL DEFAULT true;
