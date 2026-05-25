import { InvoiceSource, InvoiceStatus, QuoteType } from '@prisma/client';
import {
  computeSettlementFromBreakdown,
  nairaToMinor,
  SettlementAmounts,
  minorToNaira,
} from '../settlement/settlement-amounts';

export type BookingPaymentPhase =
  | 'complete'
  | 'inspection'
  | 'awaiting_repair_invoice'
  | 'review_repair_invoice'
  | 'repair_balance'
  | 'standard';

export type BookingInvoiceLike = {
  id?: string;
  status: InvoiceStatus | string;
  source: InvoiceSource | string;
  customerTotalMinor: number;
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
};

export type AcceptedQuoteLike = {
  quoteType?: QuoteType | string;
  customerTotalMinor?: number | null;
  partsMinor?: number | null;
  labourMinor?: number | null;
  otherFeesMinor?: number | null;
  proposedPrice?: number | null;
};

export type BookingPaymentInput = {
  acceptedQuote?: AcceptedQuoteLike | null;
  inspectionPaidAt?: Date | null;
  inspectionPaidAmount?: number | null;
  paidAt?: Date | null;
  estimatedCost?: number | null;
  invoices?: BookingInvoiceLike[];
};

export type BookingPaymentSummary = {
  isInspectionFlow: boolean;
  phase: BookingPaymentPhase;
  inspectionFeeMinor: number;
  inspectionPaidMinor: number;
  repairTotalMinor: number | null;
  balanceDueMinor: number;
  inspectionFeeNaira: number;
  inspectionPaidNaira: number;
  repairTotalNaira: number | null;
  balanceDueNaira: number;
  totalPaidNaira: number;
  canPayInspection: boolean;
  canPayRepairBalance: boolean;
  canPayStandard: boolean;
};

export function isInspectionFlow(booking: BookingPaymentInput): boolean {
  return booking.acceptedQuote?.quoteType === QuoteType.INSPECTION;
}

/** Repair invoice submitted by mechanic after on-site inspection (not the accepted inspection quote). */
export function findRepairInvoice(
  invoices: BookingInvoiceLike[] | undefined,
  status: InvoiceStatus | InvoiceStatus[],
): BookingInvoiceLike | undefined {
  if (!invoices?.length) return undefined;
  const statuses = Array.isArray(status) ? status : [status];
  return invoices.find(
    (i) =>
      i.source === InvoiceSource.MECHANIC_MANUAL &&
      statuses.includes(i.status as InvoiceStatus),
  );
}

export function quoteBreakdownMinor(quote: AcceptedQuoteLike): {
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
  customerTotalMinor: number;
} {
  const customerTotalMinor =
    quote.customerTotalMinor ??
    (quote.proposedPrice != null ? Math.round(Number(quote.proposedPrice) * 100) : 0);
  return {
    partsMinor: quote.partsMinor ?? 0,
    labourMinor: quote.labourMinor ?? customerTotalMinor,
    otherFeesMinor: quote.otherFeesMinor ?? 0,
    customerTotalMinor,
  };
}

/** Remaining settlement slice for repair payment = full repair invoice minus inspection slice. */
export function computeRepairPhaseAmounts(
  repairInvoice: BookingInvoiceLike,
  inspectionBreakdown: {
    partsMinor: number;
    labourMinor: number;
    otherFeesMinor: number;
    customerTotalMinor: number;
  },
): SettlementAmounts {
  const full = computeSettlementFromBreakdown({
    partsMinor: repairInvoice.partsMinor,
    labourMinor: repairInvoice.labourMinor,
    otherFeesMinor: repairInvoice.otherFeesMinor,
  });
  const inspection = computeSettlementFromBreakdown(inspectionBreakdown);

  const customerTotalMinor = Math.max(
    0,
    full.customerTotalMinor - inspection.customerTotalMinor,
  );
  const partsMinor = Math.max(0, full.partsMinor - inspection.partsMinor);
  const labourMinor = Math.max(0, full.labourMinor - inspection.labourMinor);
  const otherFeesMinor = Math.max(0, full.otherFeesMinor - inspection.otherFeesMinor);
  const platformFeeMinor = Math.max(0, full.platformFeeMinor - inspection.platformFeeMinor);
  const mechanicEarningsMinor = Math.max(
    0,
    full.mechanicEarningsMinor - inspection.mechanicEarningsMinor,
  );

  return {
    partsMinor,
    labourMinor,
    otherFeesMinor,
    customerTotalMinor,
    platformFeeBaseMinor: labourMinor,
    platformFeeMinor,
    mechanicEarningsMinor,
    platformFeePercent: full.platformFeePercent,
    mechanicSharePercent: full.mechanicSharePercent,
    splitVersion: full.splitVersion,
  };
}

export function computeBalanceDueMinor(
  repairTotalMinor: number,
  inspectionPaidMinor: number,
): number {
  return Math.max(0, repairTotalMinor - inspectionPaidMinor);
}

