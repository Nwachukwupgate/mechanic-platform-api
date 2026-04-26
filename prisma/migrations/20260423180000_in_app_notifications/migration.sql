-- CreateEnum
CREATE TYPE "NotificationRecipientRole" AS ENUM ('USER', 'MECHANIC');

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "recipientRole" "NotificationRecipientRole" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InAppNotification_recipientRole_recipientId_readAt_idx" ON "InAppNotification"("recipientRole", "recipientId", "readAt");

-- CreateIndex
CREATE INDEX "InAppNotification_recipientRole_recipientId_createdAt_idx" ON "InAppNotification"("recipientRole", "recipientId", "createdAt" DESC);
