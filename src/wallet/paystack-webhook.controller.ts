import { Controller, Post, Req, Headers, Logger, RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WalletService } from './wallet.service';
import { PaystackService } from './paystack.service';

/**
 * Public endpoint (no JWT). Paystack sends HMAC-signed raw JSON.
 * Configure URL in Paystack Dashboard → Settings → Webhooks.
 */
@Controller('webhooks')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly paystackService: PaystackService,
  ) {}

  @Post('paystack')
  async handlePaystack(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      this.logger.warn('Paystack webhook: raw body missing (use NestFactory.create(..., { rawBody: true }))');
      return { received: true };
    }

    if (!this.paystackService.verifyWebhookSignature(raw, signature)) {
      this.logger.warn('Paystack webhook: invalid signature');
      return { received: true };
    }

    let payload: { event?: string; data?: { reference?: string } };
    try {
      payload = JSON.parse(raw.toString('utf8')) as typeof payload;
    } catch {
      this.logger.warn('Paystack webhook: invalid JSON');
      return { received: true };
    }

    if (payload.event === 'charge.success' && payload.data?.reference) {
      const ref = String(payload.data.reference).trim();
      try {
        const out = await this.walletService.finalizePaystackUserPaymentFromWebhook(ref);
        this.logger.log(`charge.success reference=${ref} result=${JSON.stringify(out)}`);
      } catch (e) {
        this.logger.error(`charge.success handler error reference=${ref} ${String(e)}`);
      }
    }

    return { received: true };
  }
}
