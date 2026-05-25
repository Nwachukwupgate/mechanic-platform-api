import { InvoiceSource, InvoiceStatus, QuoteType } from '@prisma/client';
import {
  computeBalanceDueMinor,
  computeBookingPaymentSummary,
  computeRepairPhaseAmounts,
  quoteBreakdownMinor,
} from './booking-payment.util';
import { computeSettlementFromBreakdown } from '../settlement/settlement-amounts';

describe('booking-payment.util', () => {
  const inspectionQuote = {
    quoteType: QuoteType.INSPECTION,
    customerTotalMinor: 500_000,
    partsMinor: 0,
    labourMinor: 500_000,
    otherFeesMinor: 0,
    proposedPrice: 5000,
  };

  const repairInvoice = {
    status: InvoiceStatus.ACCEPTED,
    source: InvoiceSource.MECHANIC_MANUAL,
    partsMinor: 2_000_000,
    labourMinor: 3_000_000,
    otherFeesMinor: 500_000,
    customerTotalMinor: 5_500_000,
  };

  it('computes balance due as repair total minus inspection paid', () => {
    expect(computeBalanceDueMinor(5_500_000, 500_000)).toBe(5_000_000);
    expect(computeBalanceDueMinor(5_500_000, 0)).toBe(5_500_000);
  });

  it('repair phase amounts plus inspection equal full repair invoice totals', () => {
    const inspection = quoteBreakdownMinor(inspectionQuote);
    const repairPhase = computeRepairPhaseAmounts(repairInvoice, inspection);
    const full = computeSettlementFromBreakdown({
      partsMinor: repairInvoice.partsMinor,
      labourMinor: repairInvoice.labourMinor,
      otherFeesMinor: repairInvoice.otherFeesMinor,
    });

    expect(repairPhase.customerTotalMinor + inspection.customerTotalMinor).toBe(
      repairInvoice.customerTotalMinor,
    );
    expect(repairPhase.mechanicEarningsMinor + 400_000).toBe(full.mechanicEarningsMinor);
    expect(repairPhase.platformFeeMinor + 100_000).toBe(full.platformFeeMinor);
  });

  it('payment phases for inspection flow', () => {
    let summary = computeBookingPaymentSummary({
      acceptedQuote: inspectionQuote,
      invoices: [],
    });
    expect(summary.phase).toBe('inspection');
    expect(summary.canPayInspection).toBe(true);

    summary = computeBookingPaymentSummary({
      acceptedQuote: inspectionQuote,
      inspectionPaidAt: new Date(),
      inspectionPaidAmount: 5000,
      invoices: [repairInvoice],
    });
    expect(summary.phase).toBe('repair_balance');
    expect(summary.balanceDueNaira).toBe(50000);
  });

  it('balance due never goes negative when repair equals inspection paid', () => {
    expect(computeBalanceDueMinor(500_000, 500_000)).toBe(0);
  });

  it('repair phase customer total equals balance due in minor units', () => {
    const inspection = { partsMinor: 0, labourMinor: 500_000, otherFeesMinor: 0, customerTotalMinor: 500_000 };
    const repairInvoice = {
      status: InvoiceStatus.ACCEPTED,
      source: InvoiceSource.MECHANIC_MANUAL,
      partsMinor: 2_000_000,
      labourMinor: 3_000_000,
      otherFeesMinor: 500_000,
      customerTotalMinor: 5_500_000,
    };
    const repairPhase = computeRepairPhaseAmounts(repairInvoice, inspection);
    expect(repairPhase.customerTotalMinor).toBe(5_000_000);
    expect(computeBalanceDueMinor(repairInvoice.customerTotalMinor, inspection.customerTotalMinor)).toBe(
      repairPhase.customerTotalMinor,
    );
  });
});
