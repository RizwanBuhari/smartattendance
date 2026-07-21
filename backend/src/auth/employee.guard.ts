// Verifies that a request comes from a signed-in, active EMPLOYEE (the mobile
// app), and attaches that employee to the request.
//
// The point of this guard is to stop the server trusting identity sent in the
// body or query string. Today the mobile app says "I am employeeId X" and the
// backend believes it — so anyone could check in as anyone. After this guard,
// the identity comes from a Firebase ID token that only Firebase can sign.
//
// Handlers must therefore read `request.employee.id`, never an id from the body.
//
// This is the employee counterpart to AdminGuard: same token verification, but
// it resolves an employees_ids record instead of checking the admin list.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { RedisService } from '../redis/redis.service';
import type { Employee } from '../employees/employees.service';

// What the guard puts on the request for handlers to use.
export interface AuthedEmployee extends Employee {
  id: string;
}

@Injectable()
export class EmployeeGuard implements CanActivate {
  private readonly employees = getFirestore().collection('employees_ids');

  constructor(private readonly redis: RedisService) {}

  private cacheKey(uid: string) {
    return `auth:employee:${uid}`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      employee?: AuthedEmployee;
    }>();

    const header = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    // Fails for tokens that are expired, forged, or from another Firebase
    // project — Firebase checks the signature, expiry and audience for us.
    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    }

    // 1. Try to read from Redis cache
    let employee: AuthedEmployee | null = null;
    const cacheKey = this.cacheKey(uid);
    const cachedData = await this.redis.get(cacheKey);

    if (cachedData) {
      try {
        employee = JSON.parse(cachedData) as AuthedEmployee;
      } catch {
        employee = null;
      }
    }

    // 2. Cache miss: Query Firestore and cache the result in Redis (5-minute TTL)
    if (!employee) {
      const snap = await this.employees
        .where('authUid', '==', uid)
        .limit(1)
        .get();
      if (snap.empty) {
        throw new ForbiddenException(
          'No employee record is linked to this account.',
        );
      }

      const doc = snap.docs[0];
      employee = { ...(doc.data() as Employee), id: doc.id };

      // Cache it for 5 minutes (300 seconds)
      await this.redis.set(cacheKey, JSON.stringify(employee), 300);
    }

    // A valid token outlives a disabled account (up to an hour), so status has
    // to be re-checked here on every request rather than trusted from sign-in.
    if (employee.status !== 'active') {
      throw new ForbiddenException('This account has been disabled.');
    }

    request.employee = employee;
    return true;
  }
}

