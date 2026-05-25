import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  BookingStatus,
  UserRole,
  QuoteStatus,
  QuoteType,
  InvoiceStatus,
  InvoiceSource,
} from '@prisma/client';
import { LocationService } from '../location/location.service';
import { SettlementService } from '../settlement/settlement.service';
import { buildPricingSummary, settlementToPricingSummary } from '../settlement/pricing-summary';
import { minorToNaira } from '../settlement/settlement-amounts';
import {
  InvoicePricingInput,
  QuotePricingInput,
  resolveInvoicePricing,
  resolveQuotePricing,
} from './booking-pricing.util';
import {
  MAX_CLARIFICATIONS_PER_BOOKING,
  MAX_CLARIFICATIONS_PER_MECHANIC,
  meetsOpenJobListingRequirements,
  validateOpenJobPhotos,
} from './job-posting.util';
import {
  computeBookingPaymentSummary,
  findRepairInvoice,
  isInspectionFlow,
  validateRepairInvoiceTotal,
} from './booking-payment.util';
import { nairaToMinor } from '../settlement/settlement-amounts';

const OPEN_REQUEST_EXPIRY_DAYS = 7;
/** Max times the mechanic can change the quoted price after first submit (per booking). */
const MAX_QUOTE_PRICE_REVISIONS = 2;

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private locationService: LocationService,
    private eventEmitter: EventEmitter2,
    private settlementService: SettlementService,
  ) {}

  /** Expire open-board jobs past `openRequestExpiresAt`. */
  async expireStaleOpenBookingRequests(): Promise<void> {
    await this.prisma.booking.updateMany({
      where: {
        status: BookingStatus.REQUESTED,
        mechanicId: null,
        openRequestExpiresAt: { lte: new Date() },
      },
      data: { status: BookingStatus.EXPIRED },
    });
  }

  async create(userId: string, data: {
    vehicleId: string;
    faultId: string;
    mechanicId?: string;
    description?: string;
    locationLat?: number;
    locationLng?: number;
    locationAddress?: string;
    photoUrls?: string[];
  }) {
    const { mechanicId, photoUrls, ...rest } = data;
    const isOpenBoard = !mechanicId;
    const fault = await this.prisma.fault.findUnique({ where: { id: data.faultId } });
    if (!fault) throw new NotFoundException('Fault not found');

    const photoCount = Array.isArray(photoUrls) ? photoUrls.length : 0;
    if (isOpenBoard) {
      validateOpenJobPhotos(photoCount, fault.name);
    }

    const openUntil = isOpenBoard
      ? new Date(Date.now() + OPEN_REQUEST_EXPIRY_DAYS * 86400000)
      : null;
    return this.prisma.booking.create({
      data: {
        userId,
        ...rest,
        ...(mechanicId && { mechanicId }),
        status: BookingStatus.REQUESTED,
        openRequestExpiresAt: openUntil,
        ...(Array.isArray(photoUrls) && photoUrls.length
          ? { photoUrls: photoUrls.slice(0, 5) }
          : {}),
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
    faultCategory: string | undefined,
    radiusKm: number = 10,
    vehicleId?: string,
    opts?: {
      userId?: string;
      minRating?: number;
      availableOnly?: boolean;
    },
  ) {
    const expertiseCategory =
      faultCategory != null && faultCategory.trim() !== ''
        ? this.mapFaultCategoryToExpertise(faultCategory)
        : undefined;

    let blockedMechanicIds: string[] = [];
    if (opts?.userId) {
      const blocks = await this.prisma.userBlocksMechanic.findMany({
        where: { userId: opts.userId },
        select: { mechanicId: true },
      });
      blockedMechanicIds = blocks.map((b) => b.mechanicId);
    }

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
        mechanic: {
          emailVerified: true,
          isVerified: true,
          deletedAt: null,
          ...(blockedMechanicIds.length
            ? { id: { notIn: blockedMechanicIds } }
            : {}),
        },
        ...(opts?.availableOnly === false ? {} : { availability: true }),
        ...(expertiseCategory
          ? { expertise: { has: expertiseCategory } }
          : {}),
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        mechanic: {
          include: {
            receivedRatings: { select: { rating: true } },
            _count: {
              select: {
                bookings: {
                  where: {
                    status: { in: ['DONE', 'PAID', 'DELIVERED'] },
                  },
                },
              },
            },
          },
        },
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

    let withRating = nearbyMechanics.map((m) => {
      const ratings = m.mechanic?.receivedRatings ?? [];
      const avg =
        ratings.length > 0
          ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length
          : null;
      const distanceKm = this.locationService.calculateDistance(
        lat,
        lng,
        m.latitude!,
        m.longitude!,
      );
      const mech = m.mechanic as any;
      const { receivedRatings, _count, ...mechanicWithoutR } = mech;
      const jobsCompleted = typeof _count?.bookings === 'number' ? _count.bookings : 0;
      return {
        ...m,
        mechanic: mechanicWithoutR,
        distanceKm,
        averageRating: avg,
        jobsCompleted,
      };
    });

    if (opts?.minRating != null && opts.minRating > 0) {
      withRating = withRating.filter(
        (m) => m.averageRating != null && m.averageRating >= opts.minRating!,
      );
    }

    return withRating;
  }

  async findByUserId(userId: string) {
    await this.expireStaleOpenBookingRequests();
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
    await this.expireStaleOpenBookingRequests();
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
    await this.expireStaleOpenBookingRequests();
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
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        ratings: { take: 1, select: { id: true, rating: true } },
        invoices: { orderBy: { version: 'desc' } },
        settlements: { orderBy: { createdAt: 'asc' } },
        acceptedQuote: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const enriched = await this.attachPricingToBooking(booking);

    // Chat only after the job leaves REQUESTED (e.g. user accepted a quote or legacy accept)
    const chatReleased =
      booking.mechanicId != null && booking.status !== BookingStatus.REQUESTED;
    if (!chatReleased) {
      return { ...enriched, messages: [] };
    }
    return enriched;
  }

  /** Admin booking detail: full relations + payment phase, settlements, invoices. */
  async getAdminBookingDetail(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { include: { profile: true } },
        mechanic: { include: { profile: true } },
        vehicle: true,
        fault: true,
        quotes: {
          include: { mechanic: { select: { id: true, companyName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        invoices: { orderBy: { version: 'desc' } },
        settlements: { orderBy: { createdAt: 'asc' } },
        acceptedQuote: true,
        transactions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    const enriched = await this.attachPricingToBooking(booking);
    const mapInvoice = (inv: {
      partsMinor: number;
      labourMinor: number;
      otherFeesMinor: number;
      customerTotalMinor: number;
      [key: string]: unknown;
    }) => ({
      ...inv,
      partsNaira: minorToNaira(inv.partsMinor),
      labourNaira: minorToNaira(inv.labourMinor),
      otherFeesNaira: minorToNaira(inv.otherFeesMinor),
      customerTotalNaira: minorToNaira(inv.customerTotalMinor),
    });
    return {
      ...enriched,
      invoices: booking.invoices?.map(mapInvoice) ?? [],
    };
  }

  private async attachPricingToBooking(booking: any) {
    const repairInvoice =
      findRepairInvoice(booking.invoices, InvoiceStatus.ACCEPTED) ??
      findRepairInvoice(booking.invoices, InvoiceStatus.SUBMITTED) ??
      findRepairInvoice(booking.invoices, InvoiceStatus.DRAFT);

    const activeInvoice =
      repairInvoice ??
      booking.invoices?.find(
        (i: { status: string; source: string }) =>
          i.status === InvoiceStatus.ACCEPTED && i.source === InvoiceSource.FROM_QUOTE,
      ) ??
      booking.invoices?.[0];

    let breakdown: {
      partsMinor: number;
      labourMinor: number;
      otherFeesMinor: number;
      customerTotalMinor: number;
    } | null = null;

    if (activeInvoice) {
      breakdown = {
        partsMinor: activeInvoice.partsMinor,
        labourMinor: activeInvoice.labourMinor,
        otherFeesMinor: activeInvoice.otherFeesMinor,
        customerTotalMinor: activeInvoice.customerTotalMinor,
      };
    } else if (booking.acceptedQuote?.customerTotalMinor) {
      breakdown = {
        partsMinor: booking.acceptedQuote.partsMinor ?? 0,
        labourMinor: booking.acceptedQuote.labourMinor ?? 0,
        otherFeesMinor: booking.acceptedQuote.otherFeesMinor ?? 0,
        customerTotalMinor: booking.acceptedQuote.customerTotalMinor,
      };
    } else if (booking.estimatedCost != null && booking.estimatedCost > 0) {
      const totalMinor = Math.round(booking.estimatedCost * 100);
      breakdown = {
        partsMinor: 0,
        labourMinor: totalMinor,
        otherFeesMinor: 0,
        customerTotalMinor: totalMinor,
      };
    }

    const pricingSummary = booking.settlements?.length
      ? settlementToPricingSummary(
          booking.settlements[booking.settlements.length - 1],
        )
      : buildPricingSummary(breakdown);

    const paymentSummary = computeBookingPaymentSummary({
      acceptedQuote: booking.acceptedQuote,
      inspectionPaidAt: booking.inspectionPaidAt,
      inspectionPaidAmount: booking.inspectionPaidAmount,
      paidAt: booking.paidAt,
      estimatedCost: booking.estimatedCost,
      invoices: booking.invoices,
    });

    const mapQuote = (q: any) => ({
      ...q,
      partsNaira: q.partsMinor != null ? minorToNaira(q.partsMinor) : null,
      labourNaira: q.labourMinor != null ? minorToNaira(q.labourMinor) : null,
      otherFeesNaira: q.otherFeesMinor != null ? minorToNaira(q.otherFeesMinor) : null,
      customerTotalNaira:
        q.customerTotalMinor != null ? minorToNaira(q.customerTotalMinor) : q.proposedPrice,
    });

    return {
      ...booking,
      quotes: booking.quotes?.map(mapQuote) ?? booking.quotes,
      acceptedQuote: booking.acceptedQuote ? mapQuote(booking.acceptedQuote) : null,
      activeInvoice: activeInvoice
        ? {
            ...activeInvoice,
            partsNaira: minorToNaira(activeInvoice.partsMinor),
            labourNaira: minorToNaira(activeInvoice.labourMinor),
            otherFeesNaira: minorToNaira(activeInvoice.otherFeesMinor),
            customerTotalNaira: minorToNaira(activeInvoice.customerTotalMinor),
          }
        : null,
      pricingSummary,
      paymentSummary,
      settlements: booking.settlements?.map((s: any) => ({
        ...s,
        customerTotalNaira: minorToNaira(s.customerTotalMinor),
        partsNaira: minorToNaira(s.partsMinor),
        labourNaira: minorToNaira(s.labourMinor),
        otherFeesNaira: minorToNaira(s.otherFeesMinor),
        platformFeeNaira: minorToNaira(s.platformFeeMinor),
        mechanicEarningsNaira: minorToNaira(s.mechanicEarningsMinor),
      })) ?? [],
      settlement: booking.settlements?.length
        ? {
            ...booking.settlements[booking.settlements.length - 1],
            customerTotalNaira: minorToNaira(
              booking.settlements[booking.settlements.length - 1].customerTotalMinor,
            ),
            partsNaira: minorToNaira(booking.settlements[booking.settlements.length - 1].partsMinor),
            labourNaira: minorToNaira(booking.settlements[booking.settlements.length - 1].labourMinor),
            otherFeesNaira: minorToNaira(
              booking.settlements[booking.settlements.length - 1].otherFeesMinor,
            ),
            platformFeeNaira: minorToNaira(
              booking.settlements[booking.settlements.length - 1].platformFeeMinor,
            ),
            mechanicEarningsNaira: minorToNaira(
              booking.settlements[booking.settlements.length - 1].mechanicEarningsMinor,
            ),
          }
        : null,
    };
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

    if (
      status === BookingStatus.IN_PROGRESS &&
      role === UserRole.MECHANIC &&
      isInspectionFlow(booking) &&
      !booking.inspectionPaidAt
    ) {
      throw new BadRequestException(
        'Customer must pay the inspection fee before you can start work',
      );
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

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
    });
    this.eventEmitter.emit('booking.statusChanged', {
      bookingId,
      status,
      userId: booking.userId,
      mechanicId: booking.mechanicId,
    });
    return updated;
  }

  async updateCost(bookingId: string, cost: number, userId: string, role: UserRole) {
    if (role !== UserRole.MECHANIC) {
      throw new NotFoundException('Booking not found');
    }
    return this.upsertInvoice(bookingId, userId, {
      partsCost: 0,
      labourCost: cost,
      otherFees: 0,
    });
  }

  /** Mechanic: structured job costing (parts / labour / other). */
  async upsertInvoice(bookingId: string, mechanicId: string, input: InvoicePricingInput) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { acceptedQuote: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.mechanicId !== mechanicId) {
      throw new NotFoundException('Booking not found');
    }
    const closedStatuses: BookingStatus[] = [
      BookingStatus.PAID,
      BookingStatus.DELIVERED,
      BookingStatus.EXPIRED,
    ];
    if (closedStatuses.includes(booking.status)) {
      throw new BadRequestException('Cannot update costing on a closed booking');
    }
    const inspectionJob = isInspectionFlow(booking);
    if (inspectionJob && !booking.inspectionPaidAt) {
      throw new BadRequestException(
        'Inspection fee must be paid before submitting a repair quote',
      );
    }

    const pricing = resolveInvoicePricing(input);
    if (inspectionJob && booking.inspectionPaidAmount != null) {
      try {
        validateRepairInvoiceTotal(
          pricing.customerTotalMinor,
          nairaToMinor(booking.inspectionPaidAmount),
        );
      } catch {
        throw new BadRequestException(
          'Repair total must be at least the inspection fee already paid',
        );
      }
    }
    const existingDraft = await this.prisma.bookingInvoice.findFirst({
      where: { bookingId, mechanicId, status: InvoiceStatus.DRAFT },
      orderBy: { version: 'desc' },
    });

    let invoice;
    if (existingDraft) {
      invoice = await this.prisma.bookingInvoice.update({
        where: { id: existingDraft.id },
        data: {
          partsMinor: pricing.partsMinor,
          labourMinor: pricing.labourMinor,
          otherFeesMinor: pricing.otherFeesMinor,
          customerTotalMinor: pricing.customerTotalMinor,
          notes: input.notes ?? existingDraft.notes,
        },
      });
    } else {
      const maxVersion = await this.prisma.bookingInvoice.aggregate({
        where: { bookingId },
        _max: { version: true },
      });
      invoice = await this.prisma.bookingInvoice.create({
        data: {
          bookingId,
          mechanicId,
          version: (maxVersion._max.version ?? 0) + 1,
          status: InvoiceStatus.DRAFT,
          partsMinor: pricing.partsMinor,
          labourMinor: pricing.labourMinor,
          otherFeesMinor: pricing.otherFeesMinor,
          customerTotalMinor: pricing.customerTotalMinor,
          notes: input.notes ?? null,
          source: InvoiceSource.MECHANIC_MANUAL,
        },
      });
    }

    if (!inspectionJob) {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          estimatedCost: pricing.customerTotalNaira,
          actualCost: pricing.customerTotalNaira,
        },
      });
    }

    return this.findById(bookingId);
  }

  async submitInvoice(bookingId: string, mechanicId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { acceptedQuote: true },
    });
    if (!booking || booking.mechanicId !== mechanicId) {
      throw new NotFoundException('Booking not found');
    }
    const invoice = await this.prisma.bookingInvoice.findFirst({
      where: { bookingId, mechanicId, status: InvoiceStatus.DRAFT },
      orderBy: { version: 'desc' },
    });
    if (!invoice) throw new BadRequestException('No draft invoice to submit');
    if (isInspectionFlow(booking) && booking.inspectionPaidAmount != null) {
      try {
        validateRepairInvoiceTotal(
          invoice.customerTotalMinor,
          nairaToMinor(booking.inspectionPaidAmount),
        );
      } catch {
        throw new BadRequestException(
          'Repair total must be at least the inspection fee already paid',
        );
      }
    }
    await this.prisma.bookingInvoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.SUBMITTED },
    });
    return this.findById(bookingId);
  }

  async acceptInvoice(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { acceptedQuote: true },
    });
    if (!booking || booking.userId !== userId) throw new NotFoundException('Booking not found');

    const invoice = await this.prisma.bookingInvoice.findFirst({
      where: {
        bookingId,
        status: InvoiceStatus.SUBMITTED,
        source: InvoiceSource.MECHANIC_MANUAL,
      },
      orderBy: { version: 'desc' },
    });
    if (!invoice) throw new BadRequestException('No repair invoice awaiting acceptance');

    if (isInspectionFlow(booking) && booking.inspectionPaidAmount != null) {
      try {
        validateRepairInvoiceTotal(
          invoice.customerTotalMinor,
          nairaToMinor(booking.inspectionPaidAmount),
        );
      } catch {
        throw new BadRequestException(
          'Repair total must be at least the inspection fee already paid',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.bookingInvoice.updateMany({
        where: { bookingId, id: { not: invoice.id }, status: InvoiceStatus.ACCEPTED },
        data: { status: InvoiceStatus.SUPERSEDED },
      }),
      this.prisma.bookingInvoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.ACCEPTED, acceptedAt: new Date() },
      }),
      this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          estimatedCost: minorToNaira(invoice.customerTotalMinor),
          actualCost: minorToNaira(invoice.customerTotalMinor),
        },
      }),
    ]);

    return this.findById(bookingId);
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
  async createQuote(
    bookingId: string,
    mechanicId: string,
    input: QuotePricingInput & { message?: string; quoteType?: 'STANDARD' | 'INSPECTION' },
  ) {
    const quoteType =
      input.quoteType === 'INSPECTION' ? QuoteType.INSPECTION : QuoteType.STANDARD;
    const pricing = resolveQuotePricing({ ...input, quoteType });
    const { proposedPrice, partsMinor, labourMinor, otherFeesMinor, customerTotalMinor } = pricing;
    let message = input.message?.trim() || null;
    if (quoteType === 'INSPECTION' && !message) {
      message =
        'Inspection visit to diagnose the issue on site. Full repair quote after physical check.';
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { fault: true, vehicle: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Booking is no longer accepting quotes');
    }
    // Open request: any matching mechanic can quote. Targeted request: only the chosen mechanic.
    if (booking.mechanicId && booking.mechanicId !== mechanicId) {
      throw new BadRequestException('Only the mechanic this job was sent to can submit a quote');
    }

    const existingQ = await this.prisma.bookingQuote.findUnique({
      where: { bookingId_mechanicId: { bookingId, mechanicId } },
    });
    if (existingQ && existingQ.priceUpdateCount >= MAX_QUOTE_PRICE_REVISIONS) {
      throw new BadRequestException(
        `You can only revise your quoted price up to ${MAX_QUOTE_PRICE_REVISIONS} times. Start a new conversation or ask the customer to re-open the job.`,
      );
    }

    const quote = await this.prisma.bookingQuote.upsert({
      where: {
        bookingId_mechanicId: { bookingId, mechanicId },
      },
      create: {
        bookingId,
        mechanicId,
        proposedPrice,
        partsMinor,
        labourMinor,
        otherFeesMinor,
        customerTotalMinor,
        message: message ?? null,
        quoteType,
        status: QuoteStatus.PENDING,
        priceUpdateCount: 0,
      },
      update: {
        proposedPrice,
        partsMinor,
        labourMinor,
        otherFeesMinor,
        customerTotalMinor,
        message: message ?? undefined,
        quoteType,
        status: QuoteStatus.PENDING,
        priceUpdateCount: { increment: 1 },
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
  async updateQuote(quoteId: string, mechanicId: string, input: QuotePricingInput) {
    const pricing = resolveQuotePricing(input);
    const { proposedPrice, partsMinor, labourMinor, otherFeesMinor, customerTotalMinor } = pricing;
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
    if (quote.priceUpdateCount >= MAX_QUOTE_PRICE_REVISIONS) {
      throw new BadRequestException(
        `Maximum price revisions (${MAX_QUOTE_PRICE_REVISIONS}) reached for this quote.`,
      );
    }

    const updated = await this.prisma.bookingQuote.update({
      where: { id: quoteId },
      data: {
        proposedPrice,
        partsMinor,
        labourMinor,
        otherFeesMinor,
        customerTotalMinor,
        priceUpdateCount: { increment: 1 },
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

    const partsMinor = quote.partsMinor ?? 0;
    const labourMinor = quote.labourMinor ?? Math.round(quote.proposedPrice * 100);
    const otherFeesMinor = quote.otherFeesMinor ?? 0;
    const customerTotalMinor =
      quote.customerTotalMinor ?? Math.round(quote.proposedPrice * 100);
    const isInspection = quote.quoteType === QuoteType.INSPECTION;

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingQuote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.ACCEPTED },
      });
      await tx.bookingQuote.updateMany({
        where: {
          bookingId: quote.bookingId,
          id: { not: quoteId },
        },
        data: { status: QuoteStatus.REJECTED },
      });
      if (!isInspection) {
        await tx.bookingInvoice.updateMany({
          where: { bookingId: quote.bookingId, status: InvoiceStatus.ACCEPTED },
          data: { status: InvoiceStatus.SUPERSEDED },
        });
        const maxVersion = await tx.bookingInvoice.aggregate({
          where: { bookingId: quote.bookingId },
          _max: { version: true },
        });
        await tx.bookingInvoice.create({
          data: {
            bookingId: quote.bookingId,
            mechanicId: quote.mechanicId,
            version: (maxVersion._max.version ?? 0) + 1,
            status: InvoiceStatus.ACCEPTED,
            partsMinor,
            labourMinor,
            otherFeesMinor,
            customerTotalMinor,
            source: InvoiceSource.FROM_QUOTE,
            quoteId,
            acceptedAt: new Date(),
          },
        });
      }
      await tx.booking.update({
        where: { id: quote.bookingId },
        data: {
          mechanicId: quote.mechanicId,
          acceptedQuoteId: quoteId,
          estimatedCost: quote.proposedPrice,
          actualCost: quote.proposedPrice,
          status: BookingStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });
    });

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
    await this.expireStaleOpenBookingRequests();
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
        if (!meetsOpenJobListingRequirements(b)) return false;

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

  /** Mechanic asks a clarification question about the job (pre-quote). Helps set price; no commitment. */
  async addClarification(bookingId: string, mechanicId: string, question: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { clarifications: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Only open requests accept clarification questions');
    }
    if (booking.mechanicId && booking.mechanicId !== mechanicId) {
      throw new BadRequestException('Only the mechanic this job was sent to can ask questions');
    }
    const trimmed = question?.trim();
    if (!trimmed || trimmed.length > 500) {
      throw new BadRequestException('Question must be 1–500 characters');
    }
    const total = booking.clarifications.length;
    const fromThisMechanic = booking.clarifications.filter((c) => c.mechanicId === mechanicId).length;
    if (total >= MAX_CLARIFICATIONS_PER_BOOKING) {
      throw new BadRequestException(
        `This job already has the maximum of ${MAX_CLARIFICATIONS_PER_BOOKING} questions.`,
      );
    }
    if (fromThisMechanic >= MAX_CLARIFICATIONS_PER_MECHANIC) {
      throw new BadRequestException(
        `You can ask up to ${MAX_CLARIFICATIONS_PER_MECHANIC} questions per job.`,
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

  async reportBooking(
    bookingId: string,
    reporterId: string,
    reporterRole: 'USER' | 'MECHANIC',
    reason: string,
    details?: string,
  ) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (reporterRole === 'USER' && booking.userId !== reporterId) {
      throw new NotFoundException('Booking not found');
    }
    if (reporterRole === 'MECHANIC') {
      const onBooking = booking.mechanicId === reporterId;
      const quoted = onBooking
        ? true
        : !!(await this.prisma.bookingQuote.findFirst({
            where: { bookingId, mechanicId: reporterId },
          }));
      if (!quoted) throw new NotFoundException('Booking not found');
    }
    const r = reason?.trim();
    if (!r || r.length > 200) {
      throw new BadRequestException('Reason is required (max 200 characters)');
    }
    return this.prisma.bookingReport.create({
      data: {
        bookingId,
        reporterId,
        reporterRole,
        reason: r,
        details: details?.trim()?.slice(0, 2000) || null,
      },
    });
  }

  async raiseDispute(bookingId: string, actorId: string, role: UserRole, reason: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role === UserRole.USER && booking.userId !== actorId) {
      throw new NotFoundException('Booking not found');
    }
    if (role === UserRole.MECHANIC && booking.mechanicId !== actorId) {
      throw new NotFoundException('Booking not found');
    }
    const r = reason?.trim();
    if (!r || r.length > 1000) {
      throw new BadRequestException('Describe the issue (1–1000 characters)');
    }
    if (booking.disputeReason) {
      throw new BadRequestException('A dispute is already open for this booking');
    }
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { disputeReason: r },
      include: {
        vehicle: true,
        fault: true,
        mechanic: { include: { profile: true } },
        user: { include: { profile: true } },
      },
    });
  }

  async appendBookingPhotoUrls(bookingId: string, userId: string, urls: string[]) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.userId !== userId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Photos can only be added while the request is open');
    }
    const clean = urls.filter((u) => typeof u === 'string' && u.startsWith('http')).slice(0, 5);
    if (clean.length === 0) throw new BadRequestException('No valid image URLs');
    const merged = [...(booking.photoUrls ?? []), ...clean].slice(0, 5);
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { photoUrls: merged },
    });
  }

  async getBookingReceipt(bookingId: string, requesterId: string, role: UserRole) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        vehicle: true,
        fault: true,
        mechanic: { include: { profile: true } },
        user: { include: { profile: true } },
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role === UserRole.USER && booking.userId !== requesterId) {
      throw new NotFoundException('Booking not found');
    }
    if (role === UserRole.MECHANIC && booking.mechanicId !== requesterId) {
      throw new NotFoundException('Booking not found');
    }
    return {
      bookingId: booking.id,
      reference: booking.paystackReference,
      status: booking.status,
      paidAt: booking.paidAt,
      paymentMethod: booking.paymentMethod,
      paidAmount: booking.paidAmount,
      estimatedCost: booking.estimatedCost,
      vehicle: booking.vehicle,
      fault: booking.fault,
      mechanic: booking.mechanic
        ? {
            companyName: booking.mechanic.companyName,
            ownerFullName: booking.mechanic.ownerFullName,
          }
        : null,
      customer:
        booking.user?.firstName || booking.user?.lastName
          ? `${booking.user.firstName ?? ''} ${booking.user.lastName ?? ''}`.trim()
          : booking.user?.email,
      transactions: booking.transactions,
    };
  }

  async markBookingMessagesRead(bookingId: string, readerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { mechanicId: true, userId: true, status: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.userId !== readerId && booking.mechanicId !== readerId) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === BookingStatus.REQUESTED) {
      throw new BadRequestException('Chat is not active for this booking');
    }
    const now = new Date();
    await this.prisma.message.updateMany({
      where: {
        bookingId,
        receiverId: readerId,
        read: false,
      },
      data: { read: true, readAt: now },
    });
    return { ok: true };
  }
}
