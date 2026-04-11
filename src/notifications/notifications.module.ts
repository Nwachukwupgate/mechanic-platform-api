import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [NotificationsService, NotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
