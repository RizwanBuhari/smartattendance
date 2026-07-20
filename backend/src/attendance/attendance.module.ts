// Bundles the attendance controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { GeofenceModule } from '../geofence/geofence.module';
import { AdminsModule } from '../admins/admins.module';

@Module({
  imports: [AdminsModule, GeofenceModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
