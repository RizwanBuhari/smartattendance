import { Module } from '@nestjs/common';
import { GeofenceService } from './geofence.service';

@Module({
  providers: [GeofenceService],
  exports: [GeofenceService],
})
export class GeofenceModule {}
