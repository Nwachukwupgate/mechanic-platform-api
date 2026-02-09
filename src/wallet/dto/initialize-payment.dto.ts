import { IsUUID } from 'class-validator';

export class InitializePaymentDto {
  @IsUUID()
  bookingId: string;
}
