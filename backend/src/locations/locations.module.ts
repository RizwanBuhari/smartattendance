// Bundles the locations controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { AdminsModule } from '../admins/admins.module';

@Module({
  // AdminsModule provides AdminGuard, used by this module's controller.
  imports: [AdminsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  // Exported so GeofenceService can reuse the cached locations list.
  exports: [LocationsService],
})
export class LocationsModule {}
