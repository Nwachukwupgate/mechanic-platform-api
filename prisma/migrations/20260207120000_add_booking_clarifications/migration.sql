-- CreateTable
CREATE TABLE "BookingClarification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingClarification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BookingClarification" ADD CONSTRAINT "BookingClarification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingClarification" ADD CONSTRAINT "BookingClarification_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
