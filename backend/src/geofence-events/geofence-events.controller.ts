// Records a geofence ENTER/EXIT reported by the phone.
//
// Posted from the app's BACKGROUND isolate (native_geofence_service.dart), which
// initialises Firebase and has a signed-in user, so it can send a token like any
// other call — the isolate is not a reason to leave this open. employeeId is
// taken from that token: these events feed the dashboard's "left the work area"
// alerts, so being able to forge one for a colleague matters.
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  GeofenceEventDto,
  ExitReasonDto,
} from './dto/geofence-event.dto';
import { GeofenceEventsService } from './geofence-events.service';
import { EmployeeGuard } from '../auth/employee.guard';
import { GeoPayloadPipe } from '../common/validation/geo-payload.pipe';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { GeofenceEventPayload } from './geofence-events.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

// Coordinates are OPTIONAL here, unlike attendance: the background isolate reads
// the position on a 10-second timeout and legitimately fails sometimes (see
// native_geofence_service.dart). An ENTER/EXIT with no fix is still worth
// recording as an audit event — it just can't be cross-checked, which is exactly
// what `serverCheck.serverSaysInside: null` records.
const geofenceEventBodyPipe = new GeoPayloadPipe({
  requireCoordinates: false,
  allow: [
    'locationId',
    'eventType',
    'enteredAt',
    'dwellConfirmedAt',
    'exitedAt',
    'totalInsideDurationSeconds',
    'attendanceId',
    'source',
    'isBrief',
  ],
});

@ApiTags('Geofence Events')
@ApiBearerAuth('firebase')
@ApiSecurity('session')
@UseGuards(EmployeeGuard)
@Controller('geofence-events')
export class GeofenceEventsController {
  constructor(private readonly geofenceEventsService: GeofenceEventsService) {}

  @Post()
  @ApiOperation({
    summary: 'Record a native geofence event',
    description:
      'Continuous verification. Posted by the mobile app\'s **background ' +
      'isolate** when the OS reports a boundary crossing — this is what keeps ' +
      'checking that an employee remains on site after check-in, without the ' +
      'battery cost of polling.\n\n' +
      'The employee is taken from the bearer token, not the body: these events ' +
      'feed the dashboard\'s "left the work area" alerts, so being able to forge ' +
      'one for a colleague would matter.\n\n' +
      'When the payload carries coordinates the server measures them against ' +
      'the location\'s radius and stores the result as `serverCheck`. A ' +
      'contradiction (`serverCheck.contradictsClaim`) does **not** discard the ' +
      'event — it is recorded alongside it.\n\n' +
      'Events that fail to send are queued in SharedPreferences on the device ' +
      'and retried by WorkManager, so an offline crossing is not lost.',
  })
  @ApiBody({ type: GeofenceEventDto })
  @ApiResponse({
    status: 201,
    description: 'Recorded.',
    schema: {
      example: {
        accepted: true,
        id: 'auto_88',
        message: 'Geofence event EXIT recorded successfully.',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Malformed payload.' })
  record(
    @Req() req: AuthedRequest,
    @Body(geofenceEventBodyPipe) payload: GeofenceEventPayload,
  ) {
    return this.geofenceEventsService.record({
      ...payload,
      employeeId: req.employee.authUid,
    });
  }

  @Post('reason')
  @ApiOperation({
    summary: 'Submit a reason for leaving the approved area',
    description:
      'Lets the employee explain an EXIT. Attaches the reason to their recent ' +
      'EXIT events (last 24h) or the specific `eventId`, and notifies ' +
      'supervisors and admins. If no matching event is found a standalone ' +
      'record is created, so an explanation is never silently dropped.',
  })
  @ApiBody({ type: ExitReasonDto })
  @ApiResponse({
    status: 201,
    description:
      'Recorded and forwarded. An empty reason comes back as ' +
      '`accepted: false` rather than a 400.',
  })
  submitReason(
    @Req() req: AuthedRequest,
    @Body() body: { eventId?: string; locationId?: string; reason: string },
  ) {
    return this.geofenceEventsService.submitReason(
      req.employee.authUid,
      body.eventId,
      body.locationId,
      body.reason,
    );
  }
}
