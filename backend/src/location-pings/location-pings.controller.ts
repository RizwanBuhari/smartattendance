// Routes for the locationPings collection.
//   POST /location-pings                   -> mobile app's periodic 9-6 background ping
//   GET  /location-pings/anomalies         -> dashboard's "out of place" panel
//   GET  /location-pings?employeeId=xxx    -> every ping for one employee (debugging aid + report heat-map)
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LocationPingsService } from './location-pings.service';
import { AdminGuard } from '../auth/admin.guard';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { LocationPingEvent } from './location-pings.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@Controller('location-pings')
export class LocationPingsController {
  constructor(private readonly locationPingsService: LocationPingsService) {}

  // Nothing in the Flutter app currently posts here — the background timer this
  // route was written for was never wired up. It stays for when it is, but
  // guarded from the start rather than left open: an unauthenticated write
  // endpoint lets anyone forge another employee's location trail, which is what
  // the dashboard's anomaly panel reads.
  @UseGuards(EmployeeGuard)
  @Post()
  record(@Req() req: AuthedRequest, @Body() event: LocationPingEvent) {
    return this.locationPingsService.record({
      ...event,
      employeeId: req.employee.authUid,
    });
  }

  @UseGuards(AdminGuard)
  @Get('anomalies')
  findAnomalies() {
    return this.locationPingsService.findAnomalies();
  }

  @UseGuards(AdminGuard)
  @Get()
  findAll(@Query('employeeId') employeeId?: string) {
    if (!employeeId) {
      throw new BadRequestException('employeeId query param is required.');
    }
    return this.locationPingsService.findAll(employeeId);
  }
}
