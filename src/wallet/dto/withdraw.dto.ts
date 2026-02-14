import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class WithdrawDto {
  /** Amount in kobo (e.g. 10000 = ₦100). */
  @IsInt()
  @Min(100, { message: 'Minimum withdrawal is ₦1 (100 kobo)' })
  @Type(() => Number)
  amountMinor: number;
}
