import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../common/prisma/prisma.service';
import { BookingStatus, UserRole, QuoteStatus } from '@prisma/client';
import { LocationService } from '../location/location.service';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private locationService: LocationService,
    private eventEmitter: EventEmitter2,
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

  /** Map fault category to mechanic expertise: ENGINE/BRAKES/TRANSMISSION → MECHANICAL */
  private mapFaultCategoryToExpertise(faultCategory: string): string {
    if (['ENGINE', 'BRAKES', 'TRANSMISSION'].includes(faultCategory)) {
      return 'MECHANICAL';
    }
    return faultCategory;
  }

  /** Vehicle type for matching: SEDAN shown as Saloon in UI, mechanics store SALOON */
  private normaliseVehicleTypeForMatch(type: string): string {
    return type === 'SEDAN' ? 'SALOON' : type;
  }

  async findNearbyMechanics(
    lat: number,
    lng: number,
    faultCategory: string,
    radiusKm: number = 10,
    vehicleId?: string,
  ) {
    const expertiseCategory = this.mapFaultCategoryToExpertise(faultCategory);

    let vehicleType: string | null = null;
    let vehicleBrand: string | null = null;
    if (vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: vehicleId },
      });
      if (vehicle) {
        vehicleType = this.normaliseVehicleTypeForMatch(vehicle.type);
        vehicleBrand = vehicle.brand;
      }
    }

    const mechanics = await this.prisma.mechanicProfile.findMany({
      where: {
        mechanic: { emailVerified: true, isVerified: true, deletedAt: null },
        availability: true,
        expertise: { has: expertiseCategory },
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        mechanic: true,
      },
    });

    // Filter by vehicle type: mechanic must support this type
    let byType = mechanics;
    if (vehicleType) {
      byType = mechanics.filter((m) =>
        Array.isArray(m.vehicleTypes) && m.vehicleTypes.length > 0
          ? m.vehicleTypes.map((t) => (t === 'SEDAN' ? 'SALOON' : t)).includes(vehicleType!)
          : true,
      );
    }

    // Filter by brand: mechanic with no brands = all brands; else must include vehicle brand
    let byBrand = byType;
    if (vehicleBrand) {
      byBrand = byType.filter((m) => {
        const brands = Array.isArray(m.brands) ? m.brands : [];
        return brands.length === 0 || brands.some((b) => b.toLowerCase() === vehicleBrand!.toLowerCase());
      });
    }

    const nearbyMechanics = byBrand.filter((m) => {
      if (!m.latitude || !m.longitude) return false;
      const distance = this.locationService.calculateDistance(
        lat,
        lng,
        m.latitude,
        m.longitude,
      );
      return distance <= radiusKm;
    });

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
        quotes: {
          include: { mechanic: { include: { profile: true } } },
          orderBy: { createdAt: 'asc' },
        },
        clarifications: {
          include: { mechanic: { include: { profile: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Chat is only visible after a quote has been accepted
    if (!booking.mechanicId) {
      return { ...booking, messages: [] };
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

  // --- Quote flow: mechanics submit/update price; user accepts or cancels one ---

  async getQuotesForBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        quotes: {
          include: { mechanic: { include: { profile: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking.quotes;
  }

  /** Submit or re-submit a quote. Mechanics can submit again after REJECTED (stay in the bargain). */
  async createQuote(bookingId: string, mechanicId: string, proposedPrice: number, message?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { fault: true, vehicle: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.REQUESTED || booking.mechanicId) {
      throw new BadRequestException('Booking is no longer accepting quotes');
    }

    const quote = await this.prisma.bookingQuote.upsert({
      where: {
        bookingId_mechanicId: { bookingId, mechanicId },
      },
      create: {
        bookingId,
        mechanicId,
        proposedPrice,
        message: message ?? null,
        status: QuoteStatus.PENDING,
      },
      update: {
        proposedPrice,
        message: message ?? undefined,
        status: QuoteStatus.PENDING,
      },
      include: {
        mechanic: { include: { profile: true } },
      },
    });
    this.eventEmitter.emit('quote.created', {
      userId: booking.userId,
      bookingId,
      quote,
    });
    return quote;
  }

  /** Update price/message. Allowed for PENDING; also for REJECTED so mechanic can re-enter the bargain with a new price. */
  async updateQuote(quoteId: string, mechanicId: string, proposedPrice: number) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      include: { booking: true },
    });
    if (!quote || quote.mechanicId !== mechanicId) throw new NotFoundException('Quote not found');
    const canUpdate = quote.status === QuoteStatus.PENDING || quote.status === QuoteStatus.REJECTED;
    if (!canUpdate) {
      throw new BadRequestException('Only pending or rejected quotes can be updated (rejected allows re-quoting)');
    }
    if (quote.booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Booking is no longer accepting quote updates');
    }

    const updated = await this.prisma.bookingQuote.update({
      where: { id: quoteId },
      data: {
        proposedPrice,
        ...(quote.status === QuoteStatus.REJECTED ? { status: QuoteStatus.PENDING } : {}),
      },
      include: {
        mechanic: { include: { profile: true } },
      },
    });
    this.eventEmitter.emit('quote.updated', {
      userId: quote.booking.userId,
      bookingId: quote.bookingId,
      quote: updated,
    });
    return updated;
  }

  async withdrawQuote(quoteId: string, mechanicId: string) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      include: { booking: true },
    });
    if (!quote || quote.mechanicId !== mechanicId) throw new NotFoundException('Quote not found');
    if (quote.status !== QuoteStatus.PENDING) {
      throw new BadRequestException('Only pending quotes can be withdrawn');
    }
    return this.prisma.bookingQuote.update({
      where: { id: quoteId },
      data: { status: QuoteStatus.WITHDRAWN },
      include: { mechanic: { include: { profile: true } } },
    });
  }

  async rejectQuote(quoteId: string, userId: string) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      include: { booking: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.booking.userId !== userId) throw new NotFoundException('Quote not found');
    if (quote.status !== QuoteStatus.PENDING) {
      throw new BadRequestException('Quote is not pending');
    }

    const updated = await this.prisma.bookingQuote.update({
      where: { id: quoteId },
      data: { status: QuoteStatus.REJECTED },
      include: {
        mechanic: { include: { profile: true } },
      },
    });
    this.eventEmitter.emit('quote.rejected', {
      mechanicId: quote.mechanicId,
      bookingId: quote.bookingId,
      quoteId,
    });
    return updated;
  }

  async acceptQuote(quoteId: string, userId: string) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      include: { booking: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.booking.userId !== userId) throw new NotFoundException('Quote not found');
    if (quote.status !== QuoteStatus.PENDING) {
      throw new BadRequestException('Quote is not pending');
    }
    if (quote.booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Booking already has an accepted mechanic');
    }

    await this.prisma.$transaction([
      this.prisma.bookingQuote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.ACCEPTED },
      }),
      this.prisma.bookingQuote.updateMany({
        where: {
          bookingId: quote.bookingId,
          id: { not: quoteId },
        },
        data: { status: QuoteStatus.REJECTED },
      }),
      this.prisma.booking.update({
        where: { id: quote.bookingId },
        data: {
          mechanicId: quote.mechanicId,
          estimatedCost: quote.proposedPrice,
          status: BookingStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      }),
    ]);

    const updatedBooking = await this.findById(quote.bookingId);
    this.eventEmitter.emit('quote.accepted', {
      userId: quote.booking.userId,
      mechanicId: quote.mechanicId,
      bookingId: quote.bookingId,
      quoteId,
      booking: updatedBooking,
    });
    return updatedBooking;
  }

  /** Open booking requests that match this mechanic (expertise + optional location). Mechanics see these to submit a price. */
  async findOpenRequestsForMechanic(mechanicId: string, radiusKm: number = 50) {
    const profile = await this.prisma.mechanicProfile.findUnique({
      where: { mechanicId },
      include: { mechanic: true },
    });
    if (!profile) {
      return [];
    }

    const openBookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.REQUESTED,
        mechanicId: null,
      },
      include: {
        vehicle: true,
        fault: true,
        user: { include: { profile: true } },
        quotes: {
          where: { mechanicId },
          take: 1,
        },
        clarifications: {
          include: { mechanic: { include: { profile: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMechanicLocation = profile.latitude != null && profile.longitude != null;

    const withDistance = openBookings
      .filter((b) => {
        const faultCategory = b.fault.category;
        const expertiseMapped = this.mapFaultCategoryToExpertise(faultCategory);
        const expertiseList = Array.isArray(profile.expertise) ? profile.expertise : [];
        const matchesFault =
          expertiseList.includes(expertiseMapped) || expertiseList.includes(faultCategory);
        if (!matchesFault) return false;

        const vehicleType = this.normaliseVehicleTypeForMatch(b.vehicle.type);
        if (
          Array.isArray(profile.vehicleTypes) &&
          profile.vehicleTypes.length > 0
        ) {
          const normalisedTypes = profile.vehicleTypes.map((t) =>
            t === 'SEDAN' ? 'SALOON' : t,
          );
          if (!normalisedTypes.includes(vehicleType)) return false;
        }

        if (b.locationLat != null && b.locationLng != null && hasMechanicLocation) {
          const dist = this.locationService.calculateDistance(
            profile.latitude!,
            profile.longitude!,
            b.locationLat,
            b.locationLng,
          );
          return dist <= radiusKm;
        }
        return true;
      })
      .map((b) => {
        let distance: number | null = null;
        if (
          b.locationLat != null &&
          b.locationLng != null &&
          hasMechanicLocation
        ) {
          distance = this.locationService.calculateDistance(
            profile.latitude!,
            profile.longitude!,
            b.locationLat,
            b.locationLng,
          );
        }
        return {
          ...b,
          distanceKm: distance,
          myQuote: b.quotes[0] ?? null,
        };
      });

    withDistance.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    return withDistance;
  }

  private static readonly MAX_CLARIFICATIONS_PER_BOOKING = 5;
  private static readonly MAX_CLARIFICATIONS_PER_MECHANIC = 2;

  /** Mechanic asks a clarification question about the job (pre-quote). Helps set price; no commitment. */
  async addClarification(bookingId: string, mechanicId: string, question: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { clarifications: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.REQUESTED || booking.mechanicId) {
      throw new BadRequestException('Only open requests accept clarification questions');
    }
    const trimmed = question?.trim();
    if (!trimmed || trimmed.length > 500) {
      throw new BadRequestException('Question must be 1–500 characters');
    }
    const total = booking.clarifications.length;
    const fromThisMechanic = booking.clarifications.filter((c) => c.mechanicId === mechanicId).length;
    if (total >= BookingsService.MAX_CLARIFICATIONS_PER_BOOKING) {
      throw new BadRequestException(
        `This job already has the maximum of ${BookingsService.MAX_CLARIFICATIONS_PER_BOOKING} questions.`,
      );
    }
    if (fromThisMechanic >= BookingsService.MAX_CLARIFICATIONS_PER_MECHANIC) {
      throw new BadRequestException(
        `You can ask up to ${BookingsService.MAX_CLARIFICATIONS_PER_MECHANIC} questions per job.`,
      );
    }
    return this.prisma.bookingClarification.create({
      data: { bookingId, mechanicId, question: trimmed },
      include: { mechanic: { include: { profile: true } } },
    });
  }

  /** User answers a mechanic's clarification question. Visible to all mechanics viewing the request. */
  async answerClarification(clarificationId: string, userId: string, answer: string) {
    const clarification = await this.prisma.bookingClarification.findUnique({
      where: { id: clarificationId },
      include: { booking: true },
    });
    if (!clarification) throw new NotFoundException('Question not found');
    if (clarification.booking.userId !== userId) {
      throw new NotFoundException('Question not found');
    }
    if (clarification.booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Booking is no longer accepting answers');
    }
    const trimmed = answer?.trim();
    if (!trimmed || trimmed.length > 1000) {
      throw new BadRequestException('Answer must be 1–1000 characters');
    }
    return this.prisma.bookingClarification.update({
      where: { id: clarificationId },
      data: { answer: trimmed },
      include: { mechanic: { include: { profile: true } } },
    });
  }

  /** User updates booking description (e.g. more diagnostic details) while request is still open. */
  async updateDescription(bookingId: string, userId: string, description: string | null) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.userId !== userId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Description can only be updated while the request is open');
    }
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { description: description ?? null },
      include: {
        vehicle: true,
        fault: true,
        user: { include: { profile: true } },
        clarifications: {
          include: { mechanic: { include: { profile: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }
}
