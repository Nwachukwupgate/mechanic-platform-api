import { IsUUID } from 'class-validator';

export class MarkDirectPaidDto {
  @IsUUID()
  bookingId: string;
}
