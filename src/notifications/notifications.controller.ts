import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationRecipientRole } from '@prisma/client';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  private recipientFromUser(user: any): {
    role: NotificationRecipientRole;
    recipientId: string;
  } {
    if (user.role === 'ADMIN') {
      throw new ForbiddenException('In-app notifications are not available for admin accounts.');
    }
    if (user.role === 'MECHANIC') {
      return { role: NotificationRecipientRole.MECHANIC, recipientId: user.id };
    }
    return { role: NotificationRecipientRole.USER, recipientId: user.id };
  }

  @Get()
  async list(
    @CurrentUser() user: any,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const { role, recipientId } = this.recipientFromUser(user);
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '30', 10) || 30, 1), 100);
    const offset = Math.max(parseInt(offsetRaw ?? '0', 10) || 0, 0);
    return this.notifications.listForRecipient(role, recipientId, limit, offset);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: any) {
    const { role, recipientId } = this.recipientFromUser(user);
    const count = await this.notifications.unreadCount(role, recipientId);
    return { count };
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: any, @Param('id') id: string) {
    const { role, recipientId } = this.recipientFromUser(user);
    return this.notifications.markRead(role, recipientId, id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: any) {
    const { role, recipientId } = this.recipientFromUser(user);
    return this.notifications.markAllRead(role, recipientId);
  }
}
