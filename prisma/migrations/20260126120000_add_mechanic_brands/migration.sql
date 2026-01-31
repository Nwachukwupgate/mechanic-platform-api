-- AlterTable
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "brands" TEXT[] DEFAULT ARRAY[]::TEXT[];
