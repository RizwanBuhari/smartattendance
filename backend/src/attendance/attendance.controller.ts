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
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import type { AttendanceEvent } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  findAll(@Query('employeeId') employeeId?: string) {
    return this.attendanceService.findAll(employeeId);
  }

  @Get('reviews')
  getReviews() {
    return this.attendanceService.getReviews();
  }

  @Post(':id/review/accept')
  acceptReview(@Param('id') id: string) {
    return this.attendanceService.acceptReview(id);
  }

  @Post(':id/review/reject')
  rejectReview(@Param('id') id: string) {
    return this.attendanceService.rejectReview(id);
  }

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
