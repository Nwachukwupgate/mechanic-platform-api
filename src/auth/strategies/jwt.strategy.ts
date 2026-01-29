import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const { sub, role, email } = payload;

    if (role === 'MECHANIC') {
      const mechanic = await this.prisma.mechanic.findUnique({
        where: { id: sub },
      });
      if (!mechanic) {
        throw new UnauthorizedException();
      }
      return { ...mechanic, role: 'MECHANIC' };
    } else {
      const user = await this.prisma.user.findUnique({
        where: { id: sub },
      });
      if (!user) {
        throw new UnauthorizedException();
      }
      return { ...user, role: 'USER' };
    }
  }
}
