import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OffsiteCheckinService } from './offsite-checkin.service';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@UseGuards(EmployeeGuard)
@Controller('offsite-checkin')
export class OffsiteCheckinController {
  constructor(private readonly checkinService: OffsiteCheckinService) {}

  @Post('requests')
  createRequest(
    @Req() req: AuthedRequest,
    @Body() body: { worksiteId: string; reason: string },
  ) {
    return this.checkinService.createRequest(req.employee, body);
  }

  @Get('my-requests')
  getMyRequests(@Req() req: AuthedRequest) {
    return this.checkinService.getMyRequests(req.employee);
  }

  @Get('requests/:id')
  getRequest(@Param('id') id: string) {
    return this.checkinService.getRequest(id);
  }

  @Post('requests/:id/cancel')
  cancelRequest(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.cancelRequest(req.employee, id);
  }

  @Get('supervisor/requests')
  getSupervisorRequests(@Req() req: AuthedRequest) {
    return this.checkinService.getSupervisorRequests(req.employee);
  }

  @Post('requests/:id/accept')
  acceptRequest(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.acceptRequest(req.employee, id);
  }

  @Post('requests/:id/reject')
  rejectRequest(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.checkinService.rejectRequest(req.employee, id, body.reason);
  }

  @Post('requests/:id/verify-qr')
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
  regenerateQr(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.checkinService.regenerateQr(req.employee, id);
  }
}
