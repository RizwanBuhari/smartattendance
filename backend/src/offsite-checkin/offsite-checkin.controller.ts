import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { OffsiteCheckinService } from './offsite-checkin.service';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';

interface AuthedRequest {
  employee: AuthedEmployee;
}

/**
 * Supervisor-approved attendance for work that legitimately happens away from
 * any configured geofence — a customer site nobody has set a radius for yet.
 *
 * The escape hatch is deliberately *supervised* rather than automatic: the
 * employee raises a request, a supervisor accepts it and shows a QR, and the
 * employee scans it in person. That keeps a human in the loop precisely where
 * the location check cannot vouch for anyone, instead of letting an employee
 * self-declare their way past the geofence.
 */
@ApiTags('Offsite Check-in')
@ApiBearerAuth('firebase')
@ApiSecurity('session')
@UseGuards(EmployeeGuard)
@Controller('offsite-checkin')
export class OffsiteCheckinController {
  constructor(private readonly checkinService: OffsiteCheckinService) {}

  @Post('requests')
  @ApiOperation({
    summary: 'Raise an off-site check-in request',
    description:
      'Employee asks their supervisor to approve attendance away from any configured geofence.',
  })
  createRequest(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      worksiteId: string;
      reason?: string;
      authMethodUsed?: string;
      fallbackUsed?: boolean;
      fallbackReason?: string;
    },
  ) {
    return this.checkinService.createRequest(req.employee, body);
  }

  @Post('requests/checkout')
  @ApiOperation({
    summary: 'Raise an off-site check-out request',
    description: 'Same flow for ending a shift away from an approved location.',
  })
  createCheckoutRequest(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      worksiteId?: string;
      reason?: string;
      authMethodUsed?: string;
      fallbackUsed?: boolean;
      fallbackReason?: string;
    },
  ) {
    return this.checkinService.createCheckoutRequest(req.employee, body);
  }

  @Get('my-requests')
  @ApiOperation({
    summary: "The caller's own off-site requests",
    description:
      'Scoped to the token; the mobile app polls this for status changes.',
  })
  getMyRequests(@Req() req: AuthedRequest) {
    return this.checkinService.getMyRequests(req.employee);
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'One off-site request by id',
    description:
      'Used by the app after a push notification to load the current state.',
  })
  getRequest(@Param('id') id: string) {
    return this.checkinService.getRequest(id);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({
    summary: 'Cancel your own request',
    description: 'Only the employee who raised it may cancel.',
  })
  cancelRequest(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.cancelRequest(req.employee, id);
  }

  @Get('supervisor/requests')
  @ApiOperation({
    summary: 'Requests awaiting the calling supervisor',
    description:
      "Scoped to the supervisor's own team, so one supervisor cannot see another's queue.",
  })
  getSupervisorRequests(@Req() req: AuthedRequest) {
    return this.checkinService.getSupervisorRequests(req.employee);
  }

  @Post('requests/:id/accept')
  @ApiOperation({
    summary: 'Accept a request',
    description:
      'Approves it; the supervisor then generates a QR for the employee to scan.',
  })
  acceptRequest(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.acceptRequest(req.employee, id);
  }

  @Post('requests/:id/generate-qr')
  @ApiOperation({
    summary: 'Generate the QR for an accepted request',
    description:
      'Returns a short-lived signed token. In-person scanning is what substitutes for the location check here.',
  })
  generateQr(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.generateQr(req.employee, id);
  }

  @Post('requests/:id/reject')
  @ApiOperation({
    summary: 'Reject a request',
    description: 'Closes it with a reason; the employee is notified.',
  })
  rejectRequest(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.checkinService.rejectRequest(
      req.employee,
      id,
      body?.reason || '',
    );
  }

  @Post('requests/:id/verify-qr')
  @ApiOperation({
    summary: 'Verify a scanned QR and complete attendance',
    description:
      'The employee posts the scanned token. Single-use and time-limited, so a screenshot passed to a colleague is worthless.',
  })
  verifyScannedQr(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      scannedPayload: string;
      latitude: number;
      longitude: number;
      gpsAccuracy?: number;
      deviceId?: string;
    },
  ) {
    return this.checkinService.verifyScannedQr(req.employee, {
      requestId: id,
      ...body,
    });
  }

  @Post('requests/:id/regenerate-qr')
  @ApiOperation({
    summary: 'Reissue an expired QR',
    description: 'For when the employee did not scan in time.',
  })
  regenerateQr(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.regenerateQr(req.employee, id);
  }
}
