// Routes for admin authorization.
//   GET    /admins/verify  -> dashboard checks the logged-in user is an admin
//   GET    /admins         -> list admins
//   POST   /admins         -> add an admin by email
//   DELETE /admins/:id     -> remove an admin
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminsService } from './admins.service';
import { AdminGuard } from '../auth/admin.guard';

function bearer(authorization?: string) {
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
}

@ApiTags('Admins')
@ApiBearerAuth('firebase')
@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  // Called by the dashboard right after login. The Firebase ID token comes in
  // the Authorization header ("Bearer <token>"). Returns { isAdmin }.
  @Get('verify')
  @ApiOperation({
    summary: 'Is the bearer an administrator?',
    description:
      'Called by the dashboard immediately after login. Unguarded by design — ' +
      'this route **is** the admin check, so guarding it would be circular.',
  })
  @ApiResponse({ status: 200, schema: { example: { isAdmin: true } } })
  verify(@Headers('authorization') authorization?: string) {
    return this.adminsService.verify(bearer(authorization));
  }

  // Called by the dashboard right after a successful admin login to claim the
  // single active session. Returns { ok, sessionId }.
  @Post('session')
  @ApiOperation({
    summary: 'Claim the single active admin session',
    description:
      'Mints a session id and overwrites the stored one, evicting any other ' +
      'browser signed in as this admin. The dashboard mirror of the mobile ' +
      "app's one-account-one-device rule. Validates the token internally, so it " +
      'does not need the guard.',
  })
  @ApiResponse({ status: 201, schema: { example: { ok: true, sessionId: 'a1b2c3' } } })
  claimSession(@Headers('authorization') authorization?: string) {
    return this.adminsService.claimSession(bearer(authorization));
  }

  // The logged-in admin's own profile.
  @Get('me')
  @ApiOperation({ summary: "The signed-in administrator's own profile" })
  @ApiResponse({ status: 200, description: 'Profile.' })
  me(@Headers('authorization') authorization?: string) {
    return this.adminsService.me(bearer(authorization));
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit your own administrator profile',
    description: 'Display name, phone, job title and avatar only.',
  })
  @ApiResponse({ status: 200, description: 'Updated.' })
  updateMe(
    @Headers('authorization') authorization?: string,
    @Body()
    changes?: {
      displayName?: string;
      phone?: string;
      jobTitle?: string;
      photoBase64?: string;
    },
  ) {
    return this.adminsService.updateMe(bearer(authorization), changes ?? {});
  }

  // --- Admin-only from here down. -------------------------------------------
  // verify/session/me above are intentionally unguarded: verify IS the admin
  // check itself, and session/me already validate the token internally.
  //
  // These three are the most sensitive routes in the app — without a guard,
  // anyone who could reach the server could grant themselves admin access.

  @UseGuards(AdminGuard)
  @Get()
  @ApiOperation({ summary: 'List administrators' })
  @ApiResponse({ status: 200, description: 'Administrator records.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  findAll() {
    return this.adminsService.findAll();
  }

  @UseGuards(AdminGuard)
  @Post()
  @ApiOperation({
    summary: 'Grant administrator access by email',
    description:
      'The most sensitive route in the application: without its guard, anyone ' +
      'who could reach the server could grant themselves admin access.',
  })
  @ApiResponse({ status: 201, description: 'Administrator added.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  add(@Body('email') email: string) {
    return this.adminsService.add(email);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Revoke administrator access' })
  @ApiParam({ name: 'id', description: 'Administrator document id.' })
  @ApiResponse({ status: 200, description: 'Administrator removed.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  remove(@Param('id') id: string) {
    return this.adminsService.remove(id);
  }
}
