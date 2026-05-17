import {
  computeSettlementFromBreakdown,
  platformFeeMinorFromLabour,
} from './settlement-amounts';

describe('settlement-amounts', () => {
  it('applies 20% platform fee on labour only', () => {
    const amounts = computeSettlementFromBreakdown({
      partsMinor: 4_000_000, // ₦40,000
      labourMinor: 2_000_000, // ₦20,000
      otherFeesMinor: 0,
    });
    expect(amounts.customerTotalMinor).toBe(6_000_000);
    expect(amounts.platformFeeMinor).toBe(400_000); // 20% of ₦20,000
    expect(amounts.mechanicEarningsMinor).toBe(5_600_000);
    expect(amounts.platformFeeMinor + amounts.mechanicEarningsMinor).toBe(
      amounts.customerTotalMinor,
    );
  });

  it('platformFeeMinorFromLabour rounds correctly', () => {
    expect(platformFeeMinorFromLabour(100_00)).toBe(20_00);
  });
});
