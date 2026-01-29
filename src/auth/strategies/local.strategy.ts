import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string, role: UserRole = UserRole.USER): Promise<any> {
    const user = await this.authService.validateUser(email, password, role);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
