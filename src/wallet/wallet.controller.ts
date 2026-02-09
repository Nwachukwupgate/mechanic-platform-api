import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ForbiddenException,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { MarkDirectPaidDto } from './dto/mark-direct-paid.dto';
import { TransactionType } from '@prisma/client';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  // --- User: Pay with Paystack (platform flow) ---
  @Post('initialize-payment')
  async initializePayment(@CurrentUser() user: any, @Body() dto: InitializePaymentDto) {
    if (user.role !== UserRole.USER) throw new ForbiddenException('Only users can pay for bookings');
    return this.walletService.initializePayment(user.id, dto.bookingId);
  }

  @Post('verify-payment')
  async verifyPayment(@CurrentUser() user: any, @Body() dto: VerifyPaymentDto) {
    if (user.role !== UserRole.USER) throw new ForbiddenException('Only users can verify payment');
    return this.walletService.verifyPayment(user.id, dto.reference);
  }

  @Post('mark-direct-paid')
  async markDirectPaid(@CurrentUser() user: any, @Body() dto: MarkDirectPaidDto) {
    if (user.role !== UserRole.USER) throw new ForbiddenException('Only users can mark direct payment');
    return this.walletService.markDirectPaid(user.id, dto.bookingId);
  }

  // --- User: My transactions ---
  @Get('transactions')
  async listUserTransactions(
    @CurrentUser() user: any,
    @Query('type') type?: TransactionType,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    if (user.role !== UserRole.USER) {
      return this.walletService.listMechanicTransactions(user.id, { type, limit, offset });
    }
    return this.walletService.listUserTransactions(user.id, { type, limit, offset });
  }

  // --- Mechanic: Balance, owing, transactions ---
  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Get('balance')
  async getBalance(@CurrentUser() mechanic: any) {
    return this.walletService.getMechanicBalance(mechanic.id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Get('owing')
  async getOwing(@CurrentUser() mechanic: any) {
    return this.walletService.getMechanicOwing(mechanic.id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Get('summary')
  async getMechanicSummary(@CurrentUser() mechanic: any) {
    return this.walletService.getMechanicWalletSummary(mechanic.id);
  }
}
