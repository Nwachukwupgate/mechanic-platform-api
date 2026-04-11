import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BookingStatus, UserRole } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(
    private bookingsService: BookingsService,
    private cloudinaryService: CloudinaryService,
  ) {}

  @Post()
  async create(@CurrentUser() user: any, @Body() data: {
    vehicleId: string;
    faultId: string;
    mechanicId?: string;
    description?: string;
    locationLat?: number;
    locationLng?: number;
    locationAddress?: string;
    photoUrls?: string[];
  }) {
    return this.bookingsService.create(user.id, data);
  }

  @Get('nearby-mechanics')
  async findNearbyMechanics(
    @CurrentUser() user: any,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('faultCategory') faultCategory: string,
    @Query('radius') radius?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('minRating') minRating?: string,
    @Query('availableOnly') availableOnly?: string,
  ) {
    return this.bookingsService.findNearbyMechanics(
      parseFloat(lat),
      parseFloat(lng),
      faultCategory,
      radius ? parseFloat(radius) : 10,
      vehicleId,
      {
        userId: user.id,
        minRating: minRating != null && minRating !== '' ? parseFloat(minRating) : undefined,
        availableOnly:
          availableOnly === '0' || availableOnly === 'false' ? false : undefined,
      },
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

  @Get(':id/receipt')
  async getReceipt(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.getBookingReceipt(id, user.id, user.role);
  }

  @Post(':id/report')
  async reportBooking(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { reason: string; details?: string },
  ) {
    const role = user.role === UserRole.MECHANIC ? 'MECHANIC' : 'USER';
    return this.bookingsService.reportBooking(id, user.id, role, body.reason, body.details);
  }

  @Put(':id/dispute')
  async dispute(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { reason: string },
  ) {
    return this.bookingsService.raiseDispute(id, user.id, user.role, body.reason);
  }

  @Put(':id/messages/read')
  async markMessagesRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.markBookingMessagesRead(id, user.id);
  }

  @Post(':id/photos')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER)
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: 3 * 1024 * 1024 },
    }),
  )
  async uploadBookingPhotos(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('No files uploaded');
    const urls: string[] = [];
    for (const file of files) {
      urls.push(await this.cloudinaryService.uploadImage(file, 'booking-photos'));
    }
    return this.bookingsService.appendBookingPhotoUrls(id, user.id, urls);
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
