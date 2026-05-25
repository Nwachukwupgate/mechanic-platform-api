import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { BookingsService } from '../bookings/bookings.service';
import { paymentPhaseAdminLabel } from '../bookings/booking-payment.util';
import { Prisma, UserRole, BookingStatus, TransactionType, TransactionStatus, QuoteType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { ADMIN_PERMISSIONS } from '../common/guards/admin-permissions';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private bookingsService: BookingsService,
  ) {}

  private async logAudit(
    adminId: string,
    action: string,
    entityType?: string | null,
    entityId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        metadata: metadata ? (metadata as object) : undefined,
      },
    });
  }

  async getStats() {
    const [usersCount, mechanicsCount, bookingsCount, transactionsSum, disputedCount] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.USER } }),
      this.prisma.mechanic.count(),
      this.prisma.booking.count(),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.USER_PAYMENT, status: TransactionStatus.SUCCESS },
        _sum: { amountMinor: true },
      }),
      this.prisma.booking.count({ where: { disputeReason: { not: null }, disputeResolvedAt: null } }),
    ]);
    const revenueMinor = transactionsSum._sum.amountMinor ?? 0;
    const verifiedMechanics = await this.prisma.mechanic.count({ where: { isVerified: true } });
    const bookingsByStatus = await this.prisma.booking.groupBy({
      by: ['status'],
      _count: { id: true },
    });
    return {
      usersCount,
      mechanicsCount,
      verifiedMechanics,
      bookingsCount,
      revenueMinor,
      revenueNaira: revenueMinor / 100,
      disputedCount,
      bookingsByStatus: Object.fromEntries(bookingsByStatus.map((b) => [b.status, b._count.id])),
    };
  }

  async listUsers(params: { page?: number; limit?: number; search?: string; emailVerified?: boolean }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: any = { role: UserRole.USER };
    if (params.emailVerified !== undefined) where.emailVerified = params.emailVerified;
    if (params.search?.trim()) {
      where.OR = [
        { email: { contains: params.search.trim(), mode: 'insensitive' } },
        { firstName: { contains: params.search.trim(), mode: 'insensitive' } },
        { lastName: { contains: params.search.trim(), mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { profile: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: UserRole.USER },
      include: { profile: true, vehicles: true, bookings: { take: 20, orderBy: { createdAt: 'desc' }, include: { vehicle: true, fault: true, mechanic: { select: { companyName: true } } } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async setUserEmailVerified(id: string, emailVerified: boolean, adminId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: UserRole.USER },
    });
    if (!user) throw new NotFoundException('User not found');
    const updated = await this.prisma.user.update({
      where: { id },
      data: { emailVerified },
      include: { profile: true },
    });
    await this.logAudit(adminId, 'USER_EMAIL_VERIFIED_SET', 'user', id, { emailVerified });
    return updated;
  }

  async listMechanics(params: { page?: number; limit?: number; search?: string; isVerified?: boolean }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.isVerified !== undefined) where.isVerified = params.isVerified;
    if (params.search?.trim()) {
      where.OR = [
        { email: { contains: params.search.trim(), mode: 'insensitive' } },
        { companyName: { contains: params.search.trim(), mode: 'insensitive' } },
        { ownerFullName: { contains: params.search.trim(), mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.mechanic.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { profile: true },
      }),
      this.prisma.mechanic.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getMechanic(id: string) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id },
      include: { profile: true, bookings: { take: 20, orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true, firstName: true, lastName: true } }, vehicle: true, fault: true } } },
    });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    const [balance, owing] = await Promise.all([
      this.walletService.getMechanicBalance(id),
      this.walletService.getMechanicOwing(id),
    ]);
    return { ...mechanic, balance, owing };
  }

  async setMechanicVerified(id: string, isVerified: boolean, adminId: string) {
    const mechanic = await this.prisma.mechanic.findUnique({ where: { id } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    const updated = await this.prisma.mechanic.update({
      where: { id },
      data: { isVerified },
      include: { profile: true },
    });
    await this.logAudit(adminId, 'MECHANIC_VERIFY_SET', 'mechanic', id, { isVerified });
    return updated;
  }

  async setMechanicOperationalStatus(
    id: string,
    data: { isVerified?: boolean; emailVerified?: boolean; availability?: boolean },
    adminId: string,
  ) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!mechanic) throw new NotFoundException('Mechanic not found');

    const nextIsVerified =
      data.isVerified ?? (data.availability === false ? false : mechanic.isVerified);
    const updated = await this.prisma.mechanic.update({
      where: { id },
      data: {
        ...(data.isVerified !== undefined ? { isVerified: data.isVerified } : {}),
        ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
        ...(data.availability === false ? { isVerified: false } : {}),
      },
      include: { profile: true },
    });

    if (data.availability !== undefined) {
      await this.prisma.mechanicProfile.upsert({
        where: { mechanicId: id },
        update: { availability: data.availability },
        create: { mechanicId: id, availability: data.availability },
      });
    }

    await this.logAudit(adminId, 'MECHANIC_OPERATIONAL_UPDATE', 'mechanic', id, {
      isVerified: data.isVerified,
      emailVerified: data.emailVerified,
      availability: data.availability,
      nextIsVerified,
    });

    return {
      ...updated,
      isVerified: nextIsVerified,
      profile: {
        ...updated.profile,
        ...(data.availability !== undefined ? { availability: data.availability } : {}),
      },
    };
  }

  async listBookings(params: {
    page?: number;
    limit?: number;
    status?: BookingStatus;
    userId?: string;
    mechanicId?: string;
    dateFrom?: string;
    dateTo?: string;
    hasDispute?: boolean;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.userId) where.userId = params.userId;
    if (params.mechanicId) where.mechanicId = params.mechanicId;
    if (params.dateFrom) where.createdAt = { ...(where.createdAt as object), gte: new Date(params.dateFrom) };
    if (params.dateTo) where.createdAt = { ...(where.createdAt as object), lte: new Date(params.dateTo) };
    if (params.hasDispute === true) where.disputeReason = { not: null };
    if (params.hasDispute === false) where.OR = [{ disputeReason: null }, { disputeResolvedAt: { not: null } }];
    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          mechanic: { select: { id: true, companyName: true, ownerFullName: true, email: true } },
          vehicle: true,
          fault: true,
          acceptedQuote: { select: { quoteType: true } },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);
    const itemsWithPaymentHint = items.map((b) => {
      const isInspection = b.acceptedQuote?.quoteType === QuoteType.INSPECTION;
      let paymentHint: string | null = null;
      if (isInspection) {
        if (b.paidAt) paymentHint = 'Fully paid';
        else if (b.inspectionPaidAt) paymentHint = 'Inspection paid · balance pending';
        else if (b.status !== 'REQUESTED') paymentHint = 'Inspection unpaid';
        else paymentHint = 'Inspection job';
      }
      return { ...b, paymentHint, isInspectionFlow: isInspection };
    });
    return { items: itemsWithPaymentHint, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBooking(id: string) {
    const booking = await this.bookingsService.getAdminBookingDetail(id);
    const paymentSummary = booking.paymentSummary;
    return {
      ...booking,
      paymentPhaseLabel: paymentSummary
        ? paymentPhaseAdminLabel(paymentSummary.phase)
        : null,
    };
  }

  async setBookingDispute(id: string, body: { disputeReason?: string; resolve?: boolean }, adminId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (body.resolve) {
      const row = await this.prisma.booking.update({
        where: { id },
        data: { disputeResolvedAt: new Date(), resolvedById: adminId },
        include: { user: true, mechanic: true, vehicle: true, fault: true },
      });
      await this.logAudit(adminId, 'BOOKING_DISPUTE_RESOLVE', 'booking', id, {});
      return row;
    }
    if (body.disputeReason !== undefined) {
      const row = await this.prisma.booking.update({
        where: { id },
        data: { disputeReason: body.disputeReason || null, disputeResolvedAt: null, resolvedById: null },
        include: { user: true, mechanic: true, vehicle: true, fault: true },
      });
      await this.logAudit(adminId, 'BOOKING_DISPUTE_SET', 'booking', id, { disputeReason: body.disputeReason });
      return row;
    }
    throw new BadRequestException('Provide disputeReason or resolve: true');
  }

  async setBookingStatus(id: string, status: BookingStatus, adminId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');

    const now = new Date();
    const row = await this.prisma.booking.update({
      where: { id },
      data: {
        status,
        acceptedAt: status === BookingStatus.ACCEPTED ? booking.acceptedAt ?? now : booking.acceptedAt,
        startedAt: status === BookingStatus.IN_PROGRESS ? booking.startedAt ?? now : booking.startedAt,
        completedAt: status === BookingStatus.DONE ? booking.completedAt ?? now : booking.completedAt,
        deliveredAt: status === BookingStatus.DELIVERED ? booking.deliveredAt ?? now : booking.deliveredAt,
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        mechanic: { select: { id: true, companyName: true, ownerFullName: true, email: true } },
        vehicle: true,
        fault: true,
      },
    });
    await this.logAudit(adminId, 'BOOKING_STATUS_SET', 'booking', id, {
      priorStatus: booking.status,
      nextStatus: status,
    });
    return this.getBooking(id);
  }

  async listTransactions(params: {
    page?: number;
    limit?: number;
    type?: TransactionType;
    status?: string;
    userId?: string;
    mechanicId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.userId) where.userId = params.userId;
    if (params.mechanicId) where.mechanicId = params.mechanicId;
    if (params.dateFrom) where.createdAt = { ...(where.createdAt as object), gte: new Date(params.dateFrom) };
    if (params.dateTo) where.createdAt = { ...(where.createdAt as object), lte: new Date(params.dateTo) };
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, email: true } },
          mechanic: { select: { id: true, companyName: true } },
          booking: { select: { id: true, status: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return {
      items: items.map((t) => ({ ...t, amountNaira: t.amountMinor / 100 })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTransaction(id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        mechanic: { select: { id: true, companyName: true, ownerFullName: true, email: true } },
        booking: { select: { id: true, status: true, disputeReason: true, disputeResolvedAt: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return { ...tx, amountNaira: tx.amountMinor / 100 };
  }

  async reconcileTransaction(id: string, adminId: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.status === TransactionStatus.SUCCESS) {
      await this.logAudit(adminId, 'TRANSACTION_RECONCILE', 'transaction', id, {
        result: 'noop',
        note: 'Already successful',
      });
      return { transaction: { ...tx, amountNaira: tx.amountMinor / 100 }, reconciled: false, message: 'Already successful' };
    }

    try {
      if (tx.type === TransactionType.USER_PAYMENT) {
        if (!tx.userId || !tx.paystackReference) {
          throw new BadRequestException('USER_PAYMENT is missing user or paystack reference');
        }
        await this.walletService.verifyPayment(tx.userId, tx.paystackReference);
      } else if (tx.type === TransactionType.MECHANIC_FEE) {
        if (!tx.mechanicId || !tx.paystackReference) {
          throw new BadRequestException('MECHANIC_FEE is missing mechanic or paystack reference');
        }
        await this.walletService.verifyMechanicFeePayment(tx.mechanicId, tx.paystackReference);
      } else if (tx.type === TransactionType.PLATFORM_PAYOUT) {
        if (!tx.mechanicId) throw new BadRequestException('PLATFORM_PAYOUT is missing mechanic');
        await this.walletService.getMechanicWalletSummary(tx.mechanicId);
      } else {
        throw new BadRequestException(`Reconcile is not supported for transaction type ${tx.type}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'reconcile failed';
      await this.logAudit(adminId, 'TRANSACTION_RECONCILE', 'transaction', id, {
        error: message,
        priorStatus: tx.status,
      });
      throw err;
    }

    const refreshed = await this.prisma.transaction.findUnique({ where: { id } });
    if (!refreshed) throw new NotFoundException('Transaction not found after reconcile');
    const reconciled = refreshed.status !== tx.status;
    await this.logAudit(adminId, 'TRANSACTION_RECONCILE', 'transaction', id, {
      priorStatus: tx.status,
      nextStatus: refreshed.status,
      reconciled,
    });
    return {
      transaction: { ...refreshed, amountNaira: refreshed.amountMinor / 100 },
      reconciled,
      message: reconciled ? 'Transaction status updated' : 'No status change',
    };
  }

  async listReports(params: {
    page?: number;
    limit?: number;
    resolved?: boolean;
    bookingId?: string;
    reporterRole?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.bookingId) where.bookingId = params.bookingId;
    if (params.reporterRole) where.reporterRole = params.reporterRole;
    if (params.dateFrom) where.createdAt = { ...(where.createdAt as object), gte: new Date(params.dateFrom) };
    if (params.dateTo) where.createdAt = { ...(where.createdAt as object), lte: new Date(params.dateTo) };
    if (params.resolved === true) where.booking = { disputeResolvedAt: { not: null } };
    if (params.resolved === false) where.booking = { disputeResolvedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.bookingReport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              disputeReason: true,
              disputeResolvedAt: true,
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
              mechanic: { select: { id: true, companyName: true, ownerFullName: true, email: true } },
            },
          },
        },
      }),
      this.prisma.bookingReport.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getReport(id: string) {
    const report = await this.prisma.bookingReport.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            user: { include: { profile: true } },
            mechanic: { include: { profile: true } },
            vehicle: true,
            fault: true,
            transactions: true,
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async resolveReport(id: string, adminId: string) {
    const report = await this.prisma.bookingReport.findUnique({
      where: { id },
      include: { booking: true },
    });
    if (!report) throw new NotFoundException('Report not found');

    await this.prisma.booking.update({
      where: { id: report.bookingId },
      data: {
        disputeReason: report.booking.disputeReason ?? report.reason,
        disputeResolvedAt: new Date(),
        resolvedById: adminId,
      },
    });
    await this.logAudit(adminId, 'REPORT_RESOLVE', 'booking_report', id, {
      bookingId: report.bookingId,
    });
    return this.getReport(id);
  }

  async getPayoutsMechanics() {
    const mechanics = await this.prisma.mechanic.findMany({
      where: {
        bookings: {
          some: { paymentMethod: 'PLATFORM', paidAt: { not: null } },
        },
      },
      include: {
        profile: true,
        bankAccounts: { where: { isDefault: true }, take: 1 },
      },
      orderBy: { companyName: 'asc' },
    });
    const withBalance = await Promise.all(
      mechanics.map(async (m) => {
        const balance = await this.walletService.getMechanicBalance(m.id);
        const owing = await this.walletService.getMechanicOwing(m.id);
        const defaultBank = m.bankAccounts?.[0] ?? null;
        const { bankAccounts, ...rest } = m;
        return { ...rest, defaultBankAccount: defaultBank, balance, owing };
      }),
    );
    return withBalance.filter(
      (m) =>
        m.balance.balanceMinor > 0 ||
        m.owing.totalFeeOwedMinor > m.owing.totalFeePaidMinor ||
        (m.owing.pendingFeeCheckoutsMinor ?? 0) > 0,
    );
  }

  async recordPayout(mechanicId: string, amountMinor: number, reference: string | undefined, adminId: string) {
    const payoutTx = await this.walletService.recordPayout(mechanicId, amountMinor, reference, adminId);
    await this.logAudit(adminId, 'RECORD_PAYOUT', 'mechanic', mechanicId, {
      transactionId: payoutTx.id,
      amountMinor,
      reference: payoutTx.reference,
    });
    return payoutTx;
  }

  /** Ledger-only refund row against a successful USER_PAYMENT (does not call Paystack). */
  async recordRefundFromUserPayment(
    adminId: string,
    paymentTxId: string,
    amountMinor?: number,
    note?: string,
  ) {
    const payment = await this.prisma.transaction.findUnique({ where: { id: paymentTxId } });
    if (!payment) throw new NotFoundException('Payment transaction not found');
    if (payment.type !== TransactionType.USER_PAYMENT) {
      throw new BadRequestException('Only USER_PAYMENT transactions can be refunded through this action');
    }
    if (payment.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException('Payment must be in SUCCESS status to record a refund');
    }
    if (!payment.userId || !payment.bookingId) {
      throw new BadRequestException('Payment is missing user or booking context');
    }

    const refundAmount = amountMinor ?? payment.amountMinor;
    if (refundAmount <= 0) throw new BadRequestException('Refund amount must be positive');
    if (refundAmount > payment.amountMinor) {
      throw new BadRequestException('Refund amount cannot exceed original payment');
    }

    const priorRefunds = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.REFUND,
        status: TransactionStatus.SUCCESS,
        userId: payment.userId,
      },
    });
    const linkedSum = priorRefunds
      .filter((r) => (r.metadata as { linkedPaymentTxId?: string } | null)?.linkedPaymentTxId === paymentTxId)
      .reduce((s, r) => s + r.amountMinor, 0);
    if (linkedSum + refundAmount > payment.amountMinor) {
      throw new BadRequestException('Total refunds for this payment would exceed the original amount');
    }

    const ref = `admin_refund_${randomBytes(8).toString('hex')}`;
    const refundTx = await this.prisma.transaction.create({
      data: {
        type: TransactionType.REFUND,
        amountMinor: refundAmount,
        currency: payment.currency,
        status: TransactionStatus.SUCCESS,
        reference: ref,
        userId: payment.userId,
        bookingId: payment.bookingId,
        description: note?.trim() || `Admin refund for payment ${paymentTxId}`,
        metadata: {
          adminId,
          linkedPaymentTxId: paymentTxId,
          note: note ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    await this.logAudit(adminId, 'RECORD_REFUND', 'transaction', refundTx.id, {
      linkedPaymentTxId: paymentTxId,
      refundAmountMinor: refundAmount,
    });
    return { ...refundTx, amountNaira: refundTx.amountMinor / 100 };
  }

  async recordMechanicLedgerAdjustment(
    adminId: string,
    mechanicId: string,
    direction: 'credit' | 'debit',
    amountMinor: number,
    note?: string,
  ) {
    const mechanic = await this.prisma.mechanic.findUnique({ where: { id: mechanicId } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Amount must be a positive integer (minor units)');
    }

    if (direction === 'debit') {
      const balance = await this.walletService.getMechanicBalance(mechanicId);
      if (amountMinor > balance.balanceMinor) {
        throw new BadRequestException(`Debit exceeds available balance (₦${(balance.balanceMinor / 100).toLocaleString()})`);
      }
    }

    const type =
      direction === 'credit' ? TransactionType.ADMIN_MECHANIC_CREDIT : TransactionType.ADMIN_MECHANIC_DEBIT;
    const ref = `admin_ledger_${randomBytes(10).toString('hex')}`;
    const ledgerTx = await this.prisma.transaction.create({
      data: {
        type,
        amountMinor,
        currency: 'NGN',
        status: TransactionStatus.SUCCESS,
        reference: ref,
        mechanicId,
        description: note?.trim() || `Admin ${direction} (${type})`,
        metadata: {
          adminId,
          direction,
          note: note ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    await this.logAudit(adminId, direction === 'credit' ? 'MECHANIC_LEDGER_CREDIT' : 'MECHANIC_LEDGER_DEBIT', 'mechanic', mechanicId, {
      transactionId: ledgerTx.id,
      amountMinor,
      direction,
    });
    return { ...ledgerTx, amountNaira: ledgerTx.amountMinor / 100 };
  }

  async listAuditLogs(params: {
    page?: number;
    limit?: number;
    entityType?: string;
    entityId?: string;
    adminId?: string;
    action?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.adminId) where.adminId = params.adminId;
    if (params.action?.trim()) {
      where.action = { contains: params.action.trim(), mode: 'insensitive' };
    }
    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async listAdminUsers(params: { page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const whereRole: Prisma.UserWhereInput = { role: UserRole.ADMIN };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereRole,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          emailVerified: true,
          adminPermissions: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where: whereRole }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createAdminUser(
    actorAdminId: string,
    dto: { email: string; password: string; superadmin?: boolean; permissions?: string[] },
  ) {
    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const data: Prisma.UserCreateInput = {
      email,
      password: hashedPassword,
      role: UserRole.ADMIN,
      emailVerified: true,
    };

    if (!dto.superadmin) {
      const perms = dto.permissions?.length ? dto.permissions : [ADMIN_PERMISSIONS.READ];
      data.adminPermissions = perms as Prisma.InputJsonValue;
    }

    const user = await this.prisma.user.create({
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailVerified: true,
        adminPermissions: true,
        createdAt: true,
      },
    });

    await this.logAudit(actorAdminId, 'ADMIN_USER_CREATE', 'user', user.id, {
      email: user.email,
      superadmin: !!dto.superadmin,
      permissionsSet: dto.superadmin ? null : (dto.permissions?.length ? dto.permissions : [ADMIN_PERMISSIONS.READ]),
    });

    return user;
  }
}
