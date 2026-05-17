/**
 * Labour-only platform fee (20%) vs mechanic share (80% on labour).
 * Parts and other fees pass through to the mechanic in full.
 */

export const PLATFORM_FEE_PERCENT = 20;
export const MECHANIC_SHARE_PERCENT = 80;
export const SETTLEMENT_SPLIT_VERSION = 1;

export type CostBreakdownMinor = {
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
};

export type SettlementAmounts = CostBreakdownMinor & {
  customerTotalMinor: number;
  platformFeeBaseMinor: number;
  platformFeeMinor: number;
  mechanicEarningsMinor: number;
  platformFeePercent: number;
  mechanicSharePercent: number;
  splitVersion: number;
};

export function nairaToMinor(naira: number | null | undefined): number {
  if (naira == null) return 0;
  const n = Number(naira);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function minorToNaira(minor: number): number {
  return minor / 100;
}

/** Platform fee applies to labour/service only (v1). */
export function platformFeeMinorFromLabour(labourMinor: number): number {
  if (labourMinor <= 0) return 0;
  return Math.round((labourMinor * PLATFORM_FEE_PERCENT) / 100);
}

export function computeSettlementFromBreakdown(
  breakdown: CostBreakdownMinor,
): SettlementAmounts {
  const partsMinor = Math.max(0, Math.round(breakdown.partsMinor));
  const labourMinor = Math.max(0, Math.round(breakdown.labourMinor));
  const otherFeesMinor = Math.max(0, Math.round(breakdown.otherFeesMinor));
  const customerTotalMinor = partsMinor + labourMinor + otherFeesMinor;
  const platformFeeBaseMinor = labourMinor;
  const platformFeeMinor = platformFeeMinorFromLabour(labourMinor);
  const mechanicFromLabour = Math.max(0, labourMinor - platformFeeMinor);
  const mechanicEarningsMinor = partsMinor + mechanicFromLabour + otherFeesMinor;

  return {
    partsMinor,
    labourMinor,
    otherFeesMinor,
    customerTotalMinor,
    platformFeeBaseMinor,
    platformFeeMinor,
    mechanicEarningsMinor,
    platformFeePercent: PLATFORM_FEE_PERCENT,
    mechanicSharePercent: MECHANIC_SHARE_PERCENT,
    splitVersion: SETTLEMENT_SPLIT_VERSION,
  };
}

/** Legacy paid jobs with no breakdown: treat full gross as labour. */
export function computeLegacySettlementFromGrossMinor(grossMinor: number): SettlementAmounts {
  return computeSettlementFromBreakdown({
    partsMinor: 0,
    labourMinor: grossMinor,
    otherFeesMinor: 0,
  });
}

export function validateBreakdownNaira(parts: number, labour: number, other: number): {
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
  customerTotalMinor: number;
  customerTotalNaira: number;
} {
  if (![parts, labour, other].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error('INVALID_BREAKDOWN');
  }
  const partsMinor = nairaToMinor(parts);
  const labourMinor = nairaToMinor(labour);
  const otherFeesMinor = nairaToMinor(other);
  const customerTotalMinor = partsMinor + labourMinor + otherFeesMinor;
  if (customerTotalMinor <= 0) {
    throw new Error('TOTAL_REQUIRED');
  }
  return {
    partsMinor,
    labourMinor,
    otherFeesMinor,
    customerTotalMinor,
    customerTotalNaira: minorToNaira(customerTotalMinor),
  };
}
