-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "BookingQuote" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "proposedPrice" DOUBLE PRECISION NOT NULL,
    "message" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingQuote_bookingId_mechanicId_key" ON "BookingQuote"("bookingId", "mechanicId");

-- AddForeignKey
ALTER TABLE "BookingQuote" ADD CONSTRAINT "BookingQuote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingQuote" ADD CONSTRAINT "BookingQuote_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
