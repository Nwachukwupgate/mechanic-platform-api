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
}
