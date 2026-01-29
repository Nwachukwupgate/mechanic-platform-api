import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MechanicsService } from '../mechanics/mechanics.service';
import { EmailService } from './email.service';
import { UserRole } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private usersService: UsersService,
    private mechanicsService: MechanicsService,
    private emailService: EmailService,
  ) {}

  async validateUser(email: string, password: string, role: UserRole) {
    let user: any;
    if (role === UserRole.MECHANIC) {
      user = await this.prisma.mechanic.findUnique({ where: { email } });
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
