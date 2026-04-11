import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Public feature flags and client hints (no secrets). */
  @Get('config/public')
  getPublicConfig() {
    return {
      flags: {
        paymentsEnabled: process.env.FEATURE_PAYMENTS !== '0',
        emailNotifications: !!process.env.SMTP_HOST,
        openRequestExpiryDays: 7,
      },
    };
  }
}
