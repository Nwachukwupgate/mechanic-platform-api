-- BookingStatus.EXPIRED
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';

-- Booking: photos + open-request expiry
ALTER TABLE "Booking" ADD COLUMN "photoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Booking" ADD COLUMN "openRequestExpiresAt" TIMESTAMP(3);

-- MechanicProfile: SLA + next slot
ALTER TABLE "MechanicProfile" ADD COLUMN "typicalResponseHours" INTEGER;
ALTER TABLE "MechanicProfile" ADD COLUMN "nextAvailableNote" TEXT;

-- BookingQuote: revision cap tracking
ALTER TABLE "BookingQuote" ADD COLUMN "priceUpdateCount" INTEGER NOT NULL DEFAULT 0;

-- Message read receipt timestamp
ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);

-- User / Mechanic push tokens (Expo)
ALTER TABLE "User" ADD COLUMN "expoPushToken" TEXT;
ALTER TABLE "Mechanic" ADD COLUMN "expoPushToken" TEXT;

-- BookingReport
CREATE TABLE "BookingReport" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reporterRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BookingReport_bookingId_idx" ON "BookingReport"("bookingId");
ALTER TABLE "BookingReport" ADD CONSTRAINT "BookingReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- User blocks mechanic
CREATE TABLE "UserBlocksMechanic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBlocksMechanic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserBlocksMechanic_userId_mechanicId_key" ON "UserBlocksMechanic"("userId", "mechanicId");
ALTER TABLE "UserBlocksMechanic" ADD CONSTRAINT "UserBlocksMechanic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlocksMechanic" ADD CONSTRAINT "UserBlocksMechanic_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
