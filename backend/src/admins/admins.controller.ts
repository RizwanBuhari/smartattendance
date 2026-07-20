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
import { AdminsService } from './admins.service';
import { AdminGuard } from '../auth/admin.guard';

function bearer(authorization?: string) {
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
}

@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  // Called by the dashboard right after login. The Firebase ID token comes in
  // the Authorization header ("Bearer <token>"). Returns { isAdmin }.
  @Get('verify')
  verify(@Headers('authorization') authorization?: string) {
    return this.adminsService.verify(bearer(authorization));
  }

  // Called by the dashboard right after a successful admin login to claim the
  // single active session. Returns { ok, sessionId }.
  @Post('session')
  claimSession(@Headers('authorization') authorization?: string) {
    return this.adminsService.claimSession(bearer(authorization));
  }

  // The logged-in admin's own profile.
  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.adminsService.me(bearer(authorization));
  }

  @Patch('me')
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
  findAll() {
    return this.adminsService.findAll();
  }

  @UseGuards(AdminGuard)
  @Post()
  add(@Body('email') email: string) {
    return this.adminsService.add(email);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminsService.remove(id);
  }
}
