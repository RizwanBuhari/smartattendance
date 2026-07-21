// Where a phone tells the backend how to reach it.
//
//   POST   /devices/token  -> register (called after sign-in and on rotation)
//   DELETE /devices/token  -> unregister (called on sign-out)
//
// Guarded: the employee the token belongs to comes from the verified token, so
// nobody can register their own device against a colleague and receive that
// colleague's notifications.
import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@UseGuards(EmployeeGuard)
@Controller('devices')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('token')
  register(
    @Req() req: AuthedRequest,
    @Body() body: { token: string; platform?: string },
  ) {
    return this.push.register(req.employee.id, body.token, body.platform);
  }

  @Delete('token')
  unregister(@Body() body: { token: string }) {
    return this.push.unregister(body.token);
  }
}
