// Records a geofence ENTER/EXIT reported by the phone.
//
// Posted from the app's BACKGROUND isolate (native_geofence_service.dart), which
// initialises Firebase and has a signed-in user, so it can send a token like any
// other call — the isolate is not a reason to leave this open. employeeId is
// taken from that token: these events feed the dashboard's "left the work area"
// alerts, so being able to forge one for a colleague matters.
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { GeofenceEventsService } from './geofence-events.service';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { GeofenceEventPayload } from './geofence-events.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@UseGuards(EmployeeGuard)
@Controller('geofence-events')
export class GeofenceEventsController {
  constructor(private readonly geofenceEventsService: GeofenceEventsService) {}

  @Post()
  record(@Req() req: AuthedRequest, @Body() payload: GeofenceEventPayload) {
    return this.geofenceEventsService.record({
      ...payload,
      employeeId: req.employee.authUid,
    });
  }
}
