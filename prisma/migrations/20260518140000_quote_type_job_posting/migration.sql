-- CreateEnum
CREATE TYPE "QuoteType" AS ENUM ('STANDARD', 'INSPECTION');

-- AlterTable
ALTER TABLE "BookingQuote" ADD COLUMN "quoteType" "QuoteType" NOT NULL DEFAULT 'STANDARD';
