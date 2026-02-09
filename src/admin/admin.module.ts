import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../common/prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PrismaModule, WalletModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
