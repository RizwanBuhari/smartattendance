import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { LocationsModule } from './locations/locations.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CompanyCodesModule } from './company-codes/company-codes.module';

@Module({
  imports: [EmployeesModule, LocationsModule, AttendanceModule, CompanyCodesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
