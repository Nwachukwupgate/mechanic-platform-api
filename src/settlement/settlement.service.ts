import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  PaymentMethod,
  InvoiceStatus,
  QuoteStatus,
  SettlementPhase,
  Prisma,
  QuoteType,
  InvoiceSource,
} from '@prisma/client';
import {
  computeLegacySettlementFromGrossMinor,
  computeSettlementFromBreakdown,
  nairaToMinor,
  SettlementAmounts,
} from './settlement-amounts';
import {
  computeRepairPhaseAmounts,
  findRepairInvoice,
  isInspectionFlow,
  quoteBreakdownMinor,
} from '../bookings/booking-payment.util';

@Injectable()
export class SettlementService {
  constructor(private prisma: PrismaService) {}

  /** Resolve costing breakdown for a booking (accepted repair invoice > accepted quote > legacy gross). */
  async resolveBreakdownForBooking(
    bookingId: string,
    phase: SettlementPhase = SettlementPhase.FULL,
  ): Promise<{
    partsMinor: number;
    labourMinor: number;
    otherFeesMinor: number;
    customerTotalMinor: number;
    invoiceId?: string;
    quoteId?: string;
    isLegacy: boolean;
  }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        acceptedQuote: true,
        invoices: { orderBy: { version: 'desc' } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (phase === SettlementPhase.INSPECTION) {
      if (!booking.acceptedQuote || booking.acceptedQuote.quoteType !== QuoteType.INSPECTION) {
        throw new BadRequestException('Not an inspection booking');
      }
      const q = quoteBreakdownMinor(booking.acceptedQuote);
      return { ...q, quoteId: booking.acceptedQuote.id, isLegacy: false };
    }

    if (phase === SettlementPhase.REPAIR) {
      const repairInvoice = findRepairInvoice(booking.invoices, InvoiceStatus.ACCEPTED);
      if (!repairInvoice) {
        throw new BadRequestException('No accepted repair invoice');
      }
      if (!booking.acceptedQuote || booking.acceptedQuote.quoteType !== QuoteType.INSPECTION) {
        throw new BadRequestException('Not an inspection booking');
      }
      const inspectionBreakdown = quoteBreakdownMinor(booking.acceptedQuote);
      const repairPhase = computeRepairPhaseAmounts(repairInvoice, inspectionBreakdown);
      return {
        partsMinor: repairPhase.partsMinor,
        labourMinor: repairPhase.labourMinor,
        otherFeesMinor: repairPhase.otherFeesMinor,
        customerTotalMinor: repairPhase.customerTotalMinor,
        invoiceId: repairInvoice.id,
        isLegacy: false,
      };
    }

    const repairInvoice = findRepairInvoice(booking.invoices, InvoiceStatus.ACCEPTED);
    if (repairInvoice) {
      return {
        partsMinor: repairInvoice.partsMinor,
        labourMinor: repairInvoice.labourMinor,
        otherFeesMinor: repairInvoice.otherFeesMinor,
        customerTotalMinor: repairInvoice.customerTotalMinor,
        invoiceId: repairInvoice.id,
        isLegacy: false,
      };
    }

    const invoice = await this.prisma.bookingInvoice.findFirst({
      where: { bookingId, status: InvoiceStatus.ACCEPTED, source: InvoiceSource.FROM_QUOTE },
      orderBy: { version: 'desc' },
    });
    if (invoice) {
      return {
        partsMinor: invoice.partsMinor,
        labourMinor: invoice.labourMinor,
        otherFeesMinor: invoice.otherFeesMinor,
        customerTotalMinor: invoice.customerTotalMinor,
        invoiceId: invoice.id,
        isLegacy: false,
      };
    }

    const quote = booking.acceptedQuote;
    if (quote?.customerTotalMinor != null && quote.customerTotalMinor > 0) {
      return {
        partsMinor: quote.partsMinor ?? 0,
        labourMinor: quote.labourMinor ?? quote.customerTotalMinor,
        otherFeesMinor: quote.otherFeesMinor ?? 0,
        customerTotalMinor: quote.customerTotalMinor,
        quoteId: quote.id,
        isLegacy: false,
      };
    }

    const grossNaira = booking.estimatedCost ?? booking.actualCost ?? booking.paidAmount;
    const grossMinor = nairaToMinor(grossNaira);
    if (grossMinor <= 0) {
      return {
        partsMinor: 0,
        labourMinor: 0,
        otherFeesMinor: 0,
        customerTotalMinor: 0,
        isLegacy: true,
      };
    }

    return {
      partsMinor: 0,
      labourMinor: grossMinor,
      otherFeesMinor: 0,
      customerTotalMinor: grossMinor,
      isLegacy: true,
    };
  }

  computeAmounts(breakdown: {
    partsMinor: number;
    labourMinor: number;
    otherFeesMinor: number;
    isLegacy?: boolean;
    customerTotalMinor?: number;
  }): SettlementAmounts {
    if (
      breakdown.customerTotalMinor != null &&
      breakdown.partsMinor + breakdown.labourMinor + breakdown.otherFeesMinor !==
        breakdown.customerTotalMinor
    ) {
      return computeSettlementFromBreakdown({
        partsMinor: breakdown.partsMinor,
        labourMinor: breakdown.labourMinor,
        otherFeesMinor: breakdown.otherFeesMinor,
      });
    }
    if (breakdown.isLegacy && breakdown.partsMinor === 0 && breakdown.otherFeesMinor === 0) {
      return computeLegacySettlementFromGrossMinor(breakdown.labourMinor);
    }
    return computeSettlementFromBreakdown(breakdown);
  }

  /**
   * Create immutable settlement for a payment phase. Idempotent per booking + phase.
   */
  async createSettlementForPaidBooking(
    bookingId: string,
    paymentMethod: PaymentMethod,
    sourceTransactionId?: string,
    tx?: Prisma.TransactionClient,
    phase: SettlementPhase = SettlementPhase.FULL,
  ) {
    const db = tx ?? this.prisma;
    const existing = await db.bookingSettlement.findUnique({
      where: { bookingId_phase: { bookingId, phase } },
    });
    if (existing) return existing;

    const resolved = await this.resolveBreakdownForBooking(bookingId, phase);
    if (resolved.customerTotalMinor <= 0) {
      return null;
    }

    const amounts = this.computeAmounts(resolved);

    return db.bookingSettlement.create({
      data: {
        bookingId,
        phase,
        invoiceId: resolved.invoiceId,
        quoteId: resolved.quoteId,
        paymentMethod,
        sourceTransactionId: sourceTransactionId ?? undefined,
        customerTotalMinor: amounts.customerTotalMinor,
        partsMinor: amounts.partsMinor,
        labourMinor: amounts.labourMinor,
        otherFeesMinor: amounts.otherFeesMinor,
        platformFeeBaseMinor: amounts.platformFeeBaseMinor,
        platformFeeMinor: amounts.platformFeeMinor,
        mechanicEarningsMinor: amounts.mechanicEarningsMinor,
        splitVersion: amounts.splitVersion,
        platformFeePercent: amounts.platformFeePercent,
        mechanicSharePercent: amounts.mechanicSharePercent,
        isLegacy: resolved.isLegacy,
      },
    });
  }

  async getSettlementsForBooking(bookingId: string) {
    return this.prisma.bookingSettlement.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getSettlementForBooking(bookingId: string, phase?: SettlementPhase) {
    if (phase) {
      return this.prisma.bookingSettlement.findUnique({
        where: { bookingId_phase: { bookingId, phase } },
      });
    }
    return this.prisma.bookingSettlement.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
