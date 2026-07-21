// Bundles the one-time check-in code service.
//
// No `imports` are needed, which is worth explaining:
//   • RedisService comes from RedisModule, which is @Global — it is injectable
//     anywhere without importing it (so no RedisModule.forRootAsync() here;
//     this project's RedisModule has no such factory).
//   • Firestore is reached through getFirestore() directly, the same way every
//     other service in this codebase does it — there is no ORM module to wire.
//   • No MailModule: these codes are shown as a QR on the site admin's phone,
//     never emailed.
//
// Exported so AttendanceModule can inject OtpService and require a valid code
// during check-in.
import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OtpController } from './otp.controller';
import { EmployeeGuard } from '../auth/employee.guard';
import { CodeRequestsModule } from '../code-requests/code-requests.module';

@Module({
  // CodeRequestsModule -> the team list reports who is waiting for a code.
  imports: [CodeRequestsModule],
  controllers: [OtpController],
  providers: [OtpService, EmployeeGuard],
  // OtpService is exported so the attendance flow can require a valid code
  // during check-in; EmployeeGuard so other modules can authenticate the
  // mobile app the same way.
  exports: [OtpService, EmployeeGuard],
})
export class OtpModule {}
