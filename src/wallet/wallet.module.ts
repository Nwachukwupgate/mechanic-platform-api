import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { PaystackService } from './paystack.service';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WalletController],
  providers: [WalletService, PaystackService],
  exports: [WalletService, PaystackService],
})
export class WalletModule {}
