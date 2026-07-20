// Blocks a request unless it carries a valid Firebase ID token belonging to a
// user listed in the admin_Users collection.
//
// Until now the dashboard checked "are you an admin?" in the BROWSER only, which
// protects nothing: the API itself accepted any request, so anyone who could
// reach the server could read or delete data without logging in. This guard
// moves that check to the server, where it cannot be bypassed.
//
// Applied per-route with @UseGuards(AdminGuard). It is deliberately NOT global:
// the mobile app does not send a token yet, so the routes it calls (check-in,
// registration, pings) must stay open or every employee would be locked out.
// See docs in each controller for which routes are which.
//
// Cost: verify() reuses the Redis-cached admin lookup, so a guarded request
// normally costs no extra Firestore read.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminsService } from '../admins/admins.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminsService: AdminsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      adminEmail?: string;
    }>();

    const header = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) {
      throw new UnauthorizedException('Sign in to access this resource.');
    }

    // verify() returns { isAdmin: false } for a token that is expired, forged or
    // simply not an admin's — all of them fail here.
    const { isAdmin, email } = await this.adminsService.verify(token);
    if (!isAdmin) {
      throw new ForbiddenException('Administrator access required.');
    }

    // Hand the verified identity to the route, so handlers never have to trust
    // an email or uid supplied in the body or query string.
    request.adminEmail = email;
    return true;
  }
}
