// Maps HTTP requests to the AttendanceService.
//
// Routes (all under /attendance):
//   POST /attendance/check-in            -> verify geofence + save a record
//   POST /attendance/check-out           -> close the open record
//   GET  /attendance                     -> list all records (dashboard, admin)
//   GET  /attendance/me                  -> the caller's own records (mobile history)
//   GET  /attendance/reviews             -> pending out-of-radius checkouts (Review page)
//   POST /attendance/:id/review/accept   -> approve an out-of-radius checkout
//   POST /attendance/:id/review/reject   -> reject an out-of-radius checkout
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AdminGuard } from '../auth/admin.guard';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { AttendanceEvent } from './attendance.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // The full log, for the dashboard only — this is everyone's movements.
  // It used to be unguarded and shared with the mobile app via
  // ?employeeId=xxx, which meant anyone could read anyone's history (or all of
  // it, by omitting the parameter). The mobile app now uses /me below, so this
  // can be admin-only.
  @UseGuards(AdminGuard)
  @Get()
  findAll(@Query('employeeId') employeeId?: string) {
    return this.attendanceService.findAll(employeeId);
  }

  // The caller's own history. Attendance records are keyed by the Firebase UID
  // (not the employees_ids doc id), so authUid is the right field here.
  @UseGuards(EmployeeGuard)
  @Get('me')
  findMine(@Req() req: AuthedRequest) {
    return this.attendanceService.findAll(req.employee.authUid);
  }

  @UseGuards(AdminGuard)
  @Get('reviews')
  getReviews() {
    return this.attendanceService.getReviews();
  }

  @UseGuards(AdminGuard)
  @Post(':id/review/accept')
  acceptReview(@Param('id') id: string) {
    return this.attendanceService.acceptReview(id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/review/reject')
  rejectReview(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.attendanceService.rejectReview(id, body.reason);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }

  // The body still carries the GPS reading, device id and timestamp — things
  // only the phone knows — but employeeId is overwritten with the token's uid.
  // Previously the phone declared who it was, so anyone could check in or out
  // as any colleague, which is exactly the fraud this app exists to prevent.
  @UseGuards(EmployeeGuard)
  @Post('check-in')
  checkIn(@Req() req: AuthedRequest, @Body() event: AttendanceEvent) {
    return this.attendanceService.checkIn({
      ...event,
      employeeId: req.employee.authUid,
    });
  }

  @UseGuards(EmployeeGuard)
  @Post('check-out')
  checkOut(@Req() req: AuthedRequest, @Body() event: AttendanceEvent) {
    return this.attendanceService.checkOut({
      ...event,
      employeeId: req.employee.authUid,
    });
  }
}
