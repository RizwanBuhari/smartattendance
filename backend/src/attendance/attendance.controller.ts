// Maps HTTP requests to the AttendanceService.
//
// Routes (all under /attendance):
//   POST /attendance/check-in            -> verify geofence + save a record
//   POST /attendance/check-out           -> close the open record
//   GET  /attendance                     -> list all records (dashboard)
//   GET  /attendance?employeeId=xxx      -> just that employee's records (mobile history)
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
