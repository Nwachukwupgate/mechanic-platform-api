import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteUserAccountDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reasons?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  otherReason?: string;
}
