import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
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
import { WithdrawDto } from './dto/withdraw.dto';
import { RecordFeePaymentDto } from './dto/record-fee-payment.dto';
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

  // --- User / mechanic: single transaction detail ---
  @Get('transactions/:id')
  async getTransaction(@CurrentUser() user: any, @Param('id') id: string) {
    if (user.role === UserRole.MECHANIC) {
      return this.walletService.getMechanicTransactionById(user.id, id);
    }
    if (user.role === UserRole.USER) {
      return this.walletService.getUserTransactionById(user.id, id);
    }
    throw new ForbiddenException('Wallet transactions are for users and mechanics only');
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

  /** Mechanic: Withdraw balance to default bank account (Paystack Transfer + record payout). */
  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('withdraw')
  async withdraw(@CurrentUser() mechanic: any, @Body() dto: WithdrawDto) {
    return this.walletService.requestWithdrawal(mechanic.id, dto.amountMinor);
  }

  /** Mechanic: record platform fee paid (e.g. after customer paid you directly). Creates MECHANIC_FEE transaction. */
  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('record-fee-payment')
  async recordFeePayment(@CurrentUser() mechanic: any, @Body() dto: RecordFeePaymentDto) {
    return this.walletService.recordMechanicFeePayment(
      mechanic.id,
      dto.amountMinor,
      dto.bookingId,
      dto.note,
    );
  }

  /** Mechanic: Start Paystack checkout to pay platform fee (20% on direct-paid jobs). */
  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('initialize-mechanic-fee-payment')
  async initializeMechanicFeePayment(@CurrentUser() mechanic: any, @Body() dto: RecordFeePaymentDto) {
    return this.walletService.initializeMechanicFeePayment(
      mechanic.id,
      dto.amountMinor,
      dto.bookingId,
      dto.note,
    );
  }

  /** Mechanic: Confirm Paystack platform fee payment after redirect / app resume. */
  @UseGuards(RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('verify-mechanic-fee-payment')
  async verifyMechanicFeePayment(@CurrentUser() mechanic: any, @Body() dto: VerifyPaymentDto) {
    return this.walletService.verifyMechanicFeePayment(mechanic.id, dto.reference);
  }
}
