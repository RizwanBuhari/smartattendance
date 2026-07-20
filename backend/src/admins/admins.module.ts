// Bundles the admins controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  controllers: [AdminsController],
  providers: [AdminsService, AdminGuard],
  // AdminGuard lives here (rather than its own module) because it depends on
  // AdminsService — keeping them together avoids a circular import. Other
  // feature modules import AdminsModule to use the guard.
  exports: [AdminsService, AdminGuard],
})
export class AdminsModule {}
