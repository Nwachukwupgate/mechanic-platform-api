import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class MechanicsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id },
      include: { profile: true },
    });

    if (!mechanic) {
      throw new NotFoundException('Mechanic not found');
    }

    return mechanic;
  }

  async findByEmail(email: string) {
    return this.prisma.mechanic.findUnique({
      where: { email },
      include: { profile: true },
    });
  }

  async updateProfile(mechanicId: string, data: any) {
    const {
      profileComplete,
      ...profileData
    } = data;
    const profile = await this.prisma.mechanicProfile.upsert({
      where: { mechanicId },
      update: profileData,
      create: {
        mechanicId,
        ...profileData,
      },
    });

    await this.prisma.mechanic.update({
      where: { id: mechanicId },
      data: { profileComplete: true },
    });

    return profile;
  }

  async updateAvailability(mechanicId: string, availability: boolean) {
    return this.prisma.mechanicProfile.upsert({
      where: { mechanicId },
      update: { availability },
      create: {
        mechanicId,
        availability,
        expertise: [],
      },
    });
  }

  async findAll() {
    return this.prisma.mechanic.findMany({
      include: { profile: true },
    });
  }
}
