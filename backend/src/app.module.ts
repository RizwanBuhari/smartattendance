import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { AuthModule } from './auth/auth.module';
import { PushModule } from './push/push.module';
import { CodeRequestsModule } from './code-requests/code-requests.module';
import { RequestLoggerMiddleware } from './request-logger.middleware';

@Module({
  imports: [
    // Global — provides the shared cache client to every other module.
    RedisModule,
    // The mobile app's sign-in / sign-up front door.
    AuthModule,
    // Device tokens + push, and the "waiting for a code" requests that use it.
    PushModule,
    CodeRequestsModule,
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
export class AppModule implements NestModule {
  // Logs every request, so it is obvious whether a device is reaching
  // the server at all.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
