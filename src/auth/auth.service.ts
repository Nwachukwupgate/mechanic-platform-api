import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MechanicsService } from '../mechanics/mechanics.service';
import { EmailService } from './email.service';
import { UserRole } from '@prisma/client';
import * as crypto from 'crypto';

const PASSWORD_RESET_OTP_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const FORGOT_PASSWORD_PUBLIC_MESSAGE =
  'If an account exists for this email, we sent a 6-digit code. Check your inbox.';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private usersService: UsersService,
    private mechanicsService: MechanicsService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashPasswordResetOtp(code: string, email: string, role: UserRole): string {
    const pepper = this.configService.get<string>('JWT_SECRET') || 'password-reset-dev-pepper';
    return crypto.createHash('sha256').update(`${code}:${email}:${role}:${pepper}`).digest('hex');
  }

  private async accountExistsForPasswordReset(normalizedEmail: string, role: UserRole): Promise<boolean> {
    if (role === UserRole.MECHANIC) {
      const m = await this.prisma.mechanic.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          deletedAt: null,
        },
      });
      return !!m;
    }
    const u = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        role: UserRole.USER,
      },
    });
    return !!u;
  }

  private async resolveRecipientEmail(normalizedEmail: string, role: UserRole): Promise<string | null> {
    if (role === UserRole.MECHANIC) {
      const m = await this.prisma.mechanic.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { email: true },
      });
      return m?.email ?? null;
    }
    const u = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        role: UserRole.USER,
      },
      select: { email: true },
    });
    return u?.email ?? null;
  }

  /** Request 6-digit OTP by email (USER or MECHANIC). Always same response if account missing. Resend obeys cooldown. */
  async requestPasswordResetOtp(email: string, role: UserRole) {
    if (role !== UserRole.USER && role !== UserRole.MECHANIC) {
      throw new BadRequestException('Invalid role for password reset');
    }
    const normalized = this.normalizeEmail(email);

    const latest = await this.prisma.passwordResetOtp.findFirst({
      where: { email: normalized, role },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < PASSWORD_RESET_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil(
        (PASSWORD_RESET_RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) / 1000,
      );
      throw new HttpException(
        `Please wait ${waitSec}s before requesting another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const exists = await this.accountExistsForPasswordReset(normalized, role);
    if (!exists) {
      return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE };
    }

    await this.prisma.passwordResetOtp.deleteMany({ where: { email: normalized, role } });

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = this.hashPasswordResetOtp(code, normalized, role);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MS);

    await this.prisma.passwordResetOtp.create({
      data: {
        email: normalized,
        role,
        codeHash,
        expiresAt,
      },
    });

    const recipient = await this.resolveRecipientEmail(normalized, role);
    if (recipient) {
      await this.emailService.sendPasswordResetOtp(recipient, code, role);
    }

    return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE };
  }

  async resetPasswordWithOtp(data: { email: string; role: UserRole; code: string; newPassword: string }) {
    if (data.role !== UserRole.USER && data.role !== UserRole.MECHANIC) {
      throw new BadRequestException('Invalid role for password reset');
    }
    const normalized = this.normalizeEmail(data.email);
    const code = data.code.trim();

    const challenge = await this.prisma.passwordResetOtp.findFirst({
      where: { email: normalized, role: data.role },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired code. Request a new one from Forgot password.');
    }
    if (challenge.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts. Request a new code.');
    }

    const expectedHash = this.hashPasswordResetOtp(code, normalized, data.role);
    if (challenge.codeHash !== expectedHash) {
      await this.prisma.passwordResetOtp.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect code. Try again or tap Resend code.');
    }

    const hashedPassword = await bcrypt.hash(data.newPassword, 10);

    if (data.role === UserRole.MECHANIC) {
      const mech = await this.prisma.mechanic.findFirst({
        where: {
          email: { equals: normalized, mode: 'insensitive' },
          deletedAt: null,
        },
      });
      if (!mech) {
        throw new BadRequestException('Account not found.');
      }
      await this.prisma.mechanic.update({
        where: { id: mech.id },
        data: { password: hashedPassword },
      });
    } else {
      const user = await this.prisma.user.findFirst({
        where: {
          email: { equals: normalized, mode: 'insensitive' },
          role: UserRole.USER,
        },
      });
      if (!user) {
        throw new BadRequestException('Account not found.');
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });
    }

    await this.prisma.passwordResetOtp.deleteMany({
      where: { email: normalized, role: data.role },
    });

    return { message: 'Password updated. You can sign in.' };
  }

  async validateUser(email: string, password: string, role: UserRole) {
    let user: any;
    if (role === UserRole.MECHANIC) {
      user = await this.prisma.mechanic.findUnique({ where: { email } });
      if (user?.deletedAt) {
        throw new UnauthorizedException('Invalid credentials');
      }
    } else if (role === UserRole.ADMIN) {
      user = await this.prisma.user.findFirst({ where: { email, role: UserRole.ADMIN } });
      if (!user) throw new UnauthorizedException('Invalid credentials');
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');
      return user;
    } else {
      user = await this.prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Email not verified');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(user: any, role: UserRole) {
    const payload = {
      email: user.email,
      sub: user.id,
      role: role,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: role,
        ...(role === UserRole.ADMIN && {
          adminPermissions: (user as any).adminPermissions ?? null,
        }),
      },
    };
  }

  async registerUser(data: {
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth: Date;
    password: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const emailToken = crypto.randomBytes(32).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dateOfBirth,
        emailToken,
      },
    });

    // Send verification email
    await this.emailService.sendVerificationEmail(user.email, emailToken, UserRole.USER);

    return {
      message: 'Registration successful. Please check your email to verify your account.',
      userId: user.id,
    };
  }

  async registerMechanic(data: {
    companyName: string;
    ownerFullName: string;
    email: string;
    password: string;
  }) {
    const existingMechanic = await this.prisma.mechanic.findUnique({
      where: { email: data.email },
    });

    if (existingMechanic) {
      throw new BadRequestException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const emailToken = crypto.randomBytes(32).toString('hex');
    const userId = crypto.randomUUID();

    const mechanic = await this.prisma.mechanic.create({
      data: {
        userId,
        email: data.email,
        password: hashedPassword,
        companyName: data.companyName,
        ownerFullName: data.ownerFullName,
        emailToken,
      },
    });

    // Send verification email
    await this.emailService.sendVerificationEmail(mechanic.email, emailToken, UserRole.MECHANIC);

    return {
      message: 'Registration successful. Please check your email to verify your account.',
      mechanicId: mechanic.id,
    };
  }

  async verifyEmail(token: string, role: UserRole) {
    if (role === UserRole.MECHANIC) {
      const mechanic = await this.prisma.mechanic.findFirst({
        where: { emailToken: token },
      });

      if (!mechanic) {
        throw new BadRequestException('Invalid verification token');
      }

      await this.prisma.mechanic.update({
        where: { id: mechanic.id },
        data: {
          emailVerified: true,
          emailToken: null,
        },
      });

      return { message: 'Email verified successfully' };
    } else {
      const user = await this.prisma.user.findFirst({
        where: { emailToken: token },
      });

      if (!user) {
        throw new BadRequestException('Invalid verification token');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          emailToken: null,
        },
      });

      return { message: 'Email verified successfully' };
    }
  }
}
