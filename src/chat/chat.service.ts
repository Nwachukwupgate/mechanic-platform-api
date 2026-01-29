import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async createMessage(
    bookingId: string,
    senderId: string,
    receiverId: string,
    senderType: string,
    receiverType: string,
    content: string,
  ) {
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
      data: { read: true },
    });
  }
}
