// Bundles the attendance controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { GeofenceModule } from '../geofence/geofence.module';
import { AdminsModule } from '../admins/admins.module';
import { LocationsModule } from '../locations/locations.module';
import { OtpModule } from '../otp/otp.module';
import { CodeRequestsModule } from '../code-requests/code-requests.module';

@Module({
  // LocationsModule    -> the requiresCheckInCode flag (cached);
  // OtpModule          -> verifying the scanned code during check-in;
  // CodeRequestsModule -> telling site admins someone is waiting.
  imports: [
    AdminsModule,
    GeofenceModule,
    LocationsModule,
    OtpModule,
    CodeRequestsModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
