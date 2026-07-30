import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BiometricsService } from './biometrics.service';
import { EmployeeGuard } from '../auth/employee.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthedEmployee } from '../auth/employee.guard';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@Controller('biometrics')
export class BiometricsController {
  constructor(private readonly biometricsService: BiometricsService) {}

  @UseGuards(EmployeeGuard)
  @Post('challenge')
  createChallenge(
    @Req() req: AuthedRequest,
    @Body() body?: { action?: string; deviceId?: string },
  ) {
    return this.biometricsService.createChallenge(
      req.employee.authUid,
      body?.action || 'check_in',
      body?.deviceId,
    );
  }

  @UseGuards(EmployeeGuard)
  @Get('status')
  getStatus(@Req() req: AuthedRequest) {
    return this.biometricsService.getStatus(req.employee.authUid);
  }

  @UseGuards(EmployeeGuard)
  @Post('register-device')
  registerDevice(
    @Req() req: AuthedRequest,
    @Body() body: { deviceId: string; deviceName?: string; challengeNonce?: string },
  ) {
    return this.biometricsService.registerDevice(req.employee.authUid, body);
  }

  @UseGuards(AdminGuard)
  @Post('reset-device/:employeeId')
  resetDevice(@Param('employeeId') employeeId: string) {
    return this.biometricsService.resetDevice(employeeId);
  }

  // Face Recognition Endpoints
  @UseGuards(EmployeeGuard)
  @Post('face/challenge')
  createFaceChallenge(
    @Req() req: AuthedRequest,
    @Body() body?: { action?: string; deviceId?: string },
  ) {
    return this.biometricsService.createChallenge(
      req.employee.authUid,
      body?.action || 'face_setup',
      body?.deviceId,
    );
  }

  @UseGuards(EmployeeGuard)
  @Post('face/register-device')
  registerFaceDevice(
    @Req() req: AuthedRequest,
    @Body() body: { deviceId: string; deviceName?: string; nonce?: string },
  ) {
    return this.biometricsService.registerFaceDevice(req.employee.authUid, body);
  }

  @UseGuards(AdminGuard)
  @Post('face/reset-device/:employeeId')
  resetFaceDevice(@Param('employeeId') employeeId: string) {
    return this.biometricsService.resetFaceDevice(employeeId);
  }
}
