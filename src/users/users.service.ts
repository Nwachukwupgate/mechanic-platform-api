import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { DeleteUserAccountDto } from './dto/delete-user-account.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /** User self profile with lightweight booking stats for profile / dashboard UI. */
  async findByIdWithStats(id: string) {
    const user = await this.findById(id);

    const [totalBookings, completedBookings] = await Promise.all([
      this.prisma.booking.count({ where: { userId: id } }),
      this.prisma.booking.count({
        where: {
          userId: id,
          status: { in: ['DONE', 'PAID', 'DELIVERED'] },
        },
      }),
    ]);

    return {
      ...user,
      stats: {
        totalBookings,
        completedBookings,
      },
    };
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
  }

  async updateProfile(userId: string, data: any) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        ...data,
      },
    });
  }

  /**
   * Permanently remove the user account and related data (bookings, vehicles, wallet rows, etc.).
   * Logs optional exit feedback for product insight.
   */
  async deleteAccount(userId: string, dto: DeleteUserAccountDto) {
    const reasons = dto.reasons ?? [];
    const other = dto.otherReason?.trim() ?? '';
    if (reasons.length === 0 && !other) {
      throw new BadRequestException('Select at least one reason or describe why you are leaving.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.accountDeletionLog.create({
        data: {
          role: 'USER',
          reasons: reasons.length ? reasons : ['(other only)'],
          otherText: other || null,
        },
      });

      const bookingIds = (
        await tx.booking.findMany({
          where: { userId },
          select: { id: true },
        })
      ).map((b) => b.id);

      if (bookingIds.length > 0) {
        await tx.transaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
      }

      await tx.transaction.deleteMany({ where: { userId } });
      await tx.booking.deleteMany({ where: { userId } });
      await tx.vehicle.deleteMany({ where: { userId } });
      await tx.userProfile.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    return { deleted: true };
  }

  async blockMechanic(userId: string, mechanicId: string) {
    return this.prisma.userBlocksMechanic.upsert({
      where: {
        userId_mechanicId: { userId, mechanicId },
      },
      create: { userId, mechanicId },
      update: {},
    });
  }

  async unblockMechanic(userId: string, mechanicId: string) {
    await this.prisma.userBlocksMechanic.deleteMany({
      where: { userId, mechanicId },
    });
    return { ok: true };
  }

  async listBlockedMechanics(userId: string) {
    return this.prisma.userBlocksMechanic.findMany({
      where: { userId },
      include: { mechanic: { include: { profile: true } } },
    });
  }

  async setExpoPushToken(userId: string, token: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { expoPushToken: token },
    });
  }
}
