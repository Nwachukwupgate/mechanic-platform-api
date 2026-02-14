import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { PaystackService } from './paystack.service';
import {
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  BookingStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

const PLATFORM_FEE_PERCENT = 20; // we take 20%, mechanic gets 80%

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private paystack: PaystackService,
    private configService: ConfigService,
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
    const callbackUrl = frontendUrl ? `${frontendUrl.replace(/\/$/, '')}/user/wallet` : undefined;

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

  /** User: Verify Paystack payment and mark booking as paid (platform flow). */
  async verifyPayment(userId: string, reference: string) {
    const pending = await this.prisma.transaction.findFirst({
      where: {
        type: TransactionType.USER_PAYMENT,
        status: TransactionStatus.PENDING,
        paystackReference: reference,
        userId,
      },
      include: { booking: true },
    });
    if (!pending) throw new NotFoundException('Payment not found or already processed');

    const verify = await this.paystack.verifyTransaction(reference);
    if (!verify || verify.status !== 'success') {
      throw new BadRequestException('Payment verification failed or not successful');
    }

    const bookingId = pending.bookingId!;
    const amountNaira = verify.amount / 100;

    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: pending.id },
        data: { status: TransactionStatus.SUCCESS },
      }),
      this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          paidAt: new Date(),
          paymentMethod: PaymentMethod.PLATFORM,
          paidAmount: amountNaira,
          paystackReference: reference,
          status: BookingStatus.PAID,
        },
      }),
    ]);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { mechanic: true, vehicle: true, fault: true },
    });
    return { success: true, booking };
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

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        paidAt: new Date(),
        paymentMethod: PaymentMethod.DIRECT,
        paidAmount: amount,
        status: BookingStatus.PAID,
      },
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

  /** Mechanic: Balance we owe them (80% of platform-paid bookings minus payouts). */
  async getMechanicBalance(mechanicId: string) {
    const platformPaid = await this.prisma.booking.findMany({
      where: {
        mechanicId,
        paymentMethod: PaymentMethod.PLATFORM,
        paidAt: { not: null },
        paidAmount: { not: null },
      },
      select: { paidAmount: true },
    });
    const payouts = await this.prisma.transaction.findMany({
      where: {
        mechanicId,
        type: TransactionType.PLATFORM_PAYOUT,
        status: TransactionStatus.SUCCESS,
      },
      select: { amountMinor: true },
    });

    const totalEarnedMinor = platformPaid.reduce(
      (sum, b) => sum + Math.round((b.paidAmount ?? 0) * 100 * (1 - PLATFORM_FEE_PERCENT / 100)),
      0,
    );
    const totalPayoutMinor = payouts.reduce((sum, t) => sum + t.amountMinor, 0);
    const balanceMinor = Math.max(0, totalEarnedMinor - totalPayoutMinor);

    return {
      balanceMinor,
      balanceNaira: balanceMinor / 100,
      currency: 'NGN',
      totalEarnedFromPlatformMinor: totalEarnedMinor,
      totalPayoutsMinor: totalPayoutMinor,
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
          booking: { select: { id: true, status: true, vehicle: true, fault: true } },
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

  /** Mechanic: Full wallet summary (balance, owing, recent transactions). */
  async getMechanicWalletSummary(mechanicId: string) {
    const [balance, owing, recent] = await Promise.all([
      this.getMechanicBalance(mechanicId),
      this.getMechanicOwing(mechanicId),
      this.listMechanicTransactions(mechanicId, { limit: 10 }),
    ]);
    return {
      balance,
      owing,
      recentTransactions: recent.items,
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

  /** Generate a unique transfer reference (16–50 chars, lowercase alphanumeric, underscore, dash). */
  private transferReference(prefix: string): string {
    return `${prefix}_${randomBytes(8).toString('hex')}`;
  }

  /**
   * Mechanic: Request withdrawal. Sends money via Paystack Transfer to mechanic's default bank account, then records payout.
   */
  async requestWithdrawal(mechanicId: string, amountMinor: number) {
    const mechanic = await this.prisma.mechanic.findUnique({ where: { id: mechanicId } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    const balance = await this.getMechanicBalance(mechanicId);
    if (amountMinor <= 0) throw new BadRequestException('Amount must be positive');
    if (amountMinor > balance.balanceMinor) {
      throw new BadRequestException(`Amount exceeds balance (₦${(balance.balanceMinor / 100).toLocaleString()})`);
    }
    const bankAccount = await this.getDefaultBankAccount(mechanicId);
    if (!bankAccount) {
      throw new BadRequestException('Add a default bank account in Wallet before withdrawing');
    }

    const reference = this.transferReference('wd');
    let transferCode: string | undefined;
    try {
      const { recipientCode } = await this.paystack.createTransferRecipient(
        bankAccount.bankCode,
        bankAccount.accountNumber,
        bankAccount.accountName,
      );
      const result = await this.paystack.initiateTransfer(
        amountMinor,
        recipientCode,
        reference,
        `Withdrawal to ${mechanic.companyName}`,
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
        reference,
        mechanicId,
        description: `Withdrawal to ${bankAccount.bankName} · ${bankAccount.accountNumber}`,
        metadata: { transferCode, source: 'mechanic_withdrawal' },
      },
      include: { mechanic: { select: { id: true, companyName: true } } },
    });
    return tx;
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
      const { recipientCode } = await this.paystack.createTransferRecipient(
        bankAccount.bankCode,
        bankAccount.accountNumber,
        bankAccount.accountName,
      );
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
