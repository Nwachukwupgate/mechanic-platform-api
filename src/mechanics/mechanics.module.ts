import { Module } from '@nestjs/common';
import { MechanicsService } from './mechanics.service';
import { MechanicsController } from './mechanics.controller';
import { PrismaModule } from '../common/prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [MechanicsController],
  providers: [MechanicsService],
  exports: [MechanicsService],
})
export class MechanicsModule {}
