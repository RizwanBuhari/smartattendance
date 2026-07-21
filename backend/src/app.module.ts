import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { LocationsModule } from './locations/locations.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CompanyCodesModule } from './company-codes/company-codes.module';
import { AdminsModule } from './admins/admins.module';
import { LocationPingsModule } from './location-pings/location-pings.module';
import { GeofenceEventsModule } from './geofence-events/geofence-events.module';
import { RedisModule } from './redis/redis.module';
import { OtpModule } from './otp/otp.module';

@Module({
  imports: [
    // Global — provides the shared cache client to every other module.
    RedisModule,
    EmployeesModule,
    LocationsModule,
    AttendanceModule,
    CompanyCodesModule,
    AdminsModule,
    LocationPingsModule,
    GeofenceEventsModule,
    OtpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
