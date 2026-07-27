import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { CheckoutReminderService } from './checkout-reminder.service';
import { GeofenceModule } from '../geofence/geofence.module';
import { AdminsModule } from '../admins/admins.module';
import { LocationsModule } from '../locations/locations.module';
import { OtpModule } from '../otp/otp.module';
import { CodeRequestsModule } from '../code-requests/code-requests.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [
    AdminsModule,
    GeofenceModule,
    LocationsModule,
    OtpModule,
    CodeRequestsModule,
    PushModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, CheckoutReminderService],
})
export class AttendanceModule {}
