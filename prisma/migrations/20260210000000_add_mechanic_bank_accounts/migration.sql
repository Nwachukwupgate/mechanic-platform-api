-- CreateTable
CREATE TABLE "MechanicBankAccount" (
    "id" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MechanicBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MechanicBankAccount_mechanicId_accountNumber_key" ON "MechanicBankAccount"("mechanicId", "accountNumber");

-- AddForeignKey
ALTER TABLE "MechanicBankAccount" ADD CONSTRAINT "MechanicBankAccount_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
