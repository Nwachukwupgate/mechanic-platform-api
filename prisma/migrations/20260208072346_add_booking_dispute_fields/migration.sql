-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputeResolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT;
