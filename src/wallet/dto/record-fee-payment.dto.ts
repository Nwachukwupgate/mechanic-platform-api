import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class RecordFeePaymentDto {
  /** Amount in kobo; minimum 100 kobo (1 naira) */
  @IsInt()
  @Min(100)
  amountMinor!: number;

  /** Optional: allocate to a specific direct-paid booking's 20% platform fee */
  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
