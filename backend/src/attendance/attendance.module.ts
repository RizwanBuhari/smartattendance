// Bundles the attendance controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { GeofenceModule } from '../geofence/geofence.module';
import { AdminsModule } from '../admins/admins.module';
import { LocationsModule } from '../locations/locations.module';
import { OtpModule } from '../otp/otp.module';

@Module({
  // LocationsModule -> the requiresCheckInCode flag (cached);
  // OtpModule       -> verifying the scanned code during check-in.
  imports: [AdminsModule, GeofenceModule, LocationsModule, OtpModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
