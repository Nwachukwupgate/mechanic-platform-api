-- AlterTable Mechanic: add isVerified
ALTER TABLE "Mechanic" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable MechanicProfile: add new required profile fields
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "vehicleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "experience" TEXT;
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "workshopAddress" TEXT;
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "certificateUrl" TEXT;
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "guarantorName" TEXT;
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "guarantorPhone" TEXT;
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "guarantorAddress" TEXT;
ALTER TABLE "MechanicProfile" ADD COLUMN IF NOT EXISTS "nin" TEXT;
