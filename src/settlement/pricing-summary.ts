import {
  computeSettlementFromBreakdown,
  minorToNaira,
  SettlementAmounts,
} from './settlement-amounts';

export type PricingBreakdownInput = {
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
  customerTotalMinor: number;
};

export function buildPricingSummary(
  breakdown: PricingBreakdownInput | null,
  projected?: SettlementAmounts | null,
) {
  if (!breakdown || breakdown.customerTotalMinor <= 0) {
    return null;
  }
  const amounts =
    projected ??
    computeSettlementFromBreakdown({
      partsMinor: breakdown.partsMinor,
      labourMinor: breakdown.labourMinor,
      otherFeesMinor: breakdown.otherFeesMinor,
    });

  return {
    partsNaira: minorToNaira(breakdown.partsMinor),
    labourNaira: minorToNaira(breakdown.labourMinor),
    otherFeesNaira: minorToNaira(breakdown.otherFeesMinor),
    customerTotalNaira: minorToNaira(breakdown.customerTotalMinor),
    platformFeeNaira: minorToNaira(amounts.platformFeeMinor),
    mechanicEarningsNaira: minorToNaira(amounts.mechanicEarningsMinor),
    platformFeePercent: amounts.platformFeePercent,
    mechanicSharePercent: amounts.mechanicSharePercent,
    feeAppliesTo: 'labour' as const,
  };
}

export function settlementToPricingSummary(settlement: {
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
  customerTotalMinor: number;
  platformFeeMinor: number;
  mechanicEarningsMinor: number;
  platformFeePercent: number;
  mechanicSharePercent: number;
}) {
  return {
    partsNaira: minorToNaira(settlement.partsMinor),
    labourNaira: minorToNaira(settlement.labourMinor),
    otherFeesNaira: minorToNaira(settlement.otherFeesMinor),
    customerTotalNaira: minorToNaira(settlement.customerTotalMinor),
    platformFeeNaira: minorToNaira(settlement.platformFeeMinor),
    mechanicEarningsNaira: minorToNaira(settlement.mechanicEarningsMinor),
    platformFeePercent: settlement.platformFeePercent,
    mechanicSharePercent: settlement.mechanicSharePercent,
    feeAppliesTo: 'labour' as const,
    settled: true as const,
  };
}
