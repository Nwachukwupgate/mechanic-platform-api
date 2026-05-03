import { IsEmail, IsIn, Matches, MinLength } from 'class-validator';

export class ResetPasswordOtpDto {
  @IsEmail()
  email!: string;

  @IsIn(['USER', 'MECHANIC'])
  role!: 'USER' | 'MECHANIC';

  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code!: string;

  @MinLength(6, { message: 'Password must be at least 6 characters' })
  newPassword!: string;
}
