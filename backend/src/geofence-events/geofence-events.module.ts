import { Module } from '@nestjs/common';
import { GeofenceModule } from '../geofence/geofence.module';
import { PushModule } from '../push/push.module';
import { GeofenceEventsController } from './geofence-events.controller';
import { GeofenceEventsService } from './geofence-events.service';

@Module({
  imports: [GeofenceModule, PushModule],
  controllers: [GeofenceEventsController],
  providers: [GeofenceEventsService],
  exports: [GeofenceEventsService],
})
export class GeofenceEventsModule {}
