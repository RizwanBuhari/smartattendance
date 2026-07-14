import { Module } from '@nestjs/common';
import { LocationPingsController } from './location-pings.controller';
import { LocationPingsService } from './location-pings.service';
import { GeofenceModule } from '../geofence/geofence.module';

@Module({
  imports: [GeofenceModule],
  controllers: [LocationPingsController],
  providers: [LocationPingsService],
})
export class LocationPingsModule {}
