import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { VehicleType } from '@prisma/client';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, data: {
    type: VehicleType;
    brand: string;
    model: string;
    year: number;
    color?: string;
    licensePlate?: string;
  }) {
    return this.prisma.vehicle.create({
      data: {
        userId,
        ...data,
      },
    });
  }

  async findByUserId(userId: string) {
    return this.prisma.vehicle.findMany({
      where: { userId },
    });
  }

  async findById(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    return vehicle;
  }

  async update(id: string, userId: string, data: any) {
    const vehicle = await this.findById(id);
    if (vehicle.userId !== userId) {
      throw new NotFoundException('Vehicle not found');
    }

    return this.prisma.vehicle.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, userId: string) {
    const vehicle = await this.findById(id);
    if (vehicle.userId !== userId) {
      throw new NotFoundException('Vehicle not found');
    }

    return this.prisma.vehicle.delete({
      where: { id },
    });
  }
}
