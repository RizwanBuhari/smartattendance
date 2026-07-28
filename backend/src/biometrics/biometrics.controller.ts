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
  createChallenge(@Req() req: AuthedRequest) {
    return this.biometricsService.createChallenge(req.employee.authUid);
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
}
