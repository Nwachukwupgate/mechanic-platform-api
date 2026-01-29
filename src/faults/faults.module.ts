import { Module } from '@nestjs/common';
import { FaultsService } from './faults.service';
import { FaultsController } from './faults.controller';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FaultsController],
  providers: [FaultsService],
})
export class FaultsModule {}
