-- AlterTable
ALTER TABLE "CodexToken" ADD COLUMN     "idToken" TEXT,
ADD COLUMN     "lastRefreshedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "image" TEXT;

-- CreateTable
CREATE TABLE "ConnectionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceAuthId" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "verificationUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodexCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "idToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodexCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectionJob_userId_status_idx" ON "ConnectionJob"("userId", "status");

-- CreateIndex
CREATE INDEX "ConnectionJob_deviceAuthId_idx" ON "ConnectionJob"("deviceAuthId");

-- CreateIndex
CREATE INDEX "CodexCredential_userId_revokedAt_idx" ON "CodexCredential"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "CodexCredential_userId_lastUsedAt_idx" ON "CodexCredential"("userId", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "ConnectionJob" ADD CONSTRAINT "ConnectionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexCredential" ADD CONSTRAINT "CodexCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