export function computeBookingPaymentSummary(
  booking: BookingPaymentInput,
): BookingPaymentSummary {
  const inspectionFlow = isInspectionFlow(booking);
  const inspectionQuoteBreakdown = booking.acceptedQuote
    ? quoteBreakdownMinor(booking.acceptedQuote)
    : { partsMinor: 0, labourMinor: 0, otherFeesMinor: 0, customerTotalMinor: 0 };

  const inspectionFeeMinor = inspectionFlow ? inspectionQuoteBreakdown.customerTotalMinor : 0;
  const inspectionPaidMinor = nairaToMinor(booking.inspectionPaidAmount);

  const acceptedRepair = findRepairInvoice(booking.invoices, InvoiceStatus.ACCEPTED);
  const submittedRepair = findRepairInvoice(booking.invoices, InvoiceStatus.SUBMITTED);
  const repairTotalMinor = acceptedRepair?.customerTotalMinor ?? null;
  const balanceDueMinor =
    repairTotalMinor != null
      ? computeBalanceDueMinor(repairTotalMinor, inspectionPaidMinor)
      : 0;

  const fullyPaid = Boolean(booking.paidAt);
  const standardPayableMinor = nairaToMinor(booking.estimatedCost);

  let phase: BookingPaymentPhase = 'standard';
  if (fullyPaid) {
    phase = 'complete';
  } else if (inspectionFlow) {
    if (!booking.inspectionPaidAt) {
      phase = 'inspection';
    } else if (!acceptedRepair && !submittedRepair) {
      phase = 'awaiting_repair_invoice';
    } else if (submittedRepair && !acceptedRepair) {
      phase = 'review_repair_invoice';
    } else if (acceptedRepair && balanceDueMinor > 0) {
      phase = 'repair_balance';
    } else if (acceptedRepair && balanceDueMinor === 0) {
      phase = 'complete';
    } else {
      phase = 'awaiting_repair_invoice';
    }
  }

  const totalPaidNaira = minorToNaira(
    inspectionPaidMinor + (fullyPaid ? balanceDueMinor + inspectionPaidMinor : inspectionPaidMinor),
  );
  // When fully paid, paidAmount on booking is source of truth; summary uses cumulative
  const totalPaidFromBooking =
    booking.paidAt && booking.inspectionPaidAmount != null
      ? Number(booking.inspectionPaidAmount) +
        (repairTotalMinor != null ? minorToNaira(balanceDueMinor) : 0)
      : minorToNaira(inspectionPaidMinor);

  return {
    isInspectionFlow: inspectionFlow,
    phase,
    inspectionFeeMinor,
    inspectionPaidMinor,
    repairTotalMinor,
    balanceDueMinor,
    inspectionFeeNaira: minorToNaira(inspectionFeeMinor),
    inspectionPaidNaira: minorToNaira(inspectionPaidMinor),
    repairTotalNaira: repairTotalMinor != null ? minorToNaira(repairTotalMinor) : null,
    balanceDueNaira: minorToNaira(balanceDueMinor),
    totalPaidNaira: fullyPaid ? totalPaidFromBooking : minorToNaira(inspectionPaidMinor),
    canPayInspection: phase === 'inspection' && inspectionFeeMinor > 0,
    canPayRepairBalance: phase === 'repair_balance' && balanceDueMinor > 0,
    canPayStandard: !inspectionFlow && !fullyPaid && standardPayableMinor > 0,
  };
}

export function paymentAmountMinorForPhase(
  summary: BookingPaymentSummary,
  estimatedCostNaira?: number | null,
): number {
  switch (summary.phase) {
    case 'inspection':
      return summary.inspectionFeeMinor;
    case 'repair_balance':
      return summary.balanceDueMinor;
    case 'standard':
      return nairaToMinor(estimatedCostNaira);
    default:
      return 0;
  }
}

export function settlementPhaseForPayment(
  summary: BookingPaymentSummary,
): 'INSPECTION' | 'REPAIR' | 'FULL' {
  if (summary.phase === 'inspection') return 'INSPECTION';
  if (summary.phase === 'repair_balance') return 'REPAIR';
  return 'FULL';
}

/** Human-readable payment step for admin / support dashboards. */
export function paymentPhaseAdminLabel(phase: BookingPaymentPhase): string {
  switch (phase) {
    case 'inspection':
      return 'Awaiting inspection payment';
    case 'awaiting_repair_invoice':
      return 'Inspection paid — awaiting repair quote from mechanic';
    case 'review_repair_invoice':
      return 'Repair quote submitted — awaiting customer acceptance';
    case 'repair_balance':
      return 'Repair accepted — awaiting balance payment';
    case 'complete':
      return 'Fully paid';
    case 'standard':
      return 'Standard job — single payment';
    default:
      return phase;
  }
}

export function validateRepairInvoiceTotal(
  repairTotalMinor: number,
  inspectionPaidMinor: number,
): void {
  if (repairTotalMinor < inspectionPaidMinor) {
    throw new Error('REPAIR_TOTAL_BELOW_INSPECTION');
  }
}
