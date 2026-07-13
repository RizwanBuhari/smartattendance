import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { LocationsModule } from './locations/locations.module';

@Module({
  imports: [EmployeesModule, LocationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
