-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PLATFORM', 'DIRECT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('USER_PAYMENT', 'PLATFORM_PAYOUT', 'MECHANIC_FEE', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paidAmount" DOUBLE PRECISION,
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "paystackReference" TEXT;

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "paystackReference" TEXT,
    "userId" TEXT,
    "mechanicId" TEXT,
    "bookingId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
