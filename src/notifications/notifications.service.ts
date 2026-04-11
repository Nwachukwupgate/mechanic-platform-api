import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export type ExpoPushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
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
}
