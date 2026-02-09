import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MechanicsModule } from './mechanics/mechanics.module';
import { ProfilesModule } from './profiles/profiles.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { FaultsModule } from './faults/faults.module';
import { BookingsModule } from './bookings/bookings.module';
import { ChatModule } from './chat/chat.module';
import { RatingsModule } from './ratings/ratings.module';
import { LocationModule } from './location/location.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { WalletModule } from './wallet/wallet.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    MechanicsModule,
    ProfilesModule,
    VehiclesModule,
    FaultsModule,
    BookingsModule,
    ChatModule,
    RatingsModule,
    LocationModule,
    GeocodingModule,
    NotificationsModule,
    WalletModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
