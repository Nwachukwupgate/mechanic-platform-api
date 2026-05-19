import { BadRequestException } from '@nestjs/common';
import { validateBreakdownNaira } from '../settlement/settlement-amounts';

export type QuotePricingInput = {
  proposedPrice?: number;
  partsCost?: number;
  labourCost?: number;
  otherFees?: number;
  quoteType?: 'STANDARD' | 'INSPECTION';
};

export type ResolvedQuotePricing = {
  proposedPrice: number;
  partsMinor: number;
  labourMinor: number;
  otherFeesMinor: number;
  customerTotalMinor: number;
  quoteType: 'STANDARD' | 'INSPECTION';
};

export function resolveQuotePricing(input: QuotePricingInput): ResolvedQuotePricing {
  if (input.quoteType === 'INSPECTION') {
    const fee = input.labourCost ?? input.proposedPrice ?? 0;
    if (fee <= 0) {
      throw new BadRequestException('Inspection / diagnosis fee must be greater than zero');
    }
    const totalMinor = Math.round(fee * 100);
    return {
      proposedPrice: fee,
      partsMinor: 0,
      labourMinor: totalMinor,
      otherFeesMinor: 0,
      customerTotalMinor: totalMinor,
      quoteType: 'INSPECTION',
    };
  }

  const hasBreakdown =
    input.partsCost != null || input.labourCost != null || input.otherFees != null;

  if (hasBreakdown) {
    try {
      const parts = input.partsCost ?? 0;
      const labour = input.labourCost ?? 0;
      const other = input.otherFees ?? 0;
      const validated = validateBreakdownNaira(parts, labour, other);
      if (
        input.proposedPrice != null &&
        Math.abs(input.proposedPrice - validated.customerTotalNaira) > 0.02
      ) {
        throw new BadRequestException('Total must equal parts + labour + other fees');
      }
      return {
        proposedPrice: validated.customerTotalNaira,
        partsMinor: validated.partsMinor,
        labourMinor: validated.labourMinor,
        otherFeesMinor: validated.otherFeesMinor,
        customerTotalMinor: validated.customerTotalMinor,
        quoteType: 'STANDARD',
      };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      if (e instanceof Error && e.message === 'TOTAL_REQUIRED') {
        throw new BadRequestException('Quote total must be greater than zero');
      }
      throw new BadRequestException('Invalid cost breakdown');
    }
  }

  if (input.proposedPrice == null || input.proposedPrice <= 0) {
    throw new BadRequestException('Price or cost breakdown is required');
  }
  const totalMinor = Math.round(input.proposedPrice * 100);
  return {
    proposedPrice: input.proposedPrice,
    partsMinor: 0,
    labourMinor: totalMinor,
    otherFeesMinor: 0,
    customerTotalMinor: totalMinor,
    quoteType: 'STANDARD',
  };
}

export type InvoicePricingInput = {
  partsCost: number;
  labourCost: number;
  otherFees?: number;
  notes?: string;
};

export function resolveInvoicePricing(input: InvoicePricingInput) {
  try {
    return validateBreakdownNaira(
      input.partsCost ?? 0,
      input.labourCost ?? 0,
      input.otherFees ?? 0,
    );
  } catch (e) {
    if (e instanceof Error && e.message === 'TOTAL_REQUIRED') {
      throw new BadRequestException('Invoice total must be greater than zero');
    }
    throw new BadRequestException('Invalid cost breakdown');
  }
}
