import { IsString, IsBoolean, IsOptional, MinLength, MaxLength } from 'class-validator';

export class AddBankAccountDto {
  @IsString()
  bankCode: string;

  @IsString()
  bankName: string;

  @IsString()
  @MinLength(10, { message: 'Account number must be at least 10 digits' })
  @MaxLength(15, { message: 'Account number must be at most 15 characters' })
  accountNumber: string;

  @IsString()
  accountName: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
