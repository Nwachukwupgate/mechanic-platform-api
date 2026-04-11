import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingStatus } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('quote.created')
  async onQuoteCreated(payload: { userId: string; bookingId: string; quote: any }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, firstName: true, expoPushToken: true },
    });
    if (!user) return;
    const mech = payload.quote?.mechanic?.companyName || 'A mechanic';
    if (user?.email) {
      await this.notifications.sendEmail(
        user.email,
        'New quote on your job',
        `${mech} sent a quote for booking ${payload.bookingId.slice(0, 8)}… Open the app to review.`,
      );
    }
    if (user?.expoPushToken) {
      await this.notifications.sendExpoPush(user.expoPushToken, {
        title: 'New quote',
        body: `${mech} quoted on your job.`,
        data: { bookingId: payload.bookingId, type: 'quote_created' },
      });
    }
  }

  @OnEvent('quote.accepted')
  async onQuoteAccepted(payload: { userId: string; mechanicId: string; bookingId: string }) {
    const [user, mechanic] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { email: true, expoPushToken: true },
      }),
      this.prisma.mechanic.findUnique({
        where: { id: payload.mechanicId },
        select: { email: true, expoPushToken: true, companyName: true },
      }),
    ]);
    if (mechanic?.email) {
      await this.notifications.sendEmail(
        mechanic.email,
        'Quote accepted',
        `Your quote was accepted for booking ${payload.bookingId.slice(0, 8)}…`,
      );
    }
    if (mechanic?.expoPushToken) {
      await this.notifications.sendExpoPush(mechanic.expoPushToken, {
        title: 'Quote accepted',
        body: 'The customer accepted your quote.',
        data: { bookingId: payload.bookingId, type: 'quote_accepted' },
      });
    }
    if (user?.email) {
      await this.notifications.sendEmail(
        user.email,
        'Booking confirmed',
        `You accepted a quote. Booking ${payload.bookingId.slice(0, 8)}… Chat is now open.`,
      );
    }
  }

  @OnEvent('booking.statusChanged')
  async onBookingStatus(payload: {
    bookingId: string;
    status: BookingStatus;
    userId: string;
    mechanicId: string | null;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, expoPushToken: true },
    });
    const mechanic = payload.mechanicId
      ? await this.prisma.mechanic.findUnique({
          where: { id: payload.mechanicId },
          select: { email: true, expoPushToken: true },
        })
      : null;
    const label = payload.status.replace('_', ' ');
    if (user?.email) {
      await this.notifications.sendEmail(
        user.email,
        `Booking update: ${label}`,
        `Booking ${payload.bookingId.slice(0, 8)}… is now ${label}.`,
      );
    }
    if (user?.expoPushToken) {
      await this.notifications.sendExpoPush(user.expoPushToken, {
        title: 'Booking update',
        body: `Status: ${label}`,
        data: { bookingId: payload.bookingId, type: 'status', status: payload.status },
      });
    }
    if (mechanic?.email) {
      await this.notifications.sendEmail(
        mechanic.email,
        `Booking update: ${label}`,
        `Booking ${payload.bookingId.slice(0, 8)}… is now ${label}.`,
      );
    }
    if (mechanic?.expoPushToken) {
      await this.notifications.sendExpoPush(mechanic.expoPushToken, {
        title: 'Booking update',
        body: `Status: ${label}`,
        data: { bookingId: payload.bookingId, type: 'status', status: payload.status },
      });
    }
  }
}
