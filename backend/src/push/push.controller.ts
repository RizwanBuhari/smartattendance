// Where a phone tells the backend how to reach it.
//
//   POST   /devices/token  -> register (called after sign-in and on rotation)
//   DELETE /devices/token  -> unregister (called on sign-out)
//
// Guarded: the employee the token belongs to comes from the verified token, so
// nobody can register their own device against a colleague and receive that
// colleague's notifications.
import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { PushService } from './push.service';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@ApiTags('Devices')
@ApiBearerAuth('firebase')
@ApiSecurity('session')
@UseGuards(EmployeeGuard)
@Controller('devices')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('token')
  @ApiOperation({
    summary: 'Register an FCM token',
    description:
      'Called after sign-in and whenever Firebase rotates the token.\n\n' +
      'The owning employee comes from the verified bearer token, not the body, ' +
      "so nobody can register their handset against a colleague and receive that " +
      "colleague's notifications.",
  })
  @ApiResponse({ status: 201, description: 'Token registered.' })
  register(
    @Req() req: AuthedRequest,
    @Body() body: { token: string; platform?: string },
  ) {
    return this.push.register(req.employee.id, body.token, body.platform);
  }

  @Delete('token')
  @ApiOperation({
    summary: 'Unregister an FCM token',
    description:
      'Called on sign-out, before the Firebase session ends while the request ' +
      'can still authenticate. Skipping it would leave a shared handset ' +
      'receiving notifications meant for the previous user.',
  })
  @ApiResponse({ status: 200, description: 'Token removed.' })
  unregister(@Body() body: { token: string }) {
    return this.push.unregister(body.token);
  }
}
