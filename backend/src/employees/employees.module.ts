// Bundles the employees controller + service into one Nest module, so it can
// be plugged into the app in app.module.ts.
import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { AdminsModule } from '../admins/admins.module';

@Module({
  // AdminsModule provides AdminGuard, used by this module's controller.
  imports: [AdminsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
})
export class EmployeesModule {}
