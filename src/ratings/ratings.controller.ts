import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('ratings')
export class RatingsController {
  constructor(private ratingsService: RatingsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Post()
  async create(@CurrentUser() user: any, @Body() data: {
    bookingId: string;
    mechanicId: string;
    rating: number;
    comment?: string;
  }) {
    return this.ratingsService.createRating({
      ...data,
      userId: user.id,
    });
  }

  @Get('mechanic/:mechanicId')
  async getMechanicRatings(@Param('mechanicId') mechanicId: string) {
    return this.ratingsService.getRatingsByMechanic(mechanicId);
  }

  @Get('mechanic/:mechanicId/average')
  async getMechanicAverage(@Param('mechanicId') mechanicId: string) {
    return this.ratingsService.getAverageRating(mechanicId);
  }
}
