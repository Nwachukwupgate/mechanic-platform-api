import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BookingStatus, UserRole } from '@prisma/client';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Post()
  async create(@CurrentUser() user: any, @Body() data: {
    vehicleId: string;
    faultId: string;
    mechanicId?: string;
    description?: string;
    locationLat?: number;
    locationLng?: number;
    locationAddress?: string;
  }) {
    return this.bookingsService.create(user.id, data);
  }

  @Get('nearby-mechanics')
  async findNearbyMechanics(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('faultCategory') faultCategory: string,
    @Query('radius') radius?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.bookingsService.findNearbyMechanics(
      parseFloat(lat),
      parseFloat(lng),
      faultCategory,
      radius ? parseFloat(radius) : 10,
      vehicleId,
    );
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    if (user.role === UserRole.MECHANIC) {
      return this.bookingsService.findByMechanicId(user.id);
    }
    return this.bookingsService.findByUserId(user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put(':id/accept')
  async acceptBooking(@Param('id') id: string, @CurrentUser() mechanic: any) {
    return this.bookingsService.acceptBooking(id, mechanic.id);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() data: { status: BookingStatus },
  ) {
    return this.bookingsService.updateStatus(id, data.status, user.id, user.role);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put(':id/cost')
  async updateCost(
    @Param('id') id: string,
    @CurrentUser() mechanic: any,
    @Body() data: { cost: number },
  ) {
    return this.bookingsService.updateCost(id, data.cost, mechanic.id, UserRole.MECHANIC);
  }
}
