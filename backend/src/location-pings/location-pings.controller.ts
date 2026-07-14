// Routes for the locationPings collection.
//   POST /location-pings                   -> mobile app's periodic 9-6 background ping
//   GET  /location-pings/anomalies         -> dashboard's "out of place" panel
//   GET  /location-pings?employeeId=xxx    -> every ping for one employee (debugging aid)
import { BadRequestException, Controller, Get, Post, Query, Body } from '@nestjs/common';
import { LocationPingsService } from './location-pings.service';
import type { LocationPingEvent } from './location-pings.service';

@Controller('location-pings')
export class LocationPingsController {
  constructor(private readonly locationPingsService: LocationPingsService) {}

  @Post()
  record(@Body() event: LocationPingEvent) {
    return this.locationPingsService.record(event);
  }

  @Get('anomalies')
  findAnomalies() {
    return this.locationPingsService.findAnomalies();
  }

  @Get()
  findAll(@Query('employeeId') employeeId?: string) {
    if (!employeeId) {
      throw new BadRequestException('employeeId query param is required.');
    }
    return this.locationPingsService.findAll(employeeId);
  }
}
