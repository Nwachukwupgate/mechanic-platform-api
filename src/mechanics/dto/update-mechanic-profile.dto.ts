import {
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class UpdateMechanicProfileDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number | null;

  @IsOptional()
  @IsString()
  avatar?: string | null;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  availability?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expertise?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brands?: string[];

  @IsOptional()
  @IsString()
  experience?: string;

  @IsOptional()
  @IsString()
  workshopAddress?: string;

  @IsOptional()
  @IsString()
  certificateUrl?: string | null;

  @IsOptional()
  @IsString()
  guarantorName?: string;

  @IsOptional()
  @IsString()
  guarantorPhone?: string;

  @IsOptional()
  @IsString()
  guarantorAddress?: string;

  @IsOptional()
  @IsString()
  nin?: string;

  /** Reply-time expectation (hours). Null clears the field. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(168)
  typicalResponseHours?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(500)
  nextAvailableNote?: string | null;
}
