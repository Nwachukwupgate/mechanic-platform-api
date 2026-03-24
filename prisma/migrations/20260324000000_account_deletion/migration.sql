-- CreateTable
CREATE TABLE "AccountDeletionLog" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "otherText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Mechanic" ADD COLUMN "deletedAt" TIMESTAMP(3);
