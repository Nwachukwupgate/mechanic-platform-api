import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class RatingsService {
  constructor(private prisma: PrismaService) {}

  async createRating(data: {
    bookingId: string;
    userId: string;
    mechanicId: string;
    rating: number;
    comment?: string;
  }) {
    // Check if booking exists and is completed
    const booking = await this.prisma.booking.findUnique({
      where: { id: data.bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status !== 'DONE' && booking.status !== 'PAID' && booking.status !== 'DELIVERED') {
      throw new BadRequestException('Booking must be completed before rating');
    }

    // Check if rating already exists
    const existingRating = await this.prisma.rating.findUnique({
      where: { bookingId: data.bookingId },
    });

    if (existingRating) {
      throw new BadRequestException('Rating already exists for this booking');
    }

    return this.prisma.rating.create({
      data,
    });
  }

  async getRatingsByMechanic(mechanicId: string) {
    return this.prisma.rating.findMany({
      where: { mechanicId },
      include: {
        user: {
          include: { profile: true },
        },
        booking: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAverageRating(mechanicId: string) {
    const ratings = await this.prisma.rating.findMany({
      where: { mechanicId },
    });

    if (ratings.length === 0) {
      return { average: 0, count: 0 };
    }

    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    return {
      average: sum / ratings.length,
      count: ratings.length,
    };
  }
}
