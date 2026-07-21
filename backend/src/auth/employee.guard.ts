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
import type { Employee } from '../employees/employees.service';

// What the guard puts on the request for handlers to use.
export interface AuthedEmployee extends Employee {
  id: string;
  // Required here even though it is optional on Employee: this record was found
  // BY its authUid, so it always has one. Handlers key attendance and geofence
  // records off this, and an `undefined` slipping through would widen a
  // "just mine" query into "everyone's" — so the type has to rule it out.
  authUid: string;
}

// Sent back to the app when another device has taken this account over. The
// app watches for this exact code to sign itself out — a plain 401 could just
// mean an expired token, which is recoverable and must NOT log anyone out.
export const SESSION_SUPERSEDED = 'session-superseded';

@Injectable()
export class EmployeeGuard implements CanActivate {
  private readonly employees = getFirestore().collection('employees_ids');
  private readonly sessions = getFirestore().collection('employee_Sessions');

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

    // The Firebase account is real, but it still has to map to an employee
    // record — a signed-in user who was never registered is not an employee.
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
    // authUid comes from the VERIFIED token rather than the stored field, so
    // it is guaranteed present and guaranteed to be the caller's.
    const employee = { ...(doc.data() as Employee), id: doc.id, authUid: uid };

    // A valid token outlives a disabled account (up to an hour), so status has
    // to be re-checked here on every request rather than trusted from sign-in.
    if (employee.status !== 'active') {
      throw new ForbiddenException('This account has been disabled.');
    }

    await this.requireCurrentSession(employee.id, request.headers);

    request.employee = employee;
    return true;
  }

  // "One account, one device", enforced server-side.
  //
  // The id was minted at sign-in and handed only to the device that signed in,
  // so a device evicted by a later sign-in is holding a stale one and cannot
  // discover the new one. Sending nothing fails too — this is a positive check,
  // not a blacklist.
  //
  // A MISSING session document is treated as valid on purpose: it means nobody
  // has signed in since this was deployed, and failing closed there would lock
  // out every already-signed-in user at once.
  private async requireCurrentSession(
    employeeId: string,
    headers: Record<string, string | undefined>,
  ) {
    const snap = await this.sessions.doc(employeeId).get();
    if (!snap.exists) return;

    const active = (snap.data() as { sessionId?: string } | undefined)
      ?.sessionId;
    if (!active) return;

    const presented = headers['x-session-id'];
    if (presented !== active) {
      throw new UnauthorizedException({
        code: SESSION_SUPERSEDED,
        message:
          'You have been signed out because this account was used on another device.',
      });
    }
  }
}
