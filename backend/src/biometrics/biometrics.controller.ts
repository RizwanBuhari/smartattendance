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
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { BiometricsService } from './biometrics.service';
import { EmployeeGuard } from '../auth/employee.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthedEmployee } from '../auth/employee.guard';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@ApiTags('Biometrics')
@ApiBearerAuth('firebase')
@Controller('biometrics')
export class BiometricsController {
  constructor(private readonly biometricsService: BiometricsService) {}

  @UseGuards(EmployeeGuard)
  @Post('challenge')
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Start a biometric enrolment challenge',
    description:
      'Issues a short-lived nonce the device echoes back to `register-device`, ' +
      'so an enrolment cannot be replayed.',
  })
  @ApiResponse({ status: 201, description: 'The challenge nonce.' })
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
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Biometric enrolment status for the caller',
    description:
      'Whether this account has a device enrolled, and which. The mobile app ' +
      'uses it to decide between prompting for enrolment or for a scan.',
  })
  @ApiResponse({ status: 200, description: 'Enrolment state.' })
  getStatus(@Req() req: AuthedRequest) {
    return this.biometricsService.getStatus(req.employee.authUid);
  }

  @UseGuards(EmployeeGuard)
  @Post('register-device')
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Enrol this device for biometric verification',
    description:
      'Binds the handset to the account after a successful local biometric ' +
      'check. Complements the geofence rather than replacing it: biometrics ' +
      'prove *who*, the geofence proves *where*, and neither is sufficient ' +
      'alone.',
  })
  @ApiResponse({ status: 201, description: 'Device enrolled.' })
  registerDevice(
    @Req() req: AuthedRequest,
    @Body() body: { deviceId: string; deviceName?: string; challengeNonce?: string },
  ) {
    return this.biometricsService.registerDevice(req.employee.authUid, body);
  }

  @UseGuards(AdminGuard)
  @Post('reset-device/:employeeId')
  @ApiOperation({
    summary: 'Clear an employee\'s biometric enrolment (admin)',
    description:
      'The controlled-replacement path: a lost or replaced handset would ' +
      'otherwise lock the employee out of biometric check-in permanently.',
  })
  @ApiParam({ name: 'employeeId', description: 'Employee document id.' })
  @ApiResponse({ status: 201, description: 'Enrolment cleared.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
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
