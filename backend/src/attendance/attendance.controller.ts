// Maps HTTP requests to the AttendanceService.
//
// Routes (all under /attendance):
//   POST /attendance/check-in            -> verify geofence + save a record
//   POST /attendance/check-out           -> close the open record
//   GET  /attendance                     -> list all records (dashboard)
//   GET  /attendance?employeeId=xxx      -> just that employee's records (mobile history)
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
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AdminGuard } from '../auth/admin.guard';
import type { AttendanceEvent } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // UNGUARDED — shared by both clients: the dashboard lists everything, while
  // the mobile app calls it as /attendance?employeeId=xxx for its own history.
  // Guarding it would break mobile history, so it stays open until the app
  // sends a token. This is the one route still exposing data without auth.
  @Get()
  findAll(@Query('employeeId') employeeId?: string) {
    return this.attendanceService.findAll(employeeId);
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

  @Post('check-in')
  checkIn(@Body() event: AttendanceEvent) {
    return this.attendanceService.checkIn(event);
  }

  @Post('check-out')
  checkOut(@Body() event: AttendanceEvent) {
    return this.attendanceService.checkOut(event);
  }
}
