import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { FaultsService } from './faults.service';
import { FaultCategory } from '@prisma/client';

@Controller('faults')
export class FaultsController {
  constructor(private faultsService: FaultsService) {}

  @Get()
  async findAll(@Query('category') category?: FaultCategory) {
    if (category) {
      return this.faultsService.findByCategory(category);
    }
    return this.faultsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.faultsService.findById(id);
  }

  @Post()
  async create(@Body() data: {
    category: FaultCategory;
    name: string;
    description?: string;
    questions?: any;
  }) {
    return this.faultsService.create(data);
  }
}
