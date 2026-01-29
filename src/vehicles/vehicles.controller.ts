import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VehicleType } from '@prisma/client';

@Controller('vehicles')
@UseGuards(JwtAuthGuard)
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Post()
  async create(@CurrentUser() user: any, @Body() data: {
    type: VehicleType;
    brand: string;
    model: string;
    year: number;
    color?: string;
    licensePlate?: string;
  }) {
    return this.vehiclesService.create(user.id, data);
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    return this.vehiclesService.findByUserId(user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.vehiclesService.findById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @CurrentUser() user: any, @Body() data: any) {
    return this.vehiclesService.update(id, user.id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.vehiclesService.delete(id, user.id);
  }
}
