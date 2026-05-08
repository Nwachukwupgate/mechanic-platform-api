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
import { AdminPermissionGuard, RequirePermissions } from '../common/guards/admin-permission.guard';
import { ADMIN_PERMISSIONS } from '../common/guards/admin-permissions';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { BookingStatus } from '@prisma/client';
import { TransactionType } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, AdminPermissionGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('stats')
  @RequirePermissions(ADMIN_PERMISSIONS.OVERVIEW)
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS)
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
  @RequirePermissions(ADMIN_PERMISSIONS.USERS)
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id/email-verified')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS)
  setUserEmailVerified(
    @Param('id') id: string,
    @Body() body: { emailVerified: boolean },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.setUserEmailVerified(id, !!body.emailVerified, admin.id);
  }

  @Get('mechanics')
  @RequirePermissions(ADMIN_PERMISSIONS.MECHANICS)
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
  @RequirePermissions(ADMIN_PERMISSIONS.MECHANICS)
  getMechanic(@Param('id') id: string) {
    return this.adminService.getMechanic(id);
  }

  @Patch('mechanics/:id/verify')
  @RequirePermissions(ADMIN_PERMISSIONS.MECHANICS)
  setMechanicVerified(
    @Param('id') id: string,
    @Body() body: { isVerified: boolean },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.setMechanicVerified(id, !!body.isVerified, admin.id);
  }

  @Patch('mechanics/:id/status')
  @RequirePermissions(ADMIN_PERMISSIONS.MECHANICS)
  setMechanicOperationalStatus(
    @Param('id') id: string,
    @Body() body: { isVerified?: boolean; emailVerified?: boolean; availability?: boolean },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.setMechanicOperationalStatus(id, body, admin.id);
  }

  @Get('bookings')
  @RequirePermissions(ADMIN_PERMISSIONS.BOOKINGS)
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
  @RequirePermissions(ADMIN_PERMISSIONS.BOOKINGS)
  getBooking(@Param('id') id: string) {
    return this.adminService.getBooking(id);
  }

  @Patch('bookings/:id/status')
  @RequirePermissions(ADMIN_PERMISSIONS.BOOKINGS)
  setBookingStatus(
    @Param('id') id: string,
    @Body() body: { status: BookingStatus },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.setBookingStatus(id, body.status, admin.id);
  }

  @Patch('bookings/:id/dispute')
  @RequirePermissions(ADMIN_PERMISSIONS.BOOKINGS)
  setBookingDispute(
    @Param('id') id: string,
    @Body() body: { disputeReason?: string; resolve?: boolean },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.setBookingDispute(id, body, admin.id);
  }

  @Get('transactions')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
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

  @Get('transactions/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
  getTransaction(@Param('id') id: string) {
    return this.adminService.getTransaction(id);
  }

  @Post('transactions/:id/reconcile')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
  reconcileTransaction(@Param('id') id: string, @CurrentUser() admin: { id: string }) {
    return this.adminService.reconcileTransaction(id, admin.id);
  }

  @Post('transactions/:id/refund')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
  recordRefund(
    @Param('id') id: string,
    @Body() body: { amountMinor?: number; note?: string },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.recordRefundFromUserPayment(admin.id, id, body.amountMinor, body.note);
  }

  @Post('mechanics/:id/wallet-adjustment')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
  recordMechanicLedgerAdjustment(
    @Param('id') mechanicId: string,
    @Body() body: { direction: 'credit' | 'debit'; amountMinor: number; note?: string },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.recordMechanicLedgerAdjustment(
      admin.id,
      mechanicId,
      body.direction,
      body.amountMinor,
      body.note,
    );
  }

  @Get('reports')
  @RequirePermissions(ADMIN_PERMISSIONS.COMPLAINTS)
  listReports(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('resolved') resolved?: string,
    @Query('bookingId') bookingId?: string,
    @Query('reporterRole') reporterRole?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.listReports({
      page,
      limit,
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      bookingId,
      reporterRole,
      dateFrom,
      dateTo,
    });
  }

  @Get('reports/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.COMPLAINTS)
  getReport(@Param('id') id: string) {
    return this.adminService.getReport(id);
  }

  @Post('reports/:id/resolve')
  @RequirePermissions(ADMIN_PERMISSIONS.COMPLAINTS)
  resolveReport(@Param('id') id: string, @CurrentUser() admin: { id: string }) {
    return this.adminService.resolveReport(id, admin.id);
  }

  @Get('payouts/mechanics')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
  getPayoutsMechanics() {
    return this.adminService.getPayoutsMechanics();
  }

  @Post('payouts')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS)
  recordPayout(
    @Body() body: { mechanicId: string; amountMinor: number; reference?: string },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.recordPayout(body.mechanicId, body.amountMinor, body.reference, admin.id);
  }

  @Get('audit')
  @RequirePermissions(ADMIN_PERMISSIONS.AUDIT)
  listAuditLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('adminId') adminId?: string,
    @Query('action') action?: string,
  ) {
    return this.adminService.listAuditLogs({
      page,
      limit,
      entityType,
      entityId,
      adminId,
      action,
    });
  }

  @Get('admins')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS)
  listAdminUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.listAdminUsers({ page, limit });
  }

  @Post('admins')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS)
  createAdminUser(
    @Body() body: { email: string; password: string; superadmin?: boolean; permissions?: string[] },
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.createAdminUser(admin.id, body);
  }
}
