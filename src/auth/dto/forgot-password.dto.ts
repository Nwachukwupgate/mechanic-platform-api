import { IsEmail, IsIn } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;

  @IsIn(['USER', 'MECHANIC'])
  role!: 'USER' | 'MECHANIC';
}
