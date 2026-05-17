import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { SettlementService } from './settlement.service';

@Module({
  imports: [PrismaModule],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
