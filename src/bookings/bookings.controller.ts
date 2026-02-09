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

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Get('open-requests')
  async findOpenRequests(
    @CurrentUser() mechanic: any,
    @Query('radius') radius?: string,
  ) {
    return this.bookingsService.findOpenRequestsForMechanic(
      mechanic.id,
      radius ? parseFloat(radius) : 50,
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

  @Get(':id/quotes')
  async getQuotes(@Param('id') id: string) {
    return this.bookingsService.getQuotesForBooking(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post(':id/quotes')
  async createQuote(
    @Param('id') id: string,
    @CurrentUser() mechanic: any,
    @Body() body: { proposedPrice: number; message?: string },
  ) {
    return this.bookingsService.createQuote(
      id,
      mechanic.id,
      body.proposedPrice,
      body.message,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put(':id/quotes/:quoteId')
  async updateQuote(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @CurrentUser() mechanic: any,
    @Body() body: { proposedPrice: number },
  ) {
    return this.bookingsService.updateQuote(quoteId, mechanic.id, body.proposedPrice);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put(':id/quotes/:quoteId/withdraw')
  async withdrawQuote(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @CurrentUser() mechanic: any,
  ) {
    return this.bookingsService.withdrawQuote(quoteId, mechanic.id);
  }

  @Put(':id/quotes/:quoteId/reject')
  async rejectQuote(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.rejectQuote(quoteId, user.id);
  }

  @Put(':id/quotes/:quoteId/accept')
  async acceptQuote(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.acceptQuote(quoteId, user.id);
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

  @Put(':id/description')
  async updateDescription(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { description: string | null },
  ) {
    return this.bookingsService.updateDescription(id, user.id, body.description ?? null);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post(':id/clarifications')
  async addClarification(
    @Param('id') id: string,
    @CurrentUser() mechanic: any,
    @Body() body: { question: string },
  ) {
    return this.bookingsService.addClarification(id, mechanic.id, body.question);
  }

  @Put('clarifications/:clarificationId/answer')
  async answerClarification(
    @Param('clarificationId') clarificationId: string,
    @CurrentUser() user: any,
    @Body() body: { answer: string },
  ) {
    return this.bookingsService.answerClarification(clarificationId, user.id, body.answer);
  }
}
