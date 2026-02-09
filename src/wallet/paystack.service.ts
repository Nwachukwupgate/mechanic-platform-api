import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
}
