import { IsString, IsBoolean, IsOptional, MinLength, MaxLength } from 'class-validator';

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Account number must be at least 10 digits' })
  @MaxLength(15, { message: 'Account number must be at most 15 characters' })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
