import { Controller, Get } from '@nestjs/common';
import { PaystackService } from './paystack.service';

/** Public endpoint: list Nigerian banks for mechanic withdrawal account form. */
@Controller('wallet')
export class BanksController {
  constructor(private paystackService: PaystackService) {}

  @Get('banks')
  async listBanks() {
    return this.paystackService.listBanks();
  }
}