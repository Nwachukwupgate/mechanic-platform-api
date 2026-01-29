import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register/user')
  async registerUser(@Body() data: {
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth: string;
    password: string;
  }) {
    return this.authService.registerUser({
      ...data,
      dateOfBirth: new Date(data.dateOfBirth),
    });
  }

  @Post('register/mechanic')
  async registerMechanic(@Body() data: {
    companyName: string;
    ownerFullName: string;
    email: string;
    password: string;
  }) {
    return this.authService.registerMechanic(data);
  }

  @Post('login/user')
  async loginUser(@Body() data: { email: string; password: string }) {
    const user = await this.authService.validateUser(data.email, data.password, UserRole.USER);
    return this.authService.login(user, UserRole.USER);
  }

  @Post('login/mechanic')
  async loginMechanic(@Body() data: { email: string; password: string }) {
    const mechanic = await this.authService.validateUser(data.email, data.password, UserRole.MECHANIC);
    return this.authService.login(mechanic, UserRole.MECHANIC);
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Query('role') role: string) {
    return this.authService.verifyEmail(token, role as UserRole);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: any) {
    return user;
  }
}
