import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../common/prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';

@Module({
  imports: [PrismaModule, WalletModule, BookingsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminPermissionGuard],
})
export class AdminModule {}
