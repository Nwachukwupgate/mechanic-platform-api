import { Controller, Get, Put, Body, UseGuards, Param, Post, Delete } from '@nestjs/common';
import { UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MechanicsService } from './mechanics.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { UpdateMechanicProfileDto } from './dto/update-mechanic-profile.dto';
import { AddBankAccountDto } from './dto/add-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Controller('mechanics')
export class MechanicsController {
  constructor(
    private mechanicsService: MechanicsService,
    private cloudinaryService: CloudinaryService,
  ) {}

  @Get()
  async findAll() {
    return this.mechanicsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.mechanicsService.findById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Get('me/profile')
  async getMyProfile(@CurrentUser() mechanic: any) {
    return this.mechanicsService.getMyProfileWithStats(mechanic.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put('me/profile')
  async updateProfile(@CurrentUser() mechanic: any, @Body() data: UpdateMechanicProfileDto) {
    return this.mechanicsService.updateProfile(mechanic.id, { ...data });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put('me/push-token')
  async setPushToken(@CurrentUser() mechanic: any, @Body() body: { token: string | null }) {
    return this.mechanicsService.setExpoPushToken(mechanic.id, body.token ?? null);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put('me/availability')
  async updateAvailability(@CurrentUser() mechanic: any, @Body() data: { availability: boolean }) {
    return this.mechanicsService.updateAvailability(mechanic.id, data.availability);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('me/upload-certificate')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException('Only PDF and images allowed'), false);
      },
    }),
  )
  async uploadCertificate(
    @CurrentUser() mechanic: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = await this.cloudinaryService.uploadFile(file);
    return { certificateUrl: url };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('me/upload-avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
      fileFilter: (_, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException('Only JPEG, PNG and WebP images allowed'), false);
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() mechanic: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = await this.cloudinaryService.uploadImage(file, 'mechanic-avatars');
    return { avatarUrl: url };
  }

  // ——— Bank accounts (for withdrawals) ———
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Get('me/bank-accounts')
  async listMyBankAccounts(@CurrentUser() mechanic: any) {
    return this.mechanicsService.listBankAccounts(mechanic.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('me/bank-accounts')
  async addBankAccount(@CurrentUser() mechanic: any, @Body() body: AddBankAccountDto) {
    return this.mechanicsService.addBankAccount(mechanic.id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put('me/bank-accounts/:accountId')
  async updateBankAccount(
    @CurrentUser() mechanic: any,
    @Param('accountId') accountId: string,
    @Body() body: UpdateBankAccountDto,
  ) {
    return this.mechanicsService.updateBankAccount(mechanic.id, accountId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Put('me/bank-accounts/:accountId/default')
  async setDefaultBankAccount(
    @CurrentUser() mechanic: any,
    @Param('accountId') accountId: string,
  ) {
    return this.mechanicsService.setDefaultBankAccount(mechanic.id, accountId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Delete('me/bank-accounts/:accountId')
  async deleteBankAccount(
    @CurrentUser() mechanic: any,
    @Param('accountId') accountId: string,
  ) {
    return this.mechanicsService.deleteBankAccount(mechanic.id, accountId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MECHANIC)
  @Post('me/delete-account')
  async deleteMyAccount(@CurrentUser() mechanic: any) {
    return this.mechanicsService.deleteAccount(mechanic.id);
  }
}
