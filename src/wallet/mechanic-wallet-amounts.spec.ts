import {
  PLATFORM_FEE_PERCENT,
  MECHANIC_SHARE_PERCENT,
  grossNairaToKobo,
  platformKeepsMinorFromGrossKobo,
  mechanicShareMinorFromGrossKobo,
  directJobPlatformFeeMinorFromGrossNaira,
  platformJobMechanicShareMinorFromGrossNaira,
} from './mechanic-wallet-amounts';

describe('mechanic-wallet-amounts', () => {
  it('uses 20 / 80 product split constants', () => {
    expect(PLATFORM_FEE_PERCENT + MECHANIC_SHARE_PERCENT).toBe(100);
  });

  it('grossNairaToKobo rounds naira to integer kobo', () => {
    expect(grossNairaToKobo(null)).toBe(0);
    expect(grossNairaToKobo(undefined)).toBe(0);
    expect(grossNairaToKobo(NaN)).toBe(0);
    expect(grossNairaToKobo(-1)).toBe(0);
    expect(grossNairaToKobo(100)).toBe(10000);
    expect(grossNairaToKobo(100.335)).toBe(10034);
  });

  it('fee + mechanic share equals gross kobo for representative amounts', () => {
    for (const grossKobo of [1, 99, 100, 101, 10_000, 100_033, 1_999_999]) {
      const fee = platformKeepsMinorFromGrossKobo(grossKobo);
      const share = mechanicShareMinorFromGrossKobo(grossKobo);
      expect(fee + share).toBe(grossKobo);
    }
  });

  it('matches legacy formula for platform fee on naira', () => {
    const naira = 100.33;
    const legacy = Math.round(naira * 100 * (PLATFORM_FEE_PERCENT / 100));
    expect(directJobPlatformFeeMinorFromGrossNaira(naira)).toBe(legacy);
  });

  it('matches legacy formula for mechanic share on naira', () => {
    const naira = 50_000.5;
    const legacy = Math.round(naira * 100 * (1 - PLATFORM_FEE_PERCENT / 100));
    expect(platformJobMechanicShareMinorFromGrossNaira(naira)).toBe(legacy);
  });
});
