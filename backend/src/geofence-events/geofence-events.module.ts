import { Module } from '@nestjs/common';
import { GeofenceModule } from '../geofence/geofence.module';
import { GeofenceEventsController } from './geofence-events.controller';
import { GeofenceEventsService } from './geofence-events.service';

@Module({
  imports: [GeofenceModule],
  controllers: [GeofenceEventsController],
  providers: [GeofenceEventsService],
  exports: [GeofenceEventsService],
})
export class GeofenceEventsModule {}
