import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { FaultCategory } from '@prisma/client';

@Injectable()
export class FaultsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.fault.findMany();
  }

  async findByCategory(category: FaultCategory) {
    return this.prisma.fault.findMany({
      where: { category },
    });
  }

  async findById(id: string) {
    return this.prisma.fault.findUnique({
      where: { id },
    });
  }

  async create(data: {
    category: FaultCategory;
    name: string;
    description?: string;
    questions?: any;
  }) {
    return this.prisma.fault.create({
      data,
    });
  }
}
