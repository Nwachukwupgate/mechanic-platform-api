import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { BookingStatus } from '@prisma/client';
import { TransactionType } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('emailVerified') emailVerified?: string,
  ) {
    return this.adminService.listUsers({
      page,
      limit,
      search,
      emailVerified: emailVerified === 'true' ? true : emailVerified === 'false' ? false : undefined,
    });
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Get('mechanics')
  listMechanics(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('isVerified') isVerified?: string,
  ) {
    return this.adminService.listMechanics({
      page,
      limit,
      search,
      isVerified: isVerified === 'true' ? true : isVerified === 'false' ? false : undefined,
    });
  }

  @Get('mechanics/:id')
  getMechanic(@Param('id') id: string) {
    return this.adminService.getMechanic(id);
  }

  @Patch('mechanics/:id/verify')
  setMechanicVerified(@Param('id') id: string, @Body() body: { isVerified: boolean }) {
    return this.adminService.setMechanicVerified(id, !!body.isVerified);
  }

  @Get('bookings')
  listBookings(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: BookingStatus,
    @Query('userId') userId?: string,
    @Query('mechanicId') mechanicId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('hasDispute') hasDispute?: string,
  ) {
    return this.adminService.listBookings({
      page,
      limit,
      status,
      userId,
      mechanicId,
      dateFrom,
      dateTo,
      hasDispute: hasDispute === 'true' ? true : hasDispute === 'false' ? false : undefined,
    });
  }

  @Get('bookings/:id')
  getBooking(@Param('id') id: string) {
    return this.adminService.getBooking(id);
  }

  @Patch('bookings/:id/dispute')
  setBookingDispute(
    @Param('id') id: string,
    @Body() body: { disputeReason?: string; resolve?: boolean },
    @CurrentUser() admin: any,
  ) {
    return this.adminService.setBookingDispute(id, body, admin.id);
  }

  @Get('transactions')
  listTransactions(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('type') type?: TransactionType,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('mechanicId') mechanicId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.listTransactions({
      page,
      limit,
      type,
      status,
      userId,
      mechanicId,
      dateFrom,
      dateTo,
    });
  }

  @Get('payouts/mechanics')
  getPayoutsMechanics() {
    return this.adminService.getPayoutsMechanics();
  }

  @Post('payouts')
  recordPayout(
    @Body() body: { mechanicId: string; amountMinor: number; reference?: string },
    @CurrentUser() admin: any,
  ) {
    return this.adminService.recordPayout(
      body.mechanicId,
      body.amountMinor,
      body.reference,
      admin.id,
    );
  }
}
