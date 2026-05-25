import { BadRequestException } from '@nestjs/common';
import { BookingStatus, PaymentMethod, SettlementPhase } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  computeBookingPaymentSummary,
  paymentAmountMinorForPhase,
  settlementPhaseForPayment,
  validateRepairInvoiceTotal,
} from '../bookings/booking-payment.util';
import { minorToNaira, nairaToMinor } from '../settlement/settlement-amounts';
import { SettlementService } from '../settlement/settlement.service';

export type BookingPaymentContext = {
  summary: ReturnType<typeof computeBookingPaymentSummary>;
  amountMinor: number;
  amountNaira: number;
  settlementPhase: SettlementPhase;
};

type BookingWithRelations = {
  id: string;
  userId: string;
  status: BookingStatus;
  estimatedCost: number | null;
  inspectionPaidAt: Date | null;
  inspectionPaidAmount: number | null;
  paidAt: Date | null;
  acceptedQuote?: {
    quoteType: string;
    customerTotalMinor: number | null;
    partsMinor: number | null;
    labourMinor: number | null;
    otherFeesMinor: number | null;
    proposedPrice: number | null;
  } | null;
  invoices?: Array<{
    id: string;
    status: string;
    source: string;
    customerTotalMinor: number;
    partsMinor: number;
    labourMinor: number;
    otherFeesMinor: number;
  }>;
};

export function buildBookingPaymentContext(booking: BookingWithRelations): BookingPaymentContext {
  const summary = computeBookingPaymentSummary({
    acceptedQuote: booking.acceptedQuote,
    inspectionPaidAt: booking.inspectionPaidAt,
    inspectionPaidAmount: booking.inspectionPaidAmount,
    paidAt: booking.paidAt,
    estimatedCost: booking.estimatedCost,
    invoices: booking.invoices,
  });

  const amountMinor = paymentAmountMinorForPhase(summary, booking.estimatedCost);
  if (amountMinor < 100) {
    throw new BadRequestException('No payment due for this booking at this stage');
  }

  if (summary.phase === 'repair_balance' && summary.repairTotalMinor != null) {
    validateRepairInvoiceTotal(summary.repairTotalMinor, summary.inspectionPaidMinor);
  }

  return {
    summary,
    amountMinor,
    amountNaira: minorToNaira(amountMinor),
    settlementPhase: settlementPhaseForPayment(summary),
  };
}

export async function applyBookingPaymentSuccess(
  booking: BookingWithRelations,
  ctx: BookingPaymentContext,
  paymentMethod: PaymentMethod,
  paystackReference: string | null | undefined,
  tx: Prisma.TransactionClient,
  settlementService: SettlementService,
  sourceTransactionId?: string,
): Promise<void> {
  const { summary, amountNaira, settlementPhase } = ctx;

  if (settlementPhase === SettlementPhase.INSPECTION) {
    if (booking.inspectionPaidAt) {
      throw new BadRequestException('Inspection fee already paid');
    }
    if (Math.abs(amountNaira - summary.inspectionFeeNaira) > 0.02) {
      throw new BadRequestException('Payment amount does not match inspection fee');
    }
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        inspectionPaidAt: new Date(),
        inspectionPaidAmount: amountNaira,
        inspectionPaymentMethod: paymentMethod,
        ...(paystackReference ? { inspectionPaystackReference: paystackReference } : {}),
      },
    });
    await settlementService.createSettlementForPaidBooking(
      booking.id,
      paymentMethod,
      sourceTransactionId,
      tx,
      SettlementPhase.INSPECTION,
    );
    return;
  }

  if (settlementPhase === SettlementPhase.REPAIR) {
    if (!booking.inspectionPaidAt) {
      throw new BadRequestException('Inspection fee must be paid first');
    }
    if (booking.paidAt) {
      throw new BadRequestException('Booking already fully paid');
    }
    if (Math.abs(amountNaira - summary.balanceDueNaira) > 0.02) {
      throw new BadRequestException('Payment amount does not match balance due');
    }
    const cumulative =
      Number(booking.inspectionPaidAmount ?? 0) + amountNaira;
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        paidAt: new Date(),
        paymentMethod: paymentMethod,
        paidAmount: cumulative,
        ...(paystackReference ? { paystackReference } : {}),
        status: BookingStatus.PAID,
      },
    });
    await settlementService.createSettlementForPaidBooking(
      booking.id,
      paymentMethod,
      sourceTransactionId,
      tx,
      SettlementPhase.REPAIR,
    );
    return;
  }

  if (booking.paidAt) {
    throw new BadRequestException('Booking already paid');
  }
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      paidAt: new Date(),
      paymentMethod: paymentMethod,
      paidAmount: amountNaira,
      ...(paystackReference ? { paystackReference } : {}),
      status: BookingStatus.PAID,
    },
  });
  await settlementService.createSettlementForPaidBooking(
    booking.id,
    paymentMethod,
    sourceTransactionId,
    tx,
    SettlementPhase.FULL,
  );
}

export function assertBookingPayableStatus(status: BookingStatus): void {
  const allowed: BookingStatus[] = [
    BookingStatus.ACCEPTED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.DONE,
  ];
  if (!allowed.includes(status)) {
    throw new BadRequestException('Booking must be accepted (or in progress / done) before payment');
  }
}
