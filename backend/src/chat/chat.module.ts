// Bundles the dashboard assistant's controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { LocationsModule } from '../locations/locations.module';
import { AdminsModule } from '../admins/admins.module';

@Module({
  imports: [
    // Each of these exports the service the assistant's tools call. Nothing new
    // is queried here — the tools reuse the same code paths the dashboard's own
    // pages already use, so the assistant cannot drift from what the UI shows.
    AttendanceModule,
    LocationsModule,
    // Provides AdminGuard, which the controller applies.
    AdminsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
