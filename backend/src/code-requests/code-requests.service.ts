// "An employee is standing at the gate waiting for you to approve their
// check-in."
//
// This record did not exist before, which is why a site admin never found out.
// A check-in at a site that needs approval returned `codeRequired: true` and
// returned EARLY — writing nothing at all — so the employee's phone opened the
// scanner and waited on an intention that lived only on that device. There was
// nothing for the site admin's screen to watch and nothing to notify them
// about.
//
// One document per employee ("code_Requests/{employeeDocId}"), so a person
// tapping check-in five times produces one request rather than five.
import { Injectable, Logger } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { PushService } from '../push/push.service';
import type { Employee } from '../employees/employees.service';
import { APPROVER_ROLES } from '../employees/employees.service';

// After this long an unanswered request is treated as abandoned — the employee
// gave up and walked away. Keeps stale rows off the site admin's screen without
// needing a scheduled cleanup job.
export const REQUEST_TTL_MINUTES = 15;

// How long before tapping check-in again will ring the site admin's phone a
// second time. Short enough that a missed first push is recoverable by simply
// trying again, long enough that an impatient triple-tap is one notification.
const RENOTIFY_SECONDS = 90;

export interface CodeRequest {
  employeeId: string;
  employeeName: string;
  locationId: string;
  locationName: string;
  requestedAt: string;
  // Set once the site admin generates a code, so the row can show "code sent"
  // while the employee is still scanning it.
  issuedAt?: string;
  // When a push was last sent about this request — the throttle, kept separate
  // from requestedAt so re-tapping can ring again.
  notifiedAt?: string;
}

@Injectable()
export class CodeRequestsService {
  private readonly logger = new Logger(CodeRequestsService.name);
  private readonly db = getFirestore();
  private readonly requests = this.db.collection('code_Requests');
  private readonly employees = this.db.collection('employees_ids');

  constructor(private readonly push: PushService) {}

  // Called from the check-in flow the moment a code turns out to be required.
  async open(params: {
    employeeId: string;
    employeeName: string;
    locationId: string;
    locationName: string;
  }) {
    const { employeeId, employeeName, locationId, locationName } = params;

    const existing = await this.requests.doc(employeeId).get();
    const previous = existing.data() as CodeRequest | undefined;

    // Throttle on when we last NOTIFIED, not on when the request was opened.
    //
    // Keying this off requestedAt (and the 15-minute request lifetime) meant
    // that once a request existed, every later tap was silent for a quarter of
    // an hour — so if the first push was missed, nothing the employee did could
    // produce another one. Tapping again is exactly how someone signals "I am
    // still waiting", and it should ring again.
    const notifiedRecently =
      previous?.notifiedAt &&
      secondsSince(previous.notifiedAt) < RENOTIFY_SECONDS;

    const request: CodeRequest = {
      employeeId,
      employeeName,
      locationId,
      locationName,
      requestedAt: new Date().toISOString(),
      // Preserve, so a re-tap does not look like a brand-new request.
      ...(previous?.issuedAt ? { issuedAt: previous.issuedAt } : {}),
      ...(previous?.notifiedAt ? { notifiedAt: previous.notifiedAt } : {}),
    };
    await this.requests.doc(employeeId).set(request);

    if (!notifiedRecently) {
      await this.notifySiteAdmins(request);
      await this.requests
        .doc(employeeId)
        .update({ notifiedAt: new Date().toISOString() })
        .catch(() => {});
    } else {
      this.logger.log(
        `Skipped re-notifying for ${employeeName} — already alerted ${Math.round(secondsSince(previous.notifiedAt!))}s ago.`,
      );
    }
    return request;
  }

  // The employee got in (or gave up) — stop showing them as waiting.
  async close(employeeId: string) {
    await this.requests
      .doc(employeeId)
      .delete()
      .catch(() => {
        // Nothing pending is the normal case for an ordinary office check-in.
      });
  }

  // Marks that a code is on screen, without closing the request: the employee
  // still has to scan it, and the site admin should keep seeing them until
  // they do.
  async markIssued(employeeId: string) {
    await this.requests
      .doc(employeeId)
      .update({ issuedAt: new Date().toISOString() })
      .catch(() => {
        // A site admin may issue a code pre-emptively, with no request open.
      });
  }

  // Every request still waiting at any of these locations, freshest first.
  async pendingForLocations(locationIds: string[]) {
    if (locationIds.length === 0) return [];
    const snapshot = await this.requests
      // Firestore caps `in` at 30 values, matching the team query's own limit.
      .where('locationId', 'in', locationIds.slice(0, 30))
      .get();

    return snapshot.docs
      .map((d) => d.data() as CodeRequest)
      .filter((r) => minutesSince(r.requestedAt) < REQUEST_TTL_MINUTES)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  }

  // Pushes to every site admin responsible for the location the employee is
  // standing at — not to all site admins, and not to the whole company.
  private async notifySiteAdmins(request: CodeRequest) {
    try {
      // APPROVER_ROLES rather than a hard-coded literal: the single source of
      // truth for who may approve, so this stays correct if another approving
      // role is ever added.
      const snapshot = await this.employees
        .where('role', 'in', [...APPROVER_ROLES])
        .where('assignedLocationIds', 'array-contains', request.locationId)
        .get();

      const admins = snapshot.docs.filter(
        (d) => (d.data() as Employee).status === 'active',
      );
      if (admins.length === 0) {
        // Worth a log: the employee is stuck at a site with nobody able to
        // approve them, and no amount of retrying will fix it.
        this.logger.warn(
          `${request.employeeName} needs approval at ${request.locationName}, but that site has no active approver (${APPROVER_ROLES.join(' or ')}).`,
        );
        return;
      }

      this.logger.log(
        `${request.employeeName} needs approval at ${request.locationName}; notifying ${admins.length} site admin(s): ${admins.map((d) => d.id).join(', ')}`,
      );

      await this.push.sendToEmployees(
        admins.map((d) => d.id),
        {
          title: 'Check-in approval needed',
          body: `${request.employeeName} is waiting for a code at ${request.locationName}.`,
          data: {
            type: 'code-request',
            employeeId: request.employeeId,
            locationId: request.locationId,
          },
        },
      );
    } catch (err) {
      // A failed notification must never fail the employee's check-in attempt.
      this.logger.error(`Could not notify site admins: ${String(err)}`);
    }
  }
}

function minutesSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 60000;
}

function secondsSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 1000;
}
