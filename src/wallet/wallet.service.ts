import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { PaystackService } from './paystack.service';
import {
  Prisma,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  BookingStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';

const PLATFORM_FEE_PERCENT = 20; // we take 20%, mechanic gets 80%

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private paystack: PaystackService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  /** User: Initialize Paystack payment for a booking (platform flow). */
  async initializePayment(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, mechanic: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.userId !== userId) throw new ForbiddenException('Not your booking');
    const allowedStatuses: BookingStatus[] = [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS, BookingStatus.DONE];
    if (!allowedStatuses.includes(booking.status)) {
      throw new BadRequestException('Booking must be accepted (or in progress / done) before payment');
    }
    if (booking.paidAt) throw new BadRequestException('Booking already paid');
    if (booking.estimatedCost == null || booking.estimatedCost <= 0) {
      throw new BadRequestException('Booking has no agreed cost');
    }

    const amountNaira = Math.ceil(booking.estimatedCost);
    const amountKobo = amountNaira * 100;
    const reference = `bk_${bookingId}_${randomBytes(8).toString('hex')}`;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
    // Paystack redirects here after payment with &reference= &trxref= appended. Include bookingId so the SPA can return to the booking.
    const callbackUrl = frontendUrl
      ? `${frontendUrl.replace(/\/$/, '')}/user/wallet?bookingId=${encodeURIComponent(bookingId)}`
      : undefined;

    const result = await this.paystack.initializeTransaction(
      amountKobo,
      booking.user.email,
      reference,
      { bookingId, userId },
      callbackUrl,
    );

    // Create pending USER_PAYMENT transaction so we can update it on verify
    await this.prisma.transaction.create({
      data: {
        type: TransactionType.USER_PAYMENT,
        amountMinor: amountKobo,
        currency: 'NGN',
        status: TransactionStatus.PENDING,
        reference,
        paystackReference: result.reference,
        userId,
        mechanicId: booking.mechanicId ?? undefined,
        bookingId,
        description: `Payment for booking ${bookingId}`,
        metadata: { authorization_url: result.authorization_url },
      },
    });

    return {
      authorizationUrl: result.authorization_url,
      accessCode: result.access_code,
      reference: result.reference,
    };
  }

  /** User: Verify Paystack payment and mark booking as paid (platform flow). Idempotent if already verified. */
  async verifyPayment(userId: string, reference: string) {
    const paystackRef = reference.trim();
    const alreadyDone = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.USER_PAYMENT,
        status: TransactionStatus.SUCCESS,
        paystackReference: paystackRef,
        userId,
      },
    });
    if (alreadyDone?.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: alreadyDone.bookingId },
        include: { mechanic: true, vehicle: true, fault: true },
      });
      return { success: true, booking, alreadyVerified: true as const };
    }

    const pending = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.USER_PAYMENT,
        status: TransactionStatus.PENDING,
        paystackReference: paystackRef,
        userId,
      },
    });
    if (!pending) {
      this.logger.warn(`verifyPayment: no pending tx userId=${userId} ref=${paystackRef}`);
      throw new NotFoundException('Payment not found or already processed');
    }

    const result = await this.finalizePendingUserPaymentWithPaystackVerify(paystackRef, pending.id);
    if (result.duplicate) {
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: pending.bookingId!,
          userId,
        },
        include: { mechanic: true, vehicle: true, fault: true },
      });
      return { success: true, booking, alreadyVerified: true as const };
    }
    if (!result.applied) {
      if (result.reason === 'verify_failed') {
        this.logger.warn(`verifyPayment: Paystack verify not success ref=${paystackRef}`);
        throw new BadRequestException('Payment verification failed or not successful');
      }
      if (result.reason === 'db_error') {
        throw new BadRequestException('Could not confirm payment. Try again or contact support.');
      }
      const fallback = await this.prisma.transaction.findFirst({
        where: {
          type: TransactionType.USER_PAYMENT,
          status: TransactionStatus.SUCCESS,
          paystackReference: paystackRef,
          userId,
        },
      });
      if (fallback?.bookingId) {
        const booking = await this.prisma.booking.findUnique({
          where: { id: fallback.bookingId },
          include: { mechanic: true, vehicle: true, fault: true },
        });
        return { success: true, booking, alreadyVerified: true as const };
      }
      throw new NotFoundException('Payment not found or already processed');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: pending.bookingId! },
      include: { mechanic: true, vehicle: true, fault: true },
    });
    return { success: true, booking };
  }

  /**
   * Called from Paystack `charge.success` webhook when the user never hits our redirect URL.
   * Idempotent and safe under concurrent client verify + webhook.
   */
  async finalizePaystackUserPaymentFromWebhook(paystackReference: string): Promise<{
    applied: boolean;
    duplicate?: boolean;
    reason?: string;
  }> {
    return this.finalizePendingUserPaymentWithPaystackVerify(paystackReference.trim());
  }

  /**
   * Safety net for historical/race edge-cases:
   * if USER_PAYMENT is SUCCESS but booking is not fully marked as platform-paid,
   * reconcile booking state so mechanic balance reflects the payment.
   */
  private async reconcileBookingFromSuccessfulUserPayment(
    txClient: Prisma.TransactionClient | PrismaService,
    paymentTx: {
      id: string;
      bookingId: string | null;
      amountMinor: number;
      paystackReference: string | null;
    },
  ): Promise<boolean> {
    if (!paymentTx.bookingId) {
      this.logger.warn(`reconcile USER_PAYMENT skipped: tx=${paymentTx.id} has no bookingId`);
      return false;
    }

    const booking = await txClient.booking.findUnique({
      where: { id: paymentTx.bookingId },
      select: {
        id: true,
        userId: true,
        mechanicId: true,
        paidAt: true,
        paymentMethod: true,
        paidAmount: true,
        paystackReference: true,
        status: true,
      },
    });
    if (!booking) {
      this.logger.error(`reconcile USER_PAYMENT failed: booking not found bookingId=${paymentTx.bookingId}`);
      return false;
    }

    if (booking.paymentMethod && booking.paymentMethod !== PaymentMethod.PLATFORM) {
      this.logger.error(
        `reconcile USER_PAYMENT skipped: booking=${booking.id} has paymentMethod=${booking.paymentMethod}`,
      );
      return false;
    }

    const alreadyConsistent =
      booking.paidAt != null &&
      booking.paymentMethod === PaymentMethod.PLATFORM &&
      booking.paidAmount != null &&
      booking.status === BookingStatus.PAID;
    if (alreadyConsistent) {
      return false;
    }

    const paidAmountNaira =
      booking.paidAmount != null && booking.paidAmount > 0
        ? booking.paidAmount
        : paymentTx.amountMinor / 100;

    await txClient.booking.update({
      where: { id: booking.id },
      data: {
        paidAt: booking.paidAt ?? new Date(),
        paymentMethod: PaymentMethod.PLATFORM,
        paidAmount: paidAmountNaira,
        paystackReference: booking.paystackReference ?? paymentTx.paystackReference ?? undefined,
        status: BookingStatus.PAID,
      },
    });

    this.eventEmitter.emit('booking.statusChanged', {
      bookingId: booking.id,
      status: BookingStatus.PAID,
      userId: booking.userId,
      mechanicId: booking.mechanicId,
    });
    this.logger.warn(`reconcile USER_PAYMENT applied bookingId=${booking.id} tx=${paymentTx.id}`);
    return true;
  }

  /**
   * Confirm pending USER_PAYMENT: verify with Paystack API, then atomically flip tx + booking to paid.
   */
  private async finalizePendingUserPaymentWithPaystackVerify(
    paystackRef: string,
    expectedPendingId?: string,
  ): Promise<{ applied: boolean; duplicate?: boolean; reason?: string }> {
    const successRow = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.USER_PAYMENT,
        status: TransactionStatus.SUCCESS,
        paystackReference: paystackRef,
      },
    });
    if (successRow) {
      await this.reconcileBookingFromSuccessfulUserPayment(this.prisma, {
        id: successRow.id,
        bookingId: successRow.bookingId,
        amountMinor: successRow.amountMinor,
        paystackReference: successRow.paystackReference,
      });
      return { applied: false, duplicate: true };
    }

    const pending = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.USER_PAYMENT,
        status: TransactionStatus.PENDING,
        paystackReference: paystackRef,
        ...(expectedPendingId ? { id: expectedPendingId } : {}),
      },
    });
    if (!pending?.bookingId) {
      this.logger.warn(`finalize Paystack: no pending USER_PAYMENT ref=${paystackRef}`);
      return { applied: false, reason: 'no_pending' };
    }

    const verify = await this.paystack.verifyTransaction(paystackRef);
    if (!verify || verify.status !== 'success') {
      this.logger.warn(`finalize Paystack: verify API not success ref=${paystackRef}`);
      return { applied: false, reason: 'verify_failed' };
    }

    const amountNaira = verify.amount / 100;
    const bookingId = pending.bookingId;
    const pendingId = pending.id;

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.transaction.updateMany({
          where: { id: pendingId, status: TransactionStatus.PENDING },
          data: { status: TransactionStatus.SUCCESS },
        });
        if (updated.count === 0) {
          return;
        }
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            paidAt: new Date(),
            paymentMethod: PaymentMethod.PLATFORM,
            paidAmount: amountNaira,
            paystackReference: paystackRef,
            status: BookingStatus.PAID,
          },
        });
      });
    } catch (e) {
      this.logger.error(`finalize Paystack: DB error ref=${paystackRef} ${String(e)}`);
      return { applied: false, reason: 'db_error' };
    }

    const confirmed = await this.prisma.transaction.findFirst({
      where: { id: pendingId, status: TransactionStatus.SUCCESS },
    });
    if (!confirmed) {
      return { applied: false, duplicate: true };
    }

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking) {
      this.eventEmitter.emit('booking.statusChanged', {
        bookingId: booking.id,
        status: BookingStatus.PAID,
        userId: booking.userId,
        mechanicId: booking.mechanicId,
      });
    }
    this.logger.log(`USER_PAYMENT finalized ref=${paystackRef} bookingId=${bookingId}`);
    return { applied: true };
  }

  /** User: Mark booking as paid directly to mechanic (direct flow). */
  async markDirectPaid(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.userId !== userId) throw new ForbiddenException('Not your booking');
    if (booking.paidAt) throw new BadRequestException('Booking already marked as paid');
    const amount = booking.estimatedCost ?? booking.actualCost ?? 0;
    if (amount <= 0) throw new BadRequestException('Booking has no cost');

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        paidAt: new Date(),
        paymentMethod: PaymentMethod.DIRECT,
        paidAmount: amount,
        status: BookingStatus.PAID,
      },
    });

    this.eventEmitter.emit('booking.statusChanged', {
      bookingId: updated.id,
      status: BookingStatus.PAID,
      userId: updated.userId,
      mechanicId: updated.mechanicId,
    });

    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { mechanic: true, vehicle: true, fault: true },
    });
  }

  /** User: List my transactions with optional filters. */
  async listUserTransactions(
    userId: string,
    options: { type?: TransactionType; limit?: number; offset?: number } = {},
  ) {
    const { type, limit = 50, offset = 0 } = options;
    const where: { userId: string; type?: TransactionType } = { userId };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
        include: {
          booking: { select: { id: true, status: true, vehicle: true, fault: true } },
          mechanic: { select: { id: true, companyName: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        type: t.type,
        amountMinor: t.amountMinor,
        amountNaira: t.amountMinor / 100,
        currency: t.currency,
        status: t.status,
        reference: t.reference,
        paystackReference: t.paystackReference,
        description: t.description,
        bookingId: t.bookingId,
        booking: t.booking,
        mechanic: t.mechanic,
        createdAt: t.createdAt,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Mechanic: Balance we owe them (80% of platform-paid bookings minus payouts).
   * Pass `tx` inside a Serializable transaction so concurrent withdrawals see a consistent snapshot.
   */
  async getMechanicBalance(mechanicId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const platformPaid = await db.booking.findMany({
      where: {
        mechanicId,
        paymentMethod: PaymentMethod.PLATFORM,
        paidAt: { not: null },
        paidAmount: { not: null },
      },
      select: { paidAmount: true },
    });
    const [payoutsSuccess, pendingWithdrawAgg] = await Promise.all([
      db.transaction.findMany({
        where: {
          mechanicId,
          type: TransactionType.PLATFORM_PAYOUT,
          status: TransactionStatus.SUCCESS,
        },
        select: { amountMinor: true },
      }),
      db.transaction.aggregate({
        where: {
          mechanicId,
          type: TransactionType.PLATFORM_PAYOUT,
          status: TransactionStatus.PENDING,
        },
        _sum: { amountMinor: true },
      }),
    ]);

    const totalEarnedMinor = platformPaid.reduce(
      (sum, b) => sum + Math.round((b.paidAmount ?? 0) * 100 * (1 - PLATFORM_FEE_PERCENT / 100)),
      0,
    );
    const totalPayoutMinor = payoutsSuccess.reduce((sum, t) => sum + t.amountMinor, 0);
    const pendingWithdrawalsMinor = pendingWithdrawAgg._sum.amountMinor ?? 0;
    /** Amount the mechanic can withdraw right now (excludes in-flight PAYOUT rows). */
    const balanceMinor = Math.max(0, totalEarnedMinor - totalPayoutMinor - pendingWithdrawalsMinor);

    return {
      balanceMinor,
      balanceNaira: balanceMinor / 100,
      currency: 'NGN',
      totalEarnedFromPlatformMinor: totalEarnedMinor,
      totalPayoutsMinor: totalPayoutMinor,
      pendingWithdrawalsMinor,
    };
  }

  /** Mechanic: Amount they owe us (20% of direct-paid bookings minus fees already paid). */
  async getMechanicOwing(mechanicId: string) {
    const directPaid = await this.prisma.booking.findMany({
      where: {
        mechanicId,
        paymentMethod: PaymentMethod.DIRECT,
        paidAt: { not: null },
        paidAmount: { not: null },
      },
      select: { paidAmount: true },
    });
    const feesPaid = await this.prisma.transaction.findMany({
      where: {
        mechanicId,
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.SUCCESS,
      },
      select: { amountMinor: true },
    });

    const totalFeeOwedMinor = directPaid.reduce(
      (sum, b) => sum + Math.round((b.paidAmount ?? 0) * 100 * (PLATFORM_FEE_PERCENT / 100)),
      0,
    );
    const totalPaidMinor = feesPaid.reduce((sum, t) => sum + t.amountMinor, 0);
    const owingMinor = Math.max(0, totalFeeOwedMinor - totalPaidMinor);

    return {
      owingMinor,
      owingNaira: owingMinor / 100,
      currency: 'NGN',
      totalFeeOwedMinor,
      totalFeePaidMinor: totalPaidMinor,
    };
  }

  /** Mechanic: List my transactions. */
  async listMechanicTransactions(
    mechanicId: string,
    options: { type?: TransactionType; limit?: number; offset?: number } = {},
  ) {
    const { type, limit = 50, offset = 0 } = options;
    const where: { mechanicId: string; type?: TransactionType } = { mechanicId };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              paidAmount: true,
              paymentMethod: true,
              vehicle: true,
              fault: true,
            },
          },
          user: { select: { id: true, email: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        type: t.type,
        amountMinor: t.amountMinor,
        amountNaira: t.amountMinor / 100,
        currency: t.currency,
        status: t.status,
        reference: t.reference,
        description: t.description,
        bookingId: t.bookingId,
        booking: t.booking,
        user: t.user,
        createdAt: t.createdAt,
      })),
      total,
      limit,
      offset,
    };
  }

  /** Open Paystack checkouts for mechanic platform fee (resume / cancel in client). */
  async listPendingMechanicFeeCheckouts(mechanicId: string) {
    const rows = await this.prisma.transaction.findMany({
      where: {
        mechanicId,
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amountMinor: true,
        reference: true,
        paystackReference: true,
        metadata: true,
        createdAt: true,
        bookingId: true,
        description: true,
      },
    });
    return rows.map((t) => {
      const meta = (t.metadata as Record<string, unknown> | null) || {};
      const authorizationUrl =
        typeof meta.authorization_url === 'string' ? meta.authorization_url : '';
      return {
        id: t.id,
        amountMinor: t.amountMinor,
        amountNaira: t.amountMinor / 100,
        internalReference: t.reference,
        paystackReference: t.paystackReference,
        authorizationUrl,
        createdAt: t.createdAt,
        bookingId: t.bookingId,
        description: t.description,
      };
    });
  }

  /** In-flight bank withdrawals (reserved against balance until Paystack completes or fails). */
  async listPendingWithdrawals(mechanicId: string) {
    const rows = await this.prisma.transaction.findMany({
      where: {
        mechanicId,
        type: TransactionType.PLATFORM_PAYOUT,
        status: TransactionStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amountMinor: true,
        reference: true,
        description: true,
        createdAt: true,
        metadata: true,
      },
    });
    return rows.map((t) => {
      const meta = (t.metadata as Record<string, unknown> | null) || {};
      const feeRaw = meta.feeChargedMinor;
      const feeChargedMinor = typeof feeRaw === 'number' ? feeRaw : undefined;
      return {
        id: t.id,
        amountMinor: t.amountMinor,
        amountNaira: t.amountMinor / 100,
        reference: t.reference,
        description: t.description,
        createdAt: t.createdAt,
        feeChargedMinor,
        feeChargedNaira: feeChargedMinor != null ? feeChargedMinor / 100 : undefined,
      };
    });
  }

  /** Mechanic: Full wallet summary — single net balance + breakdown + recent transactions. */
  async getMechanicWalletSummary(mechanicId: string) {
    const [balance, owing, recent, pendingPlatformFeeCheckouts, pendingWithdrawals] = await Promise.all([
      this.getMechanicBalance(mechanicId),
      this.getMechanicOwing(mechanicId),
      this.listMechanicTransactions(mechanicId, { limit: 20 }),
      this.listPendingMechanicFeeCheckouts(mechanicId),
      this.listPendingWithdrawals(mechanicId),
    ]);
    const netMinor = balance.balanceMinor - owing.owingMinor;
    return {
      balance: {
        netMinor,
        netNaira: netMinor / 100,
        availableToWithdrawMinor: balance.balanceMinor,
        availableToWithdrawNaira: balance.balanceNaira,
        unpaidPlatformFeeMinor: owing.owingMinor,
        unpaidPlatformFeeNaira: owing.owingNaira,
        totalEarnedFromPlatformMinor: balance.totalEarnedFromPlatformMinor,
        totalPayoutsMinor: balance.totalPayoutsMinor,
        pendingWithdrawalsMinor: balance.pendingWithdrawalsMinor,
        totalFeeOwedMinor: owing.totalFeeOwedMinor,
        totalFeePaidMinor: owing.totalFeePaidMinor,
        currency: 'NGN',
      },
      recentTransactions: recent.items,
      pendingPlatformFeeCheckouts,
      pendingWithdrawals,
    };
  }

  /**
   * Validates mechanic platform fee amount against direct-job owing and pending Paystack checkouts.
   * Used by manual fee recording and Paystack initialize.
   */
  private async assertMechanicFeePaymentAllowed(
    mechanicId: string,
    amountMinor: number,
    bookingId?: string,
  ): Promise<void> {
    if (amountMinor < 100) {
      throw new BadRequestException('Minimum amount is \u20A61 (100 kobo)');
    }

    const owing = await this.getMechanicOwing(mechanicId);

    if (bookingId) {
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, mechanicId },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.paymentMethod !== PaymentMethod.DIRECT) {
        throw new BadRequestException('Fee payments can only be allocated to direct-paid bookings');
      }
      if (!booking.paidAt || booking.paidAmount == null) {
        throw new BadRequestException('Booking must be marked paid');
      }
      const feeOwedMinor = Math.round((booking.paidAmount ?? 0) * 100 * (PLATFORM_FEE_PERCENT / 100));
      const paidAgg = await this.prisma.transaction.aggregate({
        where: {
          mechanicId,
          bookingId,
          type: TransactionType.MECHANIC_FEE,
          status: TransactionStatus.SUCCESS,
        },
        _sum: { amountMinor: true },
      });
      const pendingAgg = await this.prisma.transaction.aggregate({
        where: {
          mechanicId,
          bookingId,
          type: TransactionType.MECHANIC_FEE,
          status: TransactionStatus.PENDING,
        },
        _sum: { amountMinor: true },
      });
      const alreadyMinor =
        (paidAgg._sum.amountMinor ?? 0) + (pendingAgg._sum.amountMinor ?? 0);
      const remainingMinor = Math.max(0, feeOwedMinor - alreadyMinor);
      if (amountMinor > remainingMinor) {
        throw new BadRequestException(
          `Amount exceeds remaining fee for this booking (\u20A6${(remainingMinor / 100).toLocaleString()} left)`,
        );
      }
    } else {
      const pendingAll = await this.prisma.transaction.aggregate({
        where: {
          mechanicId,
          type: TransactionType.MECHANIC_FEE,
          status: TransactionStatus.PENDING,
        },
        _sum: { amountMinor: true },
      });
      const reservedMinor = pendingAll._sum.amountMinor ?? 0;
      const availableMinor = Math.max(0, owing.owingMinor - reservedMinor);
      if (amountMinor > availableMinor) {
        throw new BadRequestException(
          availableMinor <= 0
            ? 'You already have a pending platform fee checkout. Use Continue payment on the wallet screen, or cancel it to start a new one.'
            : `Amount exceeds available capacity (\u20A6${(availableMinor / 100).toLocaleString()}). Pending checkouts reduce what you can start.`,
        );
      }
    }
  }

  /** Mechanic: Initialize Paystack payment for platform fee (direct-job 20%). */
  async initializeMechanicFeePayment(
    mechanicId: string,
    amountMinor: number,
    bookingId?: string,
    note?: string,
  ) {
    await this.assertMechanicFeePaymentAllowed(mechanicId, amountMinor, bookingId);

    const mechanic = await this.prisma.mechanic.findUnique({ where: { id: mechanicId } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');

    const reference = `mfee_${randomBytes(12).toString('hex')}`;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
    const callbackUrl = frontendUrl
      ? `${frontendUrl.replace(/\/$/, '')}/mechanic/wallet`
      : undefined;

    const result = await this.paystack.initializeTransaction(
      amountMinor,
      mechanic.email,
      reference,
      {
        mechanicId,
        bookingId: bookingId ?? null,
        kind: 'mechanic_platform_fee',
      },
      callbackUrl,
    );

    const description =
      note?.trim() ||
      (bookingId
        ? `Platform fee (${PLATFORM_FEE_PERCENT}%) — direct job`
        : `Platform fee (${PLATFORM_FEE_PERCENT}% on direct jobs)`);

    await this.prisma.transaction.create({
      data: {
        type: TransactionType.MECHANIC_FEE,
        amountMinor,
        currency: 'NGN',
        status: TransactionStatus.PENDING,
        reference,
        paystackReference: result.reference,
        mechanicId,
        bookingId: bookingId ?? undefined,
        description,
        metadata: {
          source: 'paystack_pending',
          platformFeePercent: PLATFORM_FEE_PERCENT,
          ...(note?.trim() ? { note: note.trim() } : {}),
          authorization_url: result.authorization_url,
        },
      },
    });

    return {
      authorizationUrl: result.authorization_url,
      accessCode: result.access_code,
      reference: result.reference,
    };
  }

  /** Mechanic: Verify Paystack payment for platform fee. Idempotent if already SUCCESS. */
  async verifyMechanicFeePayment(mechanicId: string, reference: string) {
    const paystackRef = reference.trim();
    const alreadyDone = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.SUCCESS,
        paystackReference: paystackRef,
        mechanicId,
      },
    });
    if (alreadyDone) {
      return { success: true, alreadyVerified: true as const };
    }

    const pending = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.PENDING,
        paystackReference: paystackRef,
        mechanicId,
      },
    });
    if (!pending) {
      this.logger.warn(`verifyMechanicFeePayment: no pending tx mechanicId=${mechanicId} ref=${paystackRef}`);
      throw new NotFoundException('Payment not found or already processed');
    }

    const result = await this.finalizePendingMechanicFeeWithPaystackVerify(paystackRef, pending.id);
    if (result.duplicate) {
      return { success: true, alreadyVerified: true as const };
    }
    if (!result.applied) {
      if (result.reason === 'verify_failed') {
        this.logger.warn(`verifyMechanicFeePayment: Paystack verify not success ref=${paystackRef}`);
        throw new BadRequestException('Payment verification failed or not successful');
      }
      if (result.reason === 'amount_mismatch') {
        throw new BadRequestException('Paid amount does not match checkout. Contact support.');
      }
      if (result.reason === 'db_error') {
        throw new BadRequestException('Could not confirm payment. Try again or contact support.');
      }
      const fallback = await this.prisma.transaction.findFirst({
        where: {
          type: TransactionType.MECHANIC_FEE,
          status: TransactionStatus.SUCCESS,
          paystackReference: paystackRef,
          mechanicId,
        },
      });
      if (fallback) {
        return { success: true, alreadyVerified: true as const };
      }
      throw new NotFoundException('Payment not found or already processed');
    }

    return { success: true };
  }

  /**
   * Mechanic: Abandon a pending platform-fee Paystack checkout after confirming Paystack did not succeed.
   * If Paystack reports success, the payment is finalized instead of cancelled.
   */
  async cancelMechanicFeeCheckout(mechanicId: string, reference: string) {
    const ref = reference.trim();
    if (!ref) {
      throw new BadRequestException('reference is required');
    }

    const pending = await this.prisma.transaction.findFirst({
      where: {
        mechanicId,
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.PENDING,
        OR: [{ reference: ref }, { paystackReference: ref }],
      },
    });
    if (!pending) {
      throw new NotFoundException('No pending platform fee checkout found for that reference');
    }

    const paystackRef = (pending.paystackReference ?? pending.reference ?? ref).trim();
    if (!paystackRef) {
      throw new BadRequestException('Checkout has no Paystack reference; contact support');
    }

    const verify = await this.paystack.verifyTransaction(paystackRef);
    if (verify === null) {
      throw new ServiceUnavailableException(
        'Unable to confirm payment status with Paystack. Try again in a moment before cancelling.',
      );
    }

    if (verify.status === 'success') {
      const result = await this.finalizePendingMechanicFeeWithPaystackVerify(paystackRef, pending.id);
      if (result.applied || result.duplicate) {
        return { success: true, outcome: 'finalized' as const };
      }
      if (result.reason === 'amount_mismatch') {
        throw new BadRequestException('Paystack reports success but amount does not match. Contact support.');
      }
      if (result.reason === 'db_error') {
        throw new BadRequestException('Payment succeeded but confirmation failed. Try Verify again or contact support.');
      }
      const done = await this.prisma.transaction.findFirst({
        where: {
          type: TransactionType.MECHANIC_FEE,
          status: TransactionStatus.SUCCESS,
          paystackReference: paystackRef,
          mechanicId,
        },
      });
      if (done) {
        return { success: true, outcome: 'finalized' as const };
      }
      throw new BadRequestException('Could not finalize this payment. Try verifying from the wallet screen.');
    }

    const meta = (pending.metadata as Record<string, unknown> | null) || {};
    const updated = await this.prisma.transaction.updateMany({
      where: { id: pending.id, status: TransactionStatus.PENDING },
      data: {
        status: TransactionStatus.FAILED,
        metadata: {
          ...meta,
          cancelledAt: new Date().toISOString(),
          cancelReason: 'mechanic_cancelled_checkout',
        },
      },
    });
    if (updated.count === 0) {
      const stillThere = await this.prisma.transaction.findFirst({
        where: { id: pending.id, mechanicId, type: TransactionType.MECHANIC_FEE },
      });
      if (stillThere?.status === TransactionStatus.SUCCESS) {
        return { success: true, outcome: 'finalized' as const };
      }
      throw new ConflictException('This checkout was already updated. Refresh the wallet and try again.');
    }

    return { success: true, outcome: 'cancelled' as const };
  }

  /**
   * Webhook / internal: finalize MECHANIC_FEE after Paystack charge.success (when app verify is skipped).
   */
  async finalizePaystackMechanicFeeFromWebhook(paystackReference: string): Promise<{
    applied: boolean;
    duplicate?: boolean;
    reason?: string;
  }> {
    return this.finalizePendingMechanicFeeWithPaystackVerify(paystackReference.trim());
  }

  private async finalizePendingMechanicFeeWithPaystackVerify(
    paystackRef: string,
    expectedPendingId?: string,
  ): Promise<{ applied: boolean; duplicate?: boolean; reason?: string }> {
    const successRow = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.SUCCESS,
        paystackReference: paystackRef,
      },
    });
    if (successRow) {
      return { applied: false, duplicate: true };
    }

    const pending = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.MECHANIC_FEE,
        status: TransactionStatus.PENDING,
        paystackReference: paystackRef,
        ...(expectedPendingId ? { id: expectedPendingId } : {}),
      },
    });
    if (!pending) {
      this.logger.warn(`finalize mechanic fee: no pending MECHANIC_FEE ref=${paystackRef}`);
      return { applied: false, reason: 'no_pending' };
    }

    const verify = await this.paystack.verifyTransaction(paystackRef);
    if (!verify || verify.status !== 'success') {
      this.logger.warn(`finalize mechanic fee: verify API not success ref=${paystackRef}`);
      return { applied: false, reason: 'verify_failed' };
    }

    if (verify.amount !== pending.amountMinor) {
      this.logger.warn(
        `finalize mechanic fee: amount mismatch ref=${paystackRef} expected=${pending.amountMinor} got=${verify.amount}`,
      );
      return { applied: false, reason: 'amount_mismatch' };
    }

    const pendingId = pending.id;
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.transaction.updateMany({
          where: { id: pendingId, status: TransactionStatus.PENDING },
          data: {
            status: TransactionStatus.SUCCESS,
            metadata: {
              ...((pending.metadata as object) || {}),
              source: 'paystack',
              verifiedAt: new Date().toISOString(),
            },
          },
        });
        if (updated.count === 0) {
          return;
        }
      });
    } catch (e) {
      this.logger.error(`finalize mechanic fee: DB error ref=${paystackRef} ${String(e)}`);
      return { applied: false, reason: 'db_error' };
    }

    const confirmed = await this.prisma.transaction.findFirst({
      where: { id: pendingId, status: TransactionStatus.SUCCESS },
    });
    if (!confirmed) {
      return { applied: false, duplicate: true };
    }

    this.logger.log(`MECHANIC_FEE finalized ref=${paystackRef} mechanicId=${pending.mechanicId}`);
    return { applied: true };
  }

  /** Mechanic: record a platform fee payment (e.g. after customer paid them directly). */
  async recordMechanicFeePayment(
    mechanicId: string,
    amountMinor: number,
    bookingId?: string,
    note?: string,
  ) {
    await this.assertMechanicFeePaymentAllowed(mechanicId, amountMinor, bookingId);

    const reference = `fee_${randomBytes(8).toString('hex')}`;
    return this.prisma.transaction.create({
      data: {
        type: TransactionType.MECHANIC_FEE,
        amountMinor,
        currency: 'NGN',
        status: TransactionStatus.SUCCESS,
        reference,
        mechanicId,
        bookingId: bookingId ?? undefined,
        description:
          note?.trim() ||
          (bookingId
            ? `Platform fee (${PLATFORM_FEE_PERCENT}%) — direct job`
            : `Platform fee payment (${PLATFORM_FEE_PERCENT}% on direct jobs)`),
        metadata: { source: 'mechanic_recorded', platformFeePercent: PLATFORM_FEE_PERCENT },
      },
    });
  }

  private enrichTransactionForDetail(t: any) {
    const b = t.booking;
    const grossNaira = b?.paidAmount != null ? Number(b.paidAmount) : null;
    let feeSplit:
      | {
          grossNaira: number;
          platformFeePercent: number;
          mechanicSharePercent: number;
          platformKeepsNaira: number | null;
          mechanicShareNaira: number | null;
          directFeeOwedNaira: number | null;
        }
      | undefined;

    if (b && grossNaira != null && grossNaira > 0) {
      const grossMinor = Math.round(grossNaira * 100);
      const platformKeepsMinor = Math.round(grossMinor * (PLATFORM_FEE_PERCENT / 100));
      const mechanicShareMinor = grossMinor - platformKeepsMinor;
      if (b.paymentMethod === PaymentMethod.PLATFORM) {
        feeSplit = {
          grossNaira,
          platformFeePercent: PLATFORM_FEE_PERCENT,
          mechanicSharePercent: 100 - PLATFORM_FEE_PERCENT,
          platformKeepsNaira: platformKeepsMinor / 100,
          mechanicShareNaira: mechanicShareMinor / 100,
          directFeeOwedNaira: null,
        };
      } else if (b.paymentMethod === PaymentMethod.DIRECT) {
        feeSplit = {
          grossNaira,
          platformFeePercent: PLATFORM_FEE_PERCENT,
          mechanicSharePercent: 100 - PLATFORM_FEE_PERCENT,
          platformKeepsNaira: null,
          mechanicShareNaira: grossNaira,
          directFeeOwedNaira: platformKeepsMinor / 100,
        };
      }
    }

    const lines: { label: string; value: string }[] = [];
    const meta = (t.metadata as Record<string, unknown> | null) || {};
    if (t.type === TransactionType.PLATFORM_PAYOUT) {
      lines.push({ label: 'Type', value: 'Withdrawal / payout to your bank' });
      if (typeof meta.transferCode === 'string' && meta.transferCode.trim()) {
        lines.push({ label: 'Paystack transfer', value: meta.transferCode.trim() });
      }
      if (typeof meta.feeChargedMinor === 'number' && meta.feeChargedMinor > 0) {
        lines.push({
          label: 'Paystack transfer fee',
          value: `\u20A6${(meta.feeChargedMinor / 100).toLocaleString()} (charged to platform)`,
        });
      }
    } else if (t.type === TransactionType.MECHANIC_FEE) {
      lines.push({
        label: 'Type',
        value: `Platform fee (${PLATFORM_FEE_PERCENT}% on direct customer payments)`,
      });
    } else if (t.type === TransactionType.USER_PAYMENT) {
      lines.push({ label: 'Type', value: 'Customer payment via platform' });
    } else if (t.type === TransactionType.REFUND) {
      lines.push({ label: 'Type', value: 'Refund' });
    }

    if (feeSplit) {
      lines.push({
        label: 'Job amount (customer)',
        value: `\u20A6${feeSplit.grossNaira.toLocaleString()}`,
      });
      if (feeSplit.platformKeepsNaira != null) {
        lines.push({
          label: 'Platform retains',
          value: `\u20A6${feeSplit.platformKeepsNaira.toLocaleString()} (${PLATFORM_FEE_PERCENT}%)`,
        });
      }
      if (feeSplit.mechanicShareNaira != null && t.type !== TransactionType.MECHANIC_FEE) {
        lines.push({
          label: 'Your share (accrued)',
          value: `\u20A6${feeSplit.mechanicShareNaira.toLocaleString()} (${100 - PLATFORM_FEE_PERCENT}%)`,
        });
      }
      if (feeSplit.directFeeOwedNaira != null) {
        lines.push({
          label: 'Platform fee owed on this job',
          value: `\u20A6${feeSplit.directFeeOwedNaira.toLocaleString()}`,
        });
      }
    }

    return {
      id: t.id,
      type: t.type,
      amountMinor: t.amountMinor,
      amountNaira: t.amountMinor / 100,
      currency: t.currency,
      status: t.status,
      reference: t.reference,
      paystackReference: t.paystackReference,
      description: t.description,
      bookingId: t.bookingId,
      metadata: t.metadata,
      createdAt: t.createdAt,
      booking: t.booking,
      user: t.user,
      feeSplit,
      detailLines: lines,
    };
  }

  async getMechanicTransactionById(mechanicId: string, id: string) {
    const t = await this.prisma.transaction.findFirst({
      where: { id, mechanicId },
      include: {
        booking: {
          include: {
            vehicle: true,
            fault: true,
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        },
        user: { select: { id: true, email: true } },
      },
    });
    if (!t) throw new NotFoundException('Transaction not found');
    return this.enrichTransactionForDetail(t);
  }

  async getUserTransactionById(userId: string, id: string) {
    const t = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: {
        booking: {
          include: {
            vehicle: true,
            fault: true,
            mechanic: { select: { id: true, companyName: true } },
          },
        },
        mechanic: { select: { id: true, companyName: true } },
      },
    });
    if (!t) throw new NotFoundException('Transaction not found');
    const grossNaira = t.booking?.paidAmount != null ? Number(t.booking.paidAmount) : null;
    const feeSplit =
      t.booking && grossNaira != null && grossNaira > 0
        ? {
            grossNaira,
            platformFeePercent: PLATFORM_FEE_PERCENT,
            mechanicSharePercent: 100 - PLATFORM_FEE_PERCENT,
            platformKeepsNaira: Math.round(grossNaira * 100 * (PLATFORM_FEE_PERCENT / 100)) / 100,
            mechanicShareNaira: Math.round(grossNaira * 100 * (1 - PLATFORM_FEE_PERCENT / 100)) / 100,
          }
        : undefined;
    return {
      id: t.id,
      type: t.type,
      amountMinor: t.amountMinor,
      amountNaira: t.amountMinor / 100,
      currency: t.currency,
      status: t.status,
      reference: t.reference,
      paystackReference: t.paystackReference,
      description: t.description,
      bookingId: t.bookingId,
      metadata: t.metadata,
      createdAt: t.createdAt,
      booking: t.booking,
      mechanic: t.mechanic,
      feeSplit,
      detailLines: [
        {
          label: 'Type',
          value:
            t.type === TransactionType.USER_PAYMENT ? 'Payment for booking' : String(t.type),
        },
        ...(feeSplit
          ? [
              {
                label: 'Total charged',
                value: `\u20A6${feeSplit.grossNaira.toLocaleString()}`,
              },
              {
                label: 'Platform & mechanic split',
                value: `${PLATFORM_FEE_PERCENT}% / ${100 - PLATFORM_FEE_PERCENT}%`,
              },
            ]
          : []),
      ],
    };
  }

  /** Get default bank account for a mechanic. */
  private async getDefaultBankAccount(mechanicId: string) {
    const account = await this.prisma.mechanicBankAccount.findFirst({
      where: { mechanicId, isDefault: true },
    });
    if (!account) return null;
    return account;
  }

  /** Create or reuse Paystack transfer recipient for this saved bank account. */
  private async resolvePaystackRecipientCode(account: {
    id: string;
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
    paystackRecipientCode: string | null;
  }): Promise<string> {
    if (account.paystackRecipientCode?.trim()) {
      return account.paystackRecipientCode.trim();
    }
    const { recipientCode } = await this.paystack.createTransferRecipient(
      account.bankCode,
      account.accountNumber,
      account.accountName,
    );
    await this.prisma.mechanicBankAccount.update({
      where: { id: account.id },
      data: { paystackRecipientCode: recipientCode },
    });
    return recipientCode;
  }

  /** Generate a unique transfer reference (16–50 chars, lowercase alphanumeric, underscore, dash). */
  private transferReference(prefix: string): string {
    return `${prefix}_${randomBytes(8).toString('hex')}`;
  }

  /**
   * Paystack `transfer.success` webhook: mark matching PENDING payout as SUCCESS (idempotent).
   */
  async finalizeTransferPayoutFromWebhook(params: {
    reference: string;
    transferCode?: string;
    amount?: number;
    feeCharged?: number;
  }): Promise<{ applied: boolean; duplicate?: boolean; reason?: string }> {
    const reference = params.reference.trim();
    if (!reference) return { applied: false, reason: 'no_reference' };

    const already = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.PLATFORM_PAYOUT,
        status: TransactionStatus.SUCCESS,
        reference,
      },
    });
    if (already) {
      return { applied: false, duplicate: true };
    }

    const pending = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.PLATFORM_PAYOUT,
        status: TransactionStatus.PENDING,
        reference,
      },
    });
    if (!pending) {
      this.logger.warn(`transfer webhook: no PENDING payout for reference=${reference}`);
      return { applied: false, reason: 'no_pending' };
    }

    if (params.amount != null && params.amount !== pending.amountMinor) {
      this.logger.error(
        `transfer webhook: amount mismatch ref=${reference} expected=${pending.amountMinor} got=${params.amount}`,
      );
      return { applied: false, reason: 'amount_mismatch' };
    }

    let feeCharged = params.feeCharged ?? 0;
    let transferCode = params.transferCode?.trim() ?? '';
    const meta = (pending.metadata as Record<string, unknown> | null) || {};
    if (!transferCode && typeof meta.transferCode === 'string') {
      transferCode = meta.transferCode;
    }
    if (feeCharged === 0 && transferCode) {
      const fetched = await this.paystack.fetchTransfer(transferCode);
      if (fetched) feeCharged = fetched.feeCharged;
    }

    const mergedMeta = {
      ...(JSON.parse(JSON.stringify(meta || {})) as Record<string, string | number | boolean | null>),
      transferCode: transferCode || (typeof meta.transferCode === 'string' ? meta.transferCode : ''),
      feeChargedMinor: feeCharged,
      paystackTransferStatus: 'success',
      finalizedVia: 'paystack_webhook',
      webhookAt: new Date().toISOString(),
      source: typeof meta.source === 'string' ? meta.source : 'mechanic_withdrawal',
    };

    const updated = await this.prisma.transaction.updateMany({
      where: { id: pending.id, status: TransactionStatus.PENDING },
      data: {
        status: TransactionStatus.SUCCESS,
        metadata: mergedMeta as Prisma.InputJsonValue,
      },
    });
    if (updated.count === 0) {
      return { applied: false, duplicate: true };
    }
    this.logger.log(`PLATFORM_PAYOUT finalized via webhook ref=${reference}`);
    return { applied: true };
  }

  /**
   * Paystack `transfer.failed` / `transfer.reversed`: release reserved payout row.
   */
  async failTransferPayoutFromWebhook(
    reference: string,
    extra: { reason: string; event?: string },
  ): Promise<{ applied: boolean }> {
    const ref = reference.trim();
    if (!ref) return { applied: false };

    const row = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.PLATFORM_PAYOUT,
        status: TransactionStatus.PENDING,
        reference: ref,
      },
    });
    if (!row) {
      return { applied: false };
    }

    const oldMeta = (row.metadata as Record<string, unknown> | null) || {};
    const metaPatch = {
      ...oldMeta,
      webhookFailedAt: new Date().toISOString(),
      webhookFailureReason: extra.reason.slice(0, 500),
      webhookEvent: extra.event ?? 'unknown',
    };

    const res = await this.prisma.transaction.updateMany({
      where: { id: row.id, status: TransactionStatus.PENDING },
      data: {
        status: TransactionStatus.FAILED,
        metadata: metaPatch as Prisma.InputJsonValue,
      },
    });

    if (res.count === 0) {
      return { applied: false };
    }
    this.logger.warn(`PLATFORM_PAYOUT marked FAILED from webhook ref=${ref} reason=${extra.reason}`);
    return { applied: true };
  }

  /** Route Paystack transfer lifecycle webhooks (configure in Paystack Dashboard). */
  async applyPaystackTransferWebhook(event: string, data: Record<string, unknown>): Promise<void> {
    const reference = typeof data.reference === 'string' ? data.reference.trim() : '';
    if (!reference) {
      this.logger.warn(`Paystack transfer webhook ${event}: missing reference`);
      return;
    }

    if (event === 'transfer.success') {
      const amount = typeof data.amount === 'number' ? data.amount : undefined;
      const fee =
        typeof data.fee_charged === 'number'
          ? data.fee_charged
          : typeof data.feeCharged === 'number'
            ? data.feeCharged
            : undefined;
      const transferCode = typeof data.transfer_code === 'string' ? data.transfer_code : undefined;
      const out = await this.finalizeTransferPayoutFromWebhook({
        reference,
        transferCode,
        amount,
        feeCharged: fee,
      });
      this.logger.log(`transfer.success ref=${reference} result=${JSON.stringify(out)}`);
      return;
    }

    if (event === 'transfer.failed' || event === 'transfer.reversed') {
      const failures = data.failures != null ? JSON.stringify(data.failures) : '';
      const gateway =
        typeof data.gateway_response === 'string' ? data.gateway_response : '';
      const reason =
        typeof data.reason === 'string'
          ? data.reason
          : [failures, gateway, event].filter(Boolean).join(' · ') || event;
      await this.failTransferPayoutFromWebhook(reference, { reason, event });
    }
  }

  /**
   * Mechanic: Request withdrawal. Reserves balance (PENDING) under Serializable isolation, sends Paystack transfer.
   * Live transfers often return `pending`; final SUCCESS is applied via `transfer.success` webhook (or immediately in test).
   */
  async requestWithdrawal(mechanicId: string, amountMinor: number) {
    const bankAccount = await this.getDefaultBankAccount(mechanicId);
    if (!bankAccount) {
      throw new BadRequestException('Add a default bank account in Wallet before withdrawing');
    }

    const reference = this.transferReference('wd');
    const description = `Withdrawal to ${bankAccount.bankName} · ${bankAccount.accountNumber}`;

    let pendingRow: { id: string; metadata: unknown };
    try {
      pendingRow = await this.prisma.$transaction(
        async (tx) => {
          const mechanic = await tx.mechanic.findUnique({ where: { id: mechanicId } });
          if (!mechanic) throw new NotFoundException('Mechanic not found');

          const balance = await this.getMechanicBalance(mechanicId, tx);
          if (amountMinor <= 0) throw new BadRequestException('Amount must be positive');
          if (amountMinor > balance.balanceMinor) {
            throw new BadRequestException(
              `Amount exceeds balance (₦${(balance.balanceMinor / 100).toLocaleString()})`,
            );
          }

          return tx.transaction.create({
            data: {
              type: TransactionType.PLATFORM_PAYOUT,
              amountMinor,
              currency: 'NGN',
              status: TransactionStatus.PENDING,
              reference,
              mechanicId,
              description,
              metadata: { source: 'mechanic_withdrawal', phase: 'reserved' },
            },
            select: { id: true, metadata: true },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 15000,
        },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2028')) {
        throw new ConflictException(
          'Another withdrawal updated your balance at the same time. Please try again in a few seconds.',
        );
      }
      throw e;
    }

    const mechanic = await this.prisma.mechanic.findUnique({ where: { id: mechanicId } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');

    const markFailed = async (extraMeta: Record<string, unknown>) => {
      const meta = (pendingRow.metadata as Record<string, unknown> | null) || {};
      await this.prisma.transaction.updateMany({
        where: { id: pendingRow.id, status: TransactionStatus.PENDING },
        data: {
          status: TransactionStatus.FAILED,
          metadata: { ...meta, ...extraMeta, failedAt: new Date().toISOString() },
        },
      });
    };

    let transferCode: string;
    let paystackTransferStatus: string;
    try {
      const recipientCode = await this.resolvePaystackRecipientCode(bankAccount);
      const result = await this.paystack.initiateTransfer(
        amountMinor,
        recipientCode,
        reference,
        `Withdrawal to ${mechanic.companyName}`,
      );
      transferCode = result.transferCode;
      paystackTransferStatus = result.status;
    } catch (err: any) {
      const msg = err?.message ?? 'Transfer failed';
      await markFailed({ errorMessage: String(msg) });
      throw new BadRequestException(typeof msg === 'string' ? msg : 'Transfer failed');
    }

    const last4 =
      bankAccount.accountNumber.length >= 4
        ? bankAccount.accountNumber.slice(-4)
        : bankAccount.accountNumber;

    const baseMeta = {
      ...((pendingRow.metadata as Record<string, unknown> | null) || {}),
      transferCode,
      paystackTransferStatus,
      source: 'mechanic_withdrawal',
    };

    try {
      if (paystackTransferStatus === 'success') {
        let feeCharged = 0;
        const fetched = await this.paystack.fetchTransfer(transferCode);
        if (fetched) feeCharged = fetched.feeCharged;

        const updated = await this.prisma.transaction.update({
          where: { id: pendingRow.id, status: TransactionStatus.PENDING },
          data: {
            status: TransactionStatus.SUCCESS,
            metadata: {
              ...baseMeta,
              feeChargedMinor: feeCharged,
              finalizedVia: 'paystack_immediate',
            },
          },
        });
        return {
          success: true,
          transferStatus: 'completed' as const,
          id: updated.id,
          amountMinor,
          amountNaira: amountMinor / 100,
          destinationBank: bankAccount.bankName,
          destinationAccountLast4: last4,
          reference: updated.reference,
          paystackTransferStatus,
          feeChargedMinor: feeCharged,
          feeChargedNaira: feeCharged / 100,
        };
      }

      await this.prisma.transaction.update({
        where: { id: pendingRow.id },
        data: {
          metadata: {
            ...baseMeta,
            phase: 'paystack_queued',
          },
        },
      });

      return {
        success: true,
        transferStatus: 'processing' as const,
        id: pendingRow.id,
        amountMinor,
        amountNaira: amountMinor / 100,
        destinationBank: bankAccount.bankName,
        destinationAccountLast4: last4,
        reference,
        paystackTransferStatus,
        feeChargedMinor: null as number | null,
        feeChargedNaira: null as number | null,
      };
    } catch (e) {
      this.logger.error(
        `Withdrawal Paystack accepted but DB update failed pendingId=${pendingRow.id} ref=${reference} ${String(e)}`,
      );
      throw new BadRequestException(
        `Transfer may have been queued. Save this reference: ${reference}. If your balance does not update, wait a few minutes or contact support.`,
      );
    }
  }

  /**
   * Admin: Record a payout to a mechanic. Sends money via Paystack Transfer to mechanic's default bank, then records payout.
   */
  async recordPayout(mechanicId: string, amountMinor: number, reference?: string, adminId?: string) {
    const mechanic = await this.prisma.mechanic.findUnique({ where: { id: mechanicId } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    const balance = await this.getMechanicBalance(mechanicId);
    if (amountMinor <= 0) throw new BadRequestException('Amount must be positive');
    if (amountMinor > balance.balanceMinor) {
      throw new BadRequestException(`Amount exceeds balance (₦${(balance.balanceMinor / 100).toLocaleString()})`);
    }
    const bankAccount = await this.getDefaultBankAccount(mechanicId);
    if (!bankAccount) {
      throw new BadRequestException('Mechanic has no default bank account. Ask them to add one in their Wallet.');
    }

    const ref = reference?.replace(/[^a-z0-9_-]/g, '_').toLowerCase().slice(0, 50) || this.transferReference('payout');
    const finalRef = ref.length >= 16 ? ref : `${ref}_${randomBytes(4).toString('hex')}`;
    let transferCode: string | undefined;
    try {
      const recipientCode = await this.resolvePaystackRecipientCode(bankAccount);
      const result = await this.paystack.initiateTransfer(
        amountMinor,
        recipientCode,
        finalRef,
        `Payout to ${mechanic.companyName}`,
      );
      transferCode = result.transferCode;
    } catch (err: any) {
      const msg = err?.message ?? 'Transfer failed';
      throw new BadRequestException(msg);
    }

    const tx = await this.prisma.transaction.create({
      data: {
        type: TransactionType.PLATFORM_PAYOUT,
        amountMinor,
        currency: 'NGN',
        status: TransactionStatus.SUCCESS,
        reference: finalRef,
        mechanicId,
        description: `Payout to ${mechanic.companyName}`,
        metadata: adminId ? { adminId, transferCode } : { transferCode },
      },
      include: { mechanic: { select: { id: true, companyName: true } } },
    });
    return tx;
  }
}
