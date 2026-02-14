import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { UserRole, BookingStatus, TransactionType, TransactionStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

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

  async setMechanicVerified(id: string, isVerified: boolean) {
    const mechanic = await this.prisma.mechanic.findUnique({ where: { id } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    return this.prisma.mechanic.update({
      where: { id },
      data: { isVerified },
      include: { profile: true },
    });
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
        },
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBooking(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        user: { include: { profile: true } },
        mechanic: { include: { profile: true } },
        vehicle: true,
        fault: true,
        quotes: { include: { mechanic: { select: { companyName: true } } } },
        transactions: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async setBookingDispute(id: string, body: { disputeReason?: string; resolve?: boolean }, adminId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (body.resolve) {
      return this.prisma.booking.update({
        where: { id },
        data: { disputeResolvedAt: new Date(), resolvedById: adminId },
        include: { user: true, mechanic: true, vehicle: true, fault: true },
      });
    }
    if (body.disputeReason !== undefined) {
      return this.prisma.booking.update({
        where: { id },
        data: { disputeReason: body.disputeReason || null, disputeResolvedAt: null, resolvedById: null },
        include: { user: true, mechanic: true, vehicle: true, fault: true },
      });
    }
    throw new BadRequestException('Provide disputeReason or resolve: true');
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
    return withBalance.filter((m) => m.balance.balanceMinor > 0 || m.owing.owingNaira > 0);
  }

  async recordPayout(mechanicId: string, amountMinor: number, reference: string | undefined, adminId: string) {
    return this.walletService.recordPayout(mechanicId, amountMinor, reference, adminId);
  }
}
