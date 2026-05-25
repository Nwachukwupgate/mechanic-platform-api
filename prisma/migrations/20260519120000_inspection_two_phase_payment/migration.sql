-- CreateEnum
CREATE TYPE "SettlementPhase" AS ENUM ('INSPECTION', 'REPAIR', 'FULL');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "inspectionPaidAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "inspectionPaidAmount" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "inspectionPaymentMethod" "PaymentMethod";
ALTER TABLE "Booking" ADD COLUMN "inspectionPaystackReference" TEXT;

-- AlterTable: multi-phase settlements per booking
ALTER TABLE "BookingSettlement" ADD COLUMN "phase" "SettlementPhase" NOT NULL DEFAULT 'FULL';

DROP INDEX IF EXISTS "BookingSettlement_bookingId_key";

CREATE UNIQUE INDEX "BookingSettlement_bookingId_phase_key" ON "BookingSettlement"("bookingId", "phase");
CREATE INDEX "BookingSettlement_bookingId_idx" ON "BookingSettlement"("bookingId");
