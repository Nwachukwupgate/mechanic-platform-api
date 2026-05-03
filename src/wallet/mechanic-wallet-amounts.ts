/**
 * Single source of truth for platform fee (20%) vs mechanic share (80%) on job gross.
 * Booking.paidAmount is naira; wallet + Paystack use kobo (minor units).
 */

export const PLATFORM_FEE_PERCENT = 20;
export const MECHANIC_SHARE_PERCENT = 80;

/** Naira (as on Booking.paidAmount) → kobo. Invalid inputs → 0. */
export function grossNairaToKobo(grossNaira: number | null | undefined): number {
  if (grossNaira == null) return 0;
  const n = Number(grossNaira);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Platform 20% of gross in kobo (integer). */
export function platformKeepsMinorFromGrossKobo(grossKobo: number): number {
  if (grossKobo <= 0) return 0;
  return Math.round((grossKobo * PLATFORM_FEE_PERCENT) / 100);
}

/**
 * Mechanic 80% in kobo. Defined as gross − platform fee so fee + share always equals gross kobo.
 */
export function mechanicShareMinorFromGrossKobo(grossKobo: number): number {
  if (grossKobo <= 0) return 0;
  const fee = platformKeepsMinorFromGrossKobo(grossKobo);
  return Math.max(0, grossKobo - fee);
}

/** 20% platform fee owed on a direct-paid job (from recorded gross naira). */
export function directJobPlatformFeeMinorFromGrossNaira(grossNaira: number | null | undefined): number {
  return platformKeepsMinorFromGrossKobo(grossNairaToKobo(grossNaira));
}

/** Mechanic accrual for a platform-paid job (80% of gross). */
export function platformJobMechanicShareMinorFromGrossNaira(grossNaira: number | null | undefined): number {
  return mechanicShareMinorFromGrossKobo(grossNairaToKobo(grossNaira));
}
