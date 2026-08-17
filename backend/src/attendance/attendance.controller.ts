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
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { AdminGuard } from '../auth/admin.guard';
import { EmployeeGuard } from '../auth/employee.guard';
import { GeoPayloadPipe } from '../common/validation/geo-payload.pipe';
import {
  CheckInDto,
  CheckOutDto,
  CheckInAcceptedDto,
  CheckInRejectedDto,
  CheckOutResultDto,
  RejectReviewDto,
} from './dto/attendance.dto';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { AttendanceEvent } from './attendance.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

// AdminGuard attaches the verified admin email to the request.
interface AdminRequest {
  adminEmail?: string;
}

// Validates and whitelists the GPS body on check-in/check-out. Coordinates are
// mandatory here: an attendance event without a position is exactly the "trust
// the button press" case this project exists to eliminate, so it is rejected at
// the door rather than stored with nulls.
const attendanceBodyPipe = new GeoPayloadPipe({
  requireCoordinates: true,
  allow: [
    'isInsideGeofence',
    'isDwellConfirmed',
    'assignedAuthPolicy',
    'preferredAuthMethod',
    'authMethodUsed',
    'fallbackUsed',
    'fallbackReason',
  ],
});

@ApiTags('Attendance')
@ApiBearerAuth('firebase')
// The check-in response is a union of these two. Nest only emits a schema it has
// seen referenced by a decorator, so they are registered explicitly here to make
// the $ref/getSchemaPath usages below resolve.
@ApiExtraModels(CheckInAcceptedDto, CheckInRejectedDto)
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
  @ApiOperation({
    summary: 'List all attendance records (admin)',
    description:
      'Every record for employees that still exist, newest first. Records ' +
      'belonging to a deleted employee are purged rather than returned. Each ' +
      'record carries `flaggedOutside`, true when a background location ping ' +
      'caught the employee outside their radius during the shift, or the ' +
      'checkout itself happened outside it.\n\n' +
      'This is everyone\'s movement history, so it is admin-only. Mobile ' +
      'clients use `GET /attendance/me`.',
  })
  @ApiQuery({
    name: 'employeeId',
    required: false,
    description: 'Narrow to one employee (Firebase UID or employee doc id).',
  })
  @ApiResponse({ status: 200, description: 'Attendance records, newest first.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  findAll(@Query('employeeId') employeeId?: string) {
    return this.attendanceService.findAll(employeeId);
  }

  // The caller's own history. Attendance records are keyed by the Firebase UID
  // (not the employees_ids doc id), so authUid is the right field here.
  @UseGuards(EmployeeGuard)
  @Get('me')
  @ApiSecurity('session')
  @ApiOperation({
    summary: "The caller's own attendance history",
    description:
      'Powers the mobile app\'s history tab. Scoped to the token\'s identity — ' +
      'there is no parameter to widen it, which is what stopped this being a ' +
      'route for reading a colleague\'s movements.',
  })
  @ApiResponse({ status: 200, description: 'The caller\'s records, newest first.' })
  findMine(@Req() req: AuthedRequest) {
    return this.attendanceService.findAll(
      req.employee.id,
      req.employee.authUid,
    );
  }

  @UseGuards(AdminGuard)
  @Get('reviews')
  @ApiOperation({
    summary: 'Pending out-of-radius checkout reviews',
    description:
      'Checkouts that completed from outside the approved radius and are ' +
      'awaiting an admin decision, newest first. Powers the dashboard Review ' +
      'page.',
  })
  @ApiResponse({ status: 200, description: 'Records with a pending review.' })
  getReviews() {
    return this.attendanceService.getReviews();
  }

  @UseGuards(AdminGuard)
  @Post(':id/review/accept')
  @ApiOperation({
    summary: 'Accept an out-of-radius checkout',
    description:
      'Clears the flag so the record reads as a normal checkout. The session ' +
      'was already closed at checkout time. Applied exactly once — a second ' +
      'decision finds the review resolved and is refused rather than ' +
      'overwriting the first reviewer.',
  })
  @ApiParam({ name: 'id', description: 'Attendance record id.' })
  @ApiResponse({ status: 201, description: 'Decision applied.' })
  acceptReview(@Param('id') id: string, @Req() req: AdminRequest) {
    // AdminGuard attached the verified admin email; the client never supplies it.
    return this.attendanceService.acceptReview(id, req.adminEmail);
  }

  @UseGuards(AdminGuard)
  @Post(':id/review/reject')
  @ApiOperation({
    summary: 'Reject an out-of-radius checkout',
    description:
      'Reopens the session (status returns to `checked_in`) and records the ' +
      'attempted checkout separately, so the employee is not credited for time ' +
      'they were away. The reviewing admin is taken from the token.',
  })
  @ApiParam({ name: 'id', description: 'Attendance record id.' })
  @ApiBody({ type: RejectReviewDto })
  @ApiResponse({ status: 201, description: 'Decision applied.' })
  rejectReview(
    @Param('id') id: string,
    @Body() body: RejectReviewDto,
    @Req() req: AdminRequest,
  ) {
    return this.attendanceService.rejectReview(id, body.reason, req.adminEmail);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an attendance record (admin)',
    description: 'For cleaning up duplicates. Also drops its internal metadata.',
  })
  @ApiParam({ name: 'id', description: 'Attendance record id.' })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }

  // The body still carries the GPS reading, device id and timestamp — things
  // only the phone knows — but employeeId is overwritten with the token's uid.
  // Previously the phone declared who it was, so anyone could check in or out
  // as any colleague, which is exactly the fraud this app exists to prevent.
  @UseGuards(EmployeeGuard)
  @Post('check-in')
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Check in',
    description:
      'Verifies presence **server-side** and opens an attendance session.\n\n' +
      'The four steps, in order:\n' +
      '1. Reject a body without usable coordinates.\n' +
      '2. Reject a GPS fix worse than the accuracy ceiling (default ±50m).\n' +
      '3. Measure the haversine distance to each of the employee\'s approved ' +
      'locations and take the nearest.\n' +
      '4. Accept only if inside that location\'s configured radius (plus up to ' +
      '25m of the reported accuracy at the boundary).\n\n' +
      '`isInsideGeofence` from the device is **not** the decision. It is ' +
      'cross-checked against the server\'s measurement and any contradiction is ' +
      'persisted as `verification.clientDisagreed`.\n\n' +
      'The employee is taken from the bearer token, never the body — a device ' +
      'can only check itself in. Unknown body fields are stripped.\n\n' +
      'A refusal is still HTTP 201 with `accepted: false`; branch on that field.',
  })
  @ApiBody({ type: CheckInDto })
  @ApiResponse({
    status: 201,
    description:
      'Processed. `accepted: true` opened a session; `accepted: false` was ' +
      'refused, with `reason` explaining why.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CheckInAcceptedDto) },
        { $ref: getSchemaPath(CheckInRejectedDto) },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Malformed body — missing, non-numeric or out-of-range coordinates, a ' +
      'negative accuracy, or an implausible timestamp.',
  })
  @ApiResponse({ status: 401, description: 'Missing, invalid or superseded token.' })
  checkIn(
    @Req() req: AuthedRequest,
    @Body(attendanceBodyPipe) event: AttendanceEvent,
  ) {
    return this.attendanceService.checkIn({
      ...event,
      employeeId: req.employee.authUid,
    });
  }

  @UseGuards(EmployeeGuard)
  @Post('check-out')
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Check out',
    description:
      'Closes every open session for the caller.\n\n' +
      'Deliberately **never blocked** by the geofence. Someone who genuinely ' +
      'needs to end a shift must not be stuck permanently checked in because ' +
      'their GPS drifted on the way out, or because they left site legitimately. ' +
      'An out-of-radius checkout still closes the session but sets ' +
      '`checkoutFlagged` and opens a pending review for an admin — accurate ' +
      'detection, not policy enforcement.',
  })
  @ApiBody({ type: CheckOutDto })
  @ApiResponse({ status: 201, type: CheckOutResultDto })
  @ApiResponse({ status: 400, description: 'Malformed body.' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or superseded token.' })
  checkOut(
    @Req() req: AuthedRequest,
    @Body(attendanceBodyPipe) event: AttendanceEvent,
  ) {
    return this.attendanceService.checkOut({
      ...event,
      employeeId: req.employee.authUid,
    });
  }
}
