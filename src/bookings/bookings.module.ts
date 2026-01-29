import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PrismaModule } from '../common/prisma/prisma.module';
import { LocationModule } from '../location/location.module';

@Module({
  imports: [PrismaModule, LocationModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
