-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('MECHANIC_MANUAL', 'FROM_QUOTE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "acceptedQuoteId" TEXT;

-- AlterTable
ALTER TABLE "BookingQuote" ADD COLUMN "partsMinor" INTEGER,
ADD COLUMN "labourMinor" INTEGER,
ADD COLUMN "otherFeesMinor" INTEGER,
ADD COLUMN "customerTotalMinor" INTEGER;

-- CreateTable
CREATE TABLE "BookingInvoice" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "partsMinor" INTEGER NOT NULL DEFAULT 0,
    "labourMinor" INTEGER NOT NULL DEFAULT 0,
    "otherFeesMinor" INTEGER NOT NULL DEFAULT 0,
    "customerTotalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "notes" TEXT,
    "source" "InvoiceSource" NOT NULL DEFAULT 'MECHANIC_MANUAL',
    "quoteId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSettlement" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "quoteId" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "sourceTransactionId" TEXT,
    "customerTotalMinor" INTEGER NOT NULL,
    "partsMinor" INTEGER NOT NULL DEFAULT 0,
    "labourMinor" INTEGER NOT NULL DEFAULT 0,
    "otherFeesMinor" INTEGER NOT NULL DEFAULT 0,
    "platformFeeBaseMinor" INTEGER NOT NULL,
    "platformFeeMinor" INTEGER NOT NULL,
    "mechanicEarningsMinor" INTEGER NOT NULL,
    "splitVersion" INTEGER NOT NULL DEFAULT 1,
    "platformFeePercent" INTEGER NOT NULL DEFAULT 20,
    "mechanicSharePercent" INTEGER NOT NULL DEFAULT 80,
    "isLegacy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_acceptedQuoteId_key" ON "Booking"("acceptedQuoteId");

-- CreateIndex
CREATE INDEX "BookingInvoice_bookingId_status_idx" ON "BookingInvoice"("bookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSettlement_bookingId_key" ON "BookingSettlement"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSettlement_sourceTransactionId_key" ON "BookingSettlement"("sourceTransactionId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_acceptedQuoteId_fkey" FOREIGN KEY ("acceptedQuoteId") REFERENCES "BookingQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingInvoice" ADD CONSTRAINT "BookingInvoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingInvoice" ADD CONSTRAINT "BookingInvoice_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingInvoice" ADD CONSTRAINT "BookingInvoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "BookingQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSettlement" ADD CONSTRAINT "BookingSettlement_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSettlement" ADD CONSTRAINT "BookingSettlement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "BookingInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSettlement" ADD CONSTRAINT "BookingSettlement_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "BookingQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill quote breakdown from proposedPrice (legacy: all labour)
UPDATE "BookingQuote"
SET
  "partsMinor" = 0,
  "labourMinor" = ROUND("proposedPrice" * 100)::INTEGER,
  "otherFeesMinor" = 0,
  "customerTotalMinor" = ROUND("proposedPrice" * 100)::INTEGER
WHERE "customerTotalMinor" IS NULL AND "proposedPrice" > 0;
