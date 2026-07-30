import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { CheckoutReminderService } from './checkout-reminder.service';
import { GeofenceModule } from '../geofence/geofence.module';
import { AdminsModule } from '../admins/admins.module';
import { CodeRequestsModule } from '../code-requests/code-requests.module';
import { PushModule } from '../push/push.module';

// LocationsModule and OtpModule were dropped alongside the unused
// LocationsService/OtpService injections in AttendanceService. Locations are
// still consulted on every check-in — but through GeofenceService, which owns
// that lookup now, so attendance no longer needs its own handle on them.
@Module({
  imports: [AdminsModule, GeofenceModule, CodeRequestsModule, PushModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, CheckoutReminderService],
})
export class AttendanceModule {}
