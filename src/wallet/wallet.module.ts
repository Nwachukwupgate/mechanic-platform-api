import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { BanksController } from './banks.controller';
import { WalletService } from './wallet.service';
import { PaystackService } from './paystack.service';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WalletController, PaystackWebhookController, BanksController],
  providers: [WalletService, PaystackService],
  exports: [WalletService, PaystackService],
})
export class WalletModule {}
