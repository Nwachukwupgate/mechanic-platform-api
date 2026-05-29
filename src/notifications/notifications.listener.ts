import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingStatus, NotificationRecipientRole } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  private truncate(text: string, max = 140): string {
    const t = text.trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  }

  @OnEvent('message.created')
  async onMessageCreated(payload: {
    bookingId: string;
    messageId: string;
    receiverId: string;
    receiverType: string;
    senderId: string;
    senderType: string;
    content: string;
  }) {
    const preview = this.truncate(payload.content);
    let senderLabel = 'Someone';
    if (payload.senderType === 'MECHANIC') {
      const mechanic = await this.prisma.mechanic.findUnique({
        where: { id: payload.senderId },
        select: { companyName: true, ownerFullName: true },
      });
      senderLabel = mechanic?.companyName || mechanic?.ownerFullName || 'Mechanic';
    } else {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.senderId },
        select: { firstName: true, lastName: true },
      });
      senderLabel =
        [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Customer';
    }

    const pushData = {
      bookingId: payload.bookingId,
      type: 'message',
      messageId: payload.messageId,
    };

    if (payload.receiverType === 'USER') {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.receiverId },
        select: { expoPushToken: true },
      });
      if (user?.expoPushToken) {
        await this.notifications.sendExpoPush(user.expoPushToken, {
          title: `Message from ${senderLabel}`,
          body: preview,
          data: pushData,
          channelId: 'messages-v2',
        });
      }
      await this.notifications.createInApp({
        recipientRole: NotificationRecipientRole.USER,
        recipientId: payload.receiverId,
        type: 'MESSAGE',
        title: 'New message',
        body: `${senderLabel}: ${preview}`,
        data: pushData,
      });
      return;
    }

    if (payload.receiverType === 'MECHANIC') {
      const mechanic = await this.prisma.mechanic.findUnique({
        where: { id: payload.receiverId },
        select: { expoPushToken: true },
      });
      if (mechanic?.expoPushToken) {
        await this.notifications.sendExpoPush(mechanic.expoPushToken, {
          title: `Message from ${senderLabel}`,
          body: preview,
          data: pushData,
          channelId: 'messages-v2',
        });
      }
      await this.notifications.createInApp({
        recipientRole: NotificationRecipientRole.MECHANIC,
        recipientId: payload.receiverId,
        type: 'MESSAGE',
        title: 'New message',
        body: `${senderLabel}: ${preview}`,
        data: pushData,
      });
    }
  }

  @OnEvent('quote.rejected')
  async onQuoteRejected(payload: { mechanicId: string; bookingId: string; quoteId: string }) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: payload.quoteId },
      select: { quoteType: true },
    });
    const isInspection = quote?.quoteType === 'INSPECTION';
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id: payload.mechanicId },
      select: { expoPushToken: true },
    });
    if (mechanic?.expoPushToken) {
      await this.notifications.sendExpoPush(mechanic.expoPushToken, {
        title: isInspection ? 'Inspection quote declined' : 'Quote declined',
        body: isInspection
          ? 'The customer declined your inspection fee. Update the quote and submit again.'
          : 'The customer declined your quote for this job.',
        data: { bookingId: payload.bookingId, type: 'quote_rejected' },
        channelId: 'alerts-v2',
        priority: 'high',
      });
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.MECHANIC,
      recipientId: payload.mechanicId,
      type: 'QUOTE_REJECTED',
      title: isInspection ? 'Inspection quote declined' : 'Quote declined',
      body: isInspection
        ? 'The customer declined your inspection fee. You can update and resubmit your quote.'
        : 'The customer declined your quote.',
      data: { bookingId: payload.bookingId },
    });
  }

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
        channelId: 'alerts-v2',
        priority: 'high',
      });
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.USER,
      recipientId: payload.userId,
      type: 'QUOTE_CREATED',
      title: 'New quote',
      body: `${mech} quoted on your job.`,
      data: { bookingId: payload.bookingId },
    });
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
        channelId: 'alerts-v2',
        priority: 'high',
      });
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.MECHANIC,
      recipientId: payload.mechanicId,
      type: 'QUOTE_ACCEPTED',
      title: 'Quote accepted',
      body: 'The customer accepted your quote.',
      data: { bookingId: payload.bookingId },
    });
    if (user?.email) {
      await this.notifications.sendEmail(
        user.email,
        'Booking confirmed',
        `You accepted a quote. Booking ${payload.bookingId.slice(0, 8)}… Chat is now open.`,
      );
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.USER,
      recipientId: payload.userId,
      type: 'QUOTE_ACCEPTED',
      title: 'Booking confirmed',
      body: 'Your quote was accepted. Chat is now open.',
      data: { bookingId: payload.bookingId },
    });
  }

  @OnEvent('job.assigned')
  async onJobAssigned(payload: {
    bookingId: string;
    mechanicId: string;
    userId: string;
    faultName: string;
    vehicleLabel: string;
  }) {
    const body = `${payload.faultName} — ${payload.vehicleLabel}. Submit your quote in the app.`;
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id: payload.mechanicId },
      select: { expoPushToken: true },
    });
    if (mechanic?.expoPushToken) {
      await this.notifications.sendExpoPush(mechanic.expoPushToken, {
        title: 'New job request',
        body,
        data: { bookingId: payload.bookingId, type: 'job_assigned' },
        channelId: 'alerts-v2',
        priority: 'high',
      });
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.MECHANIC,
      recipientId: payload.mechanicId,
      type: 'JOB_ASSIGNED',
      title: 'New job request',
      body,
      data: { bookingId: payload.bookingId },
    });
  }

  @OnEvent('job.opened')
  async onJobOpened(payload: {
    bookingId: string;
    userId: string;
    mechanicIds: string[];
    faultName: string;
    vehicleLabel: string;
  }) {
    const body = `${payload.faultName} — ${payload.vehicleLabel}. Open job — submit a quote to bid.`;
    const mechanics = await this.prisma.mechanic.findMany({
      where: { id: { in: payload.mechanicIds } },
      select: { id: true, expoPushToken: true },
    });
    for (const mechanic of mechanics) {
      if (mechanic.expoPushToken) {
        await this.notifications.sendExpoPush(mechanic.expoPushToken, {
          title: 'New open job nearby',
          body,
          data: { bookingId: payload.bookingId, type: 'job_opened' },
          channelId: 'alerts-v2',
          priority: 'high',
        });
      }
      await this.notifications.createInApp({
        recipientRole: NotificationRecipientRole.MECHANIC,
        recipientId: mechanic.id,
        type: 'JOB_OPENED',
        title: 'New open job nearby',
        body,
        data: { bookingId: payload.bookingId },
      });
    }
  }

  @OnEvent('inspection.paid')
  async onInspectionPaid(payload: {
    bookingId: string;
    mechanicId: string;
    userId: string;
    amountNaira: number | null;
  }) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id: payload.mechanicId },
      select: { expoPushToken: true },
    });
    const amountLabel =
      payload.amountNaira != null
        ? `₦${Number(payload.amountNaira).toLocaleString()}`
        : 'the inspection fee';
    if (mechanic?.expoPushToken) {
      await this.notifications.sendExpoPush(mechanic.expoPushToken, {
        title: 'Inspection fee paid',
        body: `The customer paid ${amountLabel}. You can start the visit and submit the repair quote.`,
        data: { bookingId: payload.bookingId, type: 'inspection_paid' },
        channelId: 'alerts-v2',
        priority: 'high',
      });
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.MECHANIC,
      recipientId: payload.mechanicId,
      type: 'INSPECTION_PAID',
      title: 'Inspection fee paid',
      body: `Customer paid ${amountLabel} for the inspection visit.`,
      data: { bookingId: payload.bookingId },
    });
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
    const label = String(payload.status)
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const majorStatus = ['PAID', 'IN_PROGRESS', 'DONE', 'DELIVERED'].includes(payload.status);
    const pushChannel = majorStatus ? 'alerts-v2' : 'bookings-v2';
    const pushPriority = majorStatus ? ('high' as const) : ('default' as const);
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
        channelId: pushChannel,
        priority: pushPriority,
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
        channelId: pushChannel,
        priority: pushPriority,
      });
    }
    await this.notifications.createInApp({
      recipientRole: NotificationRecipientRole.USER,
      recipientId: payload.userId,
      type: 'BOOKING_STATUS',
      title: 'Booking update',
      body: `Status is now ${label}.`,
      data: { bookingId: payload.bookingId, status: payload.status },
    });
    if (payload.mechanicId) {
      await this.notifications.createInApp({
        recipientRole: NotificationRecipientRole.MECHANIC,
        recipientId: payload.mechanicId,
        type: 'BOOKING_STATUS',
        title: 'Booking update',
        body: `Status is now ${label}.`,
        data: { bookingId: payload.bookingId, status: payload.status },
      });
    }
  }
}
