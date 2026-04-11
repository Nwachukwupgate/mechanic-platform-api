import { Controller, Get, Put, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { DeleteUserAccountDto } from './dto/delete-user-account.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: any) {
    return this.usersService.findById(user.id);
  }

  @Put('me/profile')
  async updateProfile(@CurrentUser() user: any, @Body() data: any) {
    return this.usersService.updateProfile(user.id, data);
  }

  @Post('me/delete-account')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER)
  async deleteAccount(@CurrentUser() user: any, @Body() body: DeleteUserAccountDto) {
    return this.usersService.deleteAccount(user.id, body);
  }

  @Post('me/blocked-mechanics')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER)
  async blockMechanic(@CurrentUser() user: any, @Body() body: { mechanicId: string }) {
    return this.usersService.blockMechanic(user.id, body.mechanicId);
  }

  @Delete('me/blocked-mechanics/:mechanicId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER)
  async unblockMechanic(@CurrentUser() user: any, @Param('mechanicId') mechanicId: string) {
    return this.usersService.unblockMechanic(user.id, mechanicId);
  }

  @Get('me/blocked-mechanics')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER)
  async listBlocked(@CurrentUser() user: any) {
    return this.usersService.listBlockedMechanics(user.id);
  }

  @Put('me/push-token')
  async setPushToken(@CurrentUser() user: any, @Body() body: { token: string | null }) {
    return this.usersService.setExpoPushToken(user.id, body.token ?? null);
  }
}
