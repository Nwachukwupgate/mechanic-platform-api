import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BookingStatus, UserRole } from '@prisma/client';
import { LocationService } from '../location/location.service';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private locationService: LocationService,
  ) {}

  async create(userId: string, data: {
    vehicleId: string;
    faultId: string;
    mechanicId?: string;
    description?: string;
    locationLat?: number;
    locationLng?: number;
    locationAddress?: string;
  }) {
    const { mechanicId, ...rest } = data;
    return this.prisma.booking.create({
      data: {
        userId,
        ...rest,
        ...(mechanicId && { mechanicId }),
        status: BookingStatus.REQUESTED,
      },
      include: {
        vehicle: true,
        fault: true,
        user: true,
      },
    });
  }

  async findNearbyMechanics(lat: number, lng: number, faultCategory: string, radiusKm: number = 10) {
    // Only show mechanics with verified email (and admin-verified when isVerified exists)
    const mechanics = await this.prisma.mechanicProfile.findMany({
      where: {
        mechanic: { emailVerified: true },
        availability: true,
        expertise: {
          has: faultCategory,
        },
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        mechanic: true,
      },
    });

    // Filter by distance
    const nearbyMechanics = mechanics.filter((m) => {
      if (!m.latitude || !m.longitude) return false;
      const distance = this.locationService.calculateDistance(
        lat,
        lng,
        m.latitude,
        m.longitude,
      );
      return distance <= radiusKm;
    });

    // Sort by distance
    nearbyMechanics.sort((a, b) => {
      const distA = this.locationService.calculateDistance(lat, lng, a.latitude!, a.longitude!);
      const distB = this.locationService.calculateDistance(lat, lng, b.latitude!, b.longitude!);
      return distA - distB;
    });

    return nearbyMechanics;
  }

  async findByUserId(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        vehicle: true,
        fault: true,
        mechanic: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByMechanicId(mechanicId: string) {
    return this.prisma.booking.findMany({
      where: { mechanicId },
      include: {
        vehicle: true,
        fault: true,
        user: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        vehicle: true,
        fault: true,
        user: {
          include: { profile: true },
        },
        mechanic: {
          include: { profile: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  async acceptBooking(bookingId: string, mechanicId: string) {
    const booking = await this.findById(bookingId);

    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Booking cannot be accepted');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        mechanicId,
        status: BookingStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });
  }

  async updateStatus(bookingId: string, status: BookingStatus, userId: string, role: UserRole) {
    const booking = await this.findById(bookingId);

    // Verify permissions
    if (role === UserRole.MECHANIC && booking.mechanicId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    if (role === UserRole.USER && booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }

    const updateData: any = { status };

    // Set timestamps based on status
    switch (status) {
      case BookingStatus.IN_PROGRESS:
        updateData.startedAt = new Date();
        break;
      case BookingStatus.DONE:
        updateData.completedAt = new Date();
        break;
      case BookingStatus.PAID:
        updateData.paidAt = new Date();
        break;
      case BookingStatus.DELIVERED:
        updateData.deliveredAt = new Date();
        break;
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
    });
  }

  async updateCost(bookingId: string, cost: number, userId: string, role: UserRole) {
    const booking = await this.findById(bookingId);

    if (role !== UserRole.MECHANIC || booking.mechanicId !== userId) {
      throw new NotFoundException('Booking not found');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        estimatedCost: cost,
      },
    });
  }
}
