// One-time check-in codes.
//
// A site admin issues a 6-digit code for a specific employee from the mobile
// app; the app renders it as a QR. The employee scans it and submits the digits
// with their check-in. The code proves a supervisor was physically present and
// vouched for them — a second factor on top of the GPS geofence, which on its
// own is spoofable.
//
// Redis is the right store here (not merely a cache): codes must expire on
// their own, and the retry counter must be incremented atomically. Both are
// native Redis operations.
//
// FAIL CLOSED: everything below treats "Redis unreachable" as "reject". A cache
// outage may slow the app down, but it must never let an unverified check-in
// through.
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { RedisService } from '../redis/redis.service';
import type { Employee } from '../employees/employees.service';

// What gets stored in Redis against the target employee.
interface StoredCode {
  code: string;
  locationId: string;
  issuedBy: string;
  issuedAt: string;
}

// What a successful verification hands back to the caller (the attendance flow
// records these on the attendance document as an audit trail).
export interface VerifiedCode {
  locationId: string;
  issuedBy: string;
}

@Injectable()
export class OtpService {
  private readonly db = getFirestore();
  private readonly employees = this.db.collection('employees_ids');

  constructor(private readonly redis: RedisService) {}

  // How long a QR stays valid. Short on purpose: the only real defence against
  // someone photographing the screen and relaying it is that it dies quickly.
  private readonly CODE_TTL_SECONDS = 60;
  // Wrong guesses allowed before the employee is locked out.
  private readonly MAX_VERIFY_ATTEMPTS = 5;
  // How long that lockout lasts.
  private readonly LOCKOUT_SECONDS = 3600;

  private codeKey(employeeId: string) {
    return `otp:checkin:${employeeId}`;
  }
  private attemptsKey(employeeId: string) {
    return `otp:attempts:${employeeId}`;
  }
  private lockoutKey(employeeId: string) {
    return `otp:lockout:${employeeId}`;
  }

  // randomInt is cryptographically secure; Math.random() is predictable and
  // must never be used for a security code.
  //
  // Note this covers the FULL range 000000-999999 by padding, rather than
  // starting at 100000 — otherwise every code beginning with 0 is impossible
  // and the keyspace shrinks by 10%.
  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private async getEmployee(id: string): Promise<Employee | null> {
    const doc = await this.employees.doc(id).get();
    return doc.exists ? (doc.data() as Employee) : null;
  }

  // --- Issuing ---------------------------------------------------------------
  // Called by a site admin from the mobile app. Returns the digits, which the
  // app turns into a QR code.
  async issueCode(params: {
    issuedByEmployeeId: string;
    targetEmployeeId: string;
    locationId: string;
  }): Promise<{ code: string; expiresInSeconds: number }> {
    const { issuedByEmployeeId, targetEmployeeId, locationId } = params;

    // 1. The issuer must actually be a site admin FOR THIS SITE. Checking the
    //    role alone would let a site admin at one site authorise check-ins at
    //    another.
    const issuer = await this.getEmployee(issuedByEmployeeId);
    if (!issuer) throw new NotFoundException('Issuing employee not found.');
    const isSupervisor = issuer.role === 'siteAdmin' || issuer.role === 'site_supervisor';
    if (!isSupervisor) {
      throw new ForbiddenException(
        'Only a site admin or supervisor can issue check-in codes.',
      );
    }
    if (!issuer.assignedLocationIds?.includes(locationId)) {
      throw new ForbiddenException(
        'You are not a site admin or supervisor for this location.',
      );
    }

    // 2. The target must be a real, active employee of that site.
    const target = await this.getEmployee(targetEmployeeId);
    if (!target) throw new NotFoundException('Employee not found.');
    if (target.status !== 'active') {
      throw new ForbiddenException('This employee account is disabled.');
    }
    // An employee with no assigned sites is allowed anywhere (same rule the
    // geofence check uses); one with assignments must be assigned to this site.
    if (
      target.assignedLocationIds?.length &&
      !target.assignedLocationIds.includes(locationId)
    ) {
      throw new ForbiddenException(
        'This employee is not assigned to this location.',
      );
    }

    // 3. Store it. Issuing again simply overwrites the previous code, so a site
    //    admin can re-generate freely if a scan fails.
    const code = this.generateCode();
    const payload: StoredCode = {
      code,
      locationId,
      issuedBy: issuedByEmployeeId,
      issuedAt: new Date().toISOString(),
    };

    const stored = await this.redis.set(
      this.codeKey(targetEmployeeId),
      JSON.stringify(payload),
      this.CODE_TTL_SECONDS,
    );
    // Without this check a Redis outage would hand back a code that can never
    // be verified, and the site admin would have no idea why scanning fails.
    if (!stored) {
      throw new ServiceUnavailableException(
        'Cannot issue a code right now. Please try again.',
      );
    }

    // Fresh code, fresh allowance of attempts.
    await this.redis.del(this.attemptsKey(targetEmployeeId));

    return { code, expiresInSeconds: this.CODE_TTL_SECONDS };
  }

  // --- Verifying -------------------------------------------------------------
  // Called during check-in. employeeId MUST come from the caller's verified
  // token, never from the request body — otherwise anyone could check in as
  // anyone by guessing an id.
  async verifyCode(
    employeeId: string,
    submittedCode: string,
  ): Promise<VerifiedCode> {
    // 1. Locked out from too many wrong guesses?
    const lockedOut = await this.redis.get(this.lockoutKey(employeeId));
    if (lockedOut) {
      const secondsLeft = Math.max(
        await this.redis.ttl(this.lockoutKey(employeeId)),
        0,
      );
      const minutes = Math.floor(secondsLeft / 60);
      throw new HttpException(
        `Too many incorrect codes. Try again in ${minutes} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Is there a live code? A missing key means expired, never issued, or
    //    Redis is down — all of which must reject.
    const raw = await this.redis.get(this.codeKey(employeeId));
    if (!raw) {
      throw new UnauthorizedException(
        'This code has expired. Ask your site admin for a new one.',
      );
    }

    let payload: StoredCode;
    try {
      payload = JSON.parse(raw) as StoredCode;
    } catch {
      // Corrupt entry — drop it rather than letting it block check-ins forever.
      await this.redis.del(this.codeKey(employeeId));
      throw new UnauthorizedException('This code is no longer valid.');
    }

    // 3. Wrong code: count the attempt and lock out at the limit.
    if (payload.code !== submittedCode) {
      const attempts = await this.redis.incr(
        this.attemptsKey(employeeId),
        this.CODE_TTL_SECONDS,
      );

      // null means Redis failed mid-flight; refuse rather than allow unlimited
      // guessing with no counter.
      if (attempts === null || attempts >= this.MAX_VERIFY_ATTEMPTS) {
        await this.redis.set(
          this.lockoutKey(employeeId),
          '1',
          this.LOCKOUT_SECONDS,
        );
        // Burn the code too, so a lockout cannot be waited out and then used.
        await this.redis.del(
          this.codeKey(employeeId),
          this.attemptsKey(employeeId),
        );
        throw new HttpException(
          'Too many incorrect codes. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const remaining = this.MAX_VERIFY_ATTEMPTS - attempts;
      throw new UnauthorizedException(
        `Incorrect code. ${remaining} attempt(s) remaining.`,
      );
    }

    // 4. Correct — consume it. This is the step the original version was
    //    missing: without it the same code keeps working until it expires,
    //    which defeats the whole point of a ONE-time code.
    await this.redis.del(
      this.codeKey(employeeId),
      this.attemptsKey(employeeId),
    );

    return { locationId: payload.locationId, issuedBy: payload.issuedBy };
  }
}
