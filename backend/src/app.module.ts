import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { LocationsModule } from './locations/locations.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
  imports: [EmployeesModule, LocationsModule, AttendanceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
