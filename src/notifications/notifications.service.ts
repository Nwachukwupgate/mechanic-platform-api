import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationRecipientRole, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export type ExpoPushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<string>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(port, 10),
        secure: port === '465',
        auth: { user, pass },
      });
    }
  }

  async sendEmail(to: string, subject: string, text: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER');
    if (!this.transporter || !from) {
      this.logger.debug(`[email skipped] ${subject} → ${to}: ${text}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from, to, subject, text });
    } catch (e) {
      this.logger.warn(`sendEmail failed: ${e}`);
    }
  }

  /** Expo push API — https://docs.expo.dev/push-notifications/sending-notifications/ */
  async sendExpoPush(token: string, msg: ExpoPushMessage): Promise<void> {
    if (!token?.startsWith('ExponentPushToken') && !token?.startsWith('ExpoPushToken')) {
      this.logger.debug(`[push skipped] invalid token format`);
      return;
    }
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            to: token,
            title: msg.title,
            body: msg.body,
            data: msg.data ?? {},
            sound: 'default',
          },
        ]),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push HTTP ${res.status}`);
      }
    } catch (e) {
      this.logger.warn(`sendExpoPush failed: ${e}`);
    }
  }

  async createInApp(input: {
    recipientRole: NotificationRecipientRole;
    recipientId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.inAppNotification.create({
        data: {
          recipientRole: input.recipientRole,
          recipientId: input.recipientId,
          type: input.type,
          title: input.title,
          body: input.body,
          ...(input.data !== undefined
            ? { data: input.data as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (e) {
      this.logger.warn(`createInApp failed: ${e}`);
    }
  }

  async listForRecipient(
    role: NotificationRecipientRole,
    recipientId: string,
    limit: number,
    offset: number,
  ) {
    const where = { recipientRole: role, recipientId };
    const [items, total] = await Promise.all([
      this.prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.inAppNotification.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async unreadCount(role: NotificationRecipientRole, recipientId: string) {
    return this.prisma.inAppNotification.count({
      where: { recipientRole: role, recipientId, readAt: null },
    });
  }

  async markRead(role: NotificationRecipientRole, recipientId: string, id: string) {
    const row = await this.prisma.inAppNotification.findFirst({
      where: { id, recipientRole: role, recipientId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    await this.prisma.inAppNotification.update({
      where: { id },
      data: { readAt: row.readAt ?? new Date() },
    });
    return { ok: true };
  }

  async markAllRead(role: NotificationRecipientRole, recipientId: string) {
    const res = await this.prisma.inAppNotification.updateMany({
      where: { recipientRole: role, recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}
