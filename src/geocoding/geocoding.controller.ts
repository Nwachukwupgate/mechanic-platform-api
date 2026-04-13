import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

@Controller('geocoding')
export class GeocodingController {
  constructor(private geocodingService: GeocodingService) {}

  @Get('reverse')
  async reverse(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ): Promise<{ address: string }> {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      throw new BadRequestException('Invalid lat or lng');
    }
    const address = await this.geocodingService.reverseGeocode(latNum, lngNum);
    return { address };
  }

  @Get('search')
  async search(@Query('q') q: string): Promise<{ results: Array<{ lat: number; lng: number; label: string }> }> {
    if (!q || q.trim().length < 3) {
      throw new BadRequestException('Query must be at least 3 characters');
    }
    const results = await this.geocodingService.searchAddress(q.trim(), 5);
    return { results };
  }
}
