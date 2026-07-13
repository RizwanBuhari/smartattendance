// Maps HTTP requests to the AttendanceService.
//
// Routes (all under /attendance) — these match exactly what the Flutter app
// already POSTs to, so the mobile side needs no changes:
//   POST /attendance/check-in   -> verify geofence + save a record
//   POST /attendance/check-out  -> close the open record
//   GET  /attendance            -> list all records (dashboard)
import { Body, Controller, Get, Post } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import type { AttendanceEvent } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  findAll() {
    return this.attendanceService.findAll();
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
