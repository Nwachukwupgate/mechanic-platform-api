import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  /** Chat unlocks after the job leaves REQUESTED (quote accepted, etc.). */
  private async ensureChatAllowed(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { mechanicId: true, status: true },
    });
    if (!booking?.mechanicId || booking.status === BookingStatus.REQUESTED) {
      throw new ForbiddenException('Chat is only available after a quote has been accepted');
    }
  }

  async createMessage(
    bookingId: string,
    senderId: string,
    receiverId: string,
    senderType: string,
    receiverType: string,
    content: string,
  ) {
    await this.ensureChatAllowed(bookingId);
    return this.prisma.message.create({
      data: {
        bookingId,
        senderId,
        receiverId,
        senderType,
        receiverType,
        content,
      },
    });
  }

  async getMessages(bookingId: string) {
    await this.ensureChatAllowed(bookingId);
    return this.prisma.message.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markAsRead(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.receiverId !== userId) {
      throw new NotFoundException('Message not found');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { read: true, readAt: new Date() },
    });
  }
}
