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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LocationPingsService } from './location-pings.service';
import { AdminGuard } from '../auth/admin.guard';
import { EmployeeGuard } from '../auth/employee.guard';
import { GeoPayloadPipe } from '../common/validation/geo-payload.pipe';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { LocationPingEvent } from './location-pings.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

const pingBodyPipe = new GeoPayloadPipe({ requireCoordinates: true });

@ApiTags('Location Pings')
@ApiBearerAuth('firebase')
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
  @ApiOperation({
    summary: 'Record a periodic location sample',
    description:
      'A coarse-grained complement to the native geofence events: a periodic ' +
      'sample during work hours, judged server-side and stored with a real ' +
      'measured distance.\n\n' +
      'Pings outside 09:00-18:00 local are refused with `accepted: false` — the ' +
      'phone should not be scheduling them then, but the server is the ' +
      'authority on that.\n\n' +
      'A sample whose fix was too poor to place is stored with ' +
      '`inconclusive: true` and is **not** counted as evidence the employee was ' +
      'absent. "We could not tell" is not "they were away" — treating it as ' +
      'such would flag anyone with a weak indoor signal.',
  })
  @ApiResponse({
    status: 201,
    description: 'Recorded, or refused for being outside tracking hours.',
    schema: {
      example: {
        accepted: true,
        id: 'auto_140',
        insideGeofence: true,
        distanceMeters: 37,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Malformed payload.' })
  record(
    @Req() req: AuthedRequest,
    @Body(pingBodyPipe) event: LocationPingEvent,
  ) {
    return this.locationPingsService.record({
      ...event,
      employeeId: req.employee.authUid,
    });
  }

  @UseGuards(AdminGuard)
  @Get('anomalies')
  @ApiOperation({
    summary: "Who is currently out of place",
    description:
      'One row per employee — their most recent EXIT — for the dashboard\'s ' +
      'live anomaly panel. Deliberately narrow:\n\n' +
      '- capped to the last 24 hours, so a stale anomaly does not linger;\n' +
      '- only the latest event per person, so a row updates in place instead of ' +
      'piling up while someone stays away;\n' +
      '- only employees currently on an **open shift**, so checking out clears ' +
      'them from the panel.',
  })
  @ApiResponse({ status: 200, description: 'Employees currently outside their area.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  findAnomalies() {
    return this.locationPingsService.findAnomalies();
  }

  @UseGuards(AdminGuard)
  @Get()
  @ApiOperation({
    summary: "One employee's full location trail",
    description:
      'Every ping and geofence event for one employee, newest first. Backs the ' +
      'per-employee heat-map in the dashboard reports, and doubles as the way ' +
      'to confirm the mobile background schedule is actually firing.',
  })
  @ApiQuery({
    name: 'employeeId',
    required: true,
    description: 'Firebase UID or employee document id.',
  })
  @ApiResponse({ status: 200, description: 'Combined pings and events.' })
  @ApiResponse({ status: 400, description: 'employeeId was not supplied.' })
  findAll(@Query('employeeId') employeeId?: string) {
    if (!employeeId) {
      throw new BadRequestException('employeeId query param is required.');
    }
    return this.locationPingsService.findAll(employeeId);
  }
}
