import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  PaymentMethod,
  InvoiceStatus,
  QuoteStatus,
  Prisma,
} from '@prisma/client';
import {
  computeLegacySettlementFromGrossMinor,
  computeSettlementFromBreakdown,
  nairaToMinor,
  SettlementAmounts,
} from './settlement-amounts';

@Injectable()
export class SettlementService {
  constructor(private prisma: PrismaService) {}

  /** Resolve costing breakdown for a booking (accepted invoice > accepted quote > legacy gross). */
  async resolveBreakdownForBooking(bookingId: string): Promise<{
    partsMinor: number;
    labourMinor: number;
    otherFeesMinor: number;
    customerTotalMinor: number;
    invoiceId?: string;
    quoteId?: string;
    isLegacy: boolean;
  }> {
    const invoice = await this.prisma.bookingInvoice.findFirst({
      where: { bookingId, status: InvoiceStatus.ACCEPTED },
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

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        acceptedQuote: true,
        quotes: {
          where: { status: QuoteStatus.ACCEPTED },
          take: 1,
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const quote = booking.acceptedQuote ?? booking.quotes[0];
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
  }): SettlementAmounts {
    if (breakdown.isLegacy && breakdown.partsMinor === 0 && breakdown.otherFeesMinor === 0) {
      return computeLegacySettlementFromGrossMinor(breakdown.labourMinor);
    }
    return computeSettlementFromBreakdown(breakdown);
  }

  /**
   * Create immutable settlement when a booking is marked paid. Idempotent per booking.
   */
  async createSettlementForPaidBooking(
    bookingId: string,
    paymentMethod: PaymentMethod,
    sourceTransactionId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const existing = await db.bookingSettlement.findUnique({ where: { bookingId } });
    if (existing) return existing;

    const resolved = await this.resolveBreakdownForBooking(bookingId);
    if (resolved.customerTotalMinor <= 0) {
      return null;
    }

    const amounts = this.computeAmounts(resolved);

    return db.bookingSettlement.create({
      data: {
        bookingId,
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

  async getSettlementForBooking(bookingId: string) {
    return this.prisma.bookingSettlement.findUnique({ where: { bookingId } });
  }
}
