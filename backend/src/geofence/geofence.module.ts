import { Module } from '@nestjs/common';
import { GeofenceService } from './geofence.service';
import { LocationsModule } from '../locations/locations.module';

@Module({
  // Brings in LocationsService for its Redis-cached locations list.
  imports: [LocationsModule],
  providers: [GeofenceService],
  exports: [GeofenceService],
})
export class GeofenceModule {}
