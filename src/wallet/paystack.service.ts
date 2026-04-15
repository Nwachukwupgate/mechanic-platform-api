import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

export interface PaystackInitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyResult {
  amount: number; // in kobo
  reference: string;
  status: 'success' | 'failed';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaystackService {
  constructor(private configService: ConfigService) {}

  private getSecretKey(): string {
    const key = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) {
      throw new BadRequestException('Paystack is not configured');
    }
    return key;
  }

  /**
   * Verify Paystack webhook `x-paystack-signature` (HMAC SHA512 of raw body).
   * See https://paystack.com/docs/payments/webhooks/
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      return false;
    }
    const key = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) return false;
    const expected = createHmac('sha512', key).update(rawBody).digest('hex');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signatureHeader, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async initializeTransaction(
    amountKobo: number,
    email: string,
    reference: string,
    metadata?: Record<string, unknown>,
    callbackUrl?: string,
  ): Promise<PaystackInitializeResult> {
    const body: Record<string, unknown> = {
      amount: amountKobo,
      email,
      reference,
      currency: 'NGN',
      metadata: metadata || {},
    };
    if (callbackUrl) body.callback_url = callbackUrl;

    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: { authorization_url: string; access_code: string; reference: string };
    };

    if (!data.status || !data.data) {
      throw new BadRequestException(data.message || 'Failed to initialize Paystack payment');
    }

    return {
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifyResult | null> {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${this.getSecretKey()}`,
      },
    });

    const data = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: {
        amount: number;
        reference: string;
        status: string;
        metadata?: Record<string, unknown>;
      };
    };

    if (!data.status || !data.data) {
      return null;
    }

    return {
      amount: data.data.amount,
      reference: data.data.reference,
      status: data.data.status === 'success' ? 'success' : 'failed',
      metadata: data.data.metadata,
    };
  }

  /** List Nigerian banks (for mechanic withdrawal account form). Uses Paystack list. */
  async listBanks(): Promise<{ code: string; name: string }[]> {
    const res = await fetch(`${PAYSTACK_BASE}/bank?country=nigeria`, {
      headers: { Authorization: `Bearer ${this.getSecretKey()}` },
    });
    const data = (await res.json()) as {
      status: boolean;
      data?: Array<{ code: string; name: string }>;
    };
    if (!data.status || !Array.isArray(data.data)) return [];
    return data.data.map((b) => ({ code: b.code, name: b.name }));
  }

  /** Create a transfer recipient (NUBAN) for sending to a Nigerian bank account. */
  async createTransferRecipient(
    bankCode: string,
    accountNumber: string,
    accountName: string,
  ): Promise<{ recipientCode: string }> {
    const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      }),
    });
    const data = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: { recipient_code: string };
    };
    if (!data.status || !data.data?.recipient_code) {
      throw new BadRequestException(data.message || 'Failed to create transfer recipient');
    }
    return { recipientCode: data.data.recipient_code };
  }

  /** Initiate transfer to a recipient. Amount in kobo. Reference: 16–50 chars, lowercase alphanumeric, underscore, dash. */
  async initiateTransfer(
    amountKobo: number,
    recipientCode: string,
    reference: string,
    reason: string,
  ): Promise<{ transferCode: string; status: string }> {
    const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amountKobo,
        recipient: recipientCode,
        reference,
        reason,
      }),
    });
    const data = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: { transfer_code: string; status: string };
    };
    if (!data.status || !data.data) {
      throw new BadRequestException(data.message || 'Transfer failed');
    }
    return {
      transferCode: data.data.transfer_code ?? '',
      status: data.data.status ?? 'pending',
    };
  }
}
