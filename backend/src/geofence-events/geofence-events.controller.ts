import { Body, Controller, Post } from '@nestjs/common';
import { GeofenceEventsService } from './geofence-events.service';
import type { GeofenceEventPayload } from './geofence-events.service';

@Controller('geofence-events')
export class GeofenceEventsController {
  constructor(private readonly geofenceEventsService: GeofenceEventsService) {}

  @Post()
  record(@Body() payload: GeofenceEventPayload) {
    return this.geofenceEventsService.record(payload);
  }
}
