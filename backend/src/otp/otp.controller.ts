// Routes for one-time check-in codes.
//
//   POST /otp/issue    -> a SITE ADMIN issues a code for one employee.
//                         The mobile app renders the returned digits as a QR.
//   GET  /otp/team     -> the employees a site admin may issue codes for,
//                         so the app can show a list to pick from.
//
// Both require a Firebase ID token (EmployeeGuard). Crucially, the ISSUER is
// taken from that token — never from the request body — otherwise any caller
// could claim to be a site admin by typing someone else's id.
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { OtpService } from './otp.service';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { Employee } from '../employees/employees.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@UseGuards(EmployeeGuard)
@Controller('otp')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  private readonly employees = getFirestore().collection('employees_ids');
  private readonly attendance = getFirestore().collection('attendance_ids');
  private readonly locations = getFirestore().collection('locations_ids');
  // One doc per employee holding the id of their CURRENTLY active session.
  private readonly sessions = getFirestore().collection('employee_Sessions');

  // Everything the site admin's tab needs in one call: their site(s), the staff
  // assigned to those sites, and who is currently checked in.
  //
  // The employee list is derived from the CALLER'S OWN assignedLocationIds, so
  // a site admin can only ever see staff from their own site — the client never
  // gets to ask for a different location.
  @Get('team')
  async team(@Req() req: AuthedRequest) {
    const me = req.employee;
    if (me.role !== 'siteAdmin') {
      return { isSiteAdmin: false, locationIds: [], employees: [] };
    }

    const locationIds = me.assignedLocationIds ?? [];
    if (locationIds.length === 0) {
      return { isSiteAdmin: true, locationIds: [], employees: [] };
    }

    // array-contains-any is capped at 30 values by Firestore; a site admin
    // covering more sites than that would need chunking.
    const [staffSnap, openSnap] = await Promise.all([
      this.employees
        .where(
          'assignedLocationIds',
          'array-contains-any',
          locationIds.slice(0, 30),
        )
        .get(),
      // Open sessions across the whole company; filtered to this site's staff
      // below. An attendance record stays 'checked_in' until it is closed.
      this.attendance.where('status', '==', 'checked_in').get(),
    ]);

    const checkedInIds = new Set(
      openSnap.docs.map((d) => (d.data() as { employeeId: string }).employeeId),
    );

    const employees = staffSnap.docs
      .map((d) => ({ ...(d.data() as Employee), id: d.id }))
      .filter((e) => e.status === 'active' && e.id !== me.id)
      .map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        isCheckedIn: checkedInIds.has(e.id),
      }))
      // Not yet checked in first — those are the ones needing a code.
      .sort((a, b) => {
        if (a.isCheckedIn !== b.isCheckedIn) return a.isCheckedIn ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    // Site names, so the dashboard can title itself without a second call.
    const locationDocs = await Promise.all(
      locationIds.slice(0, 30).map((id) => this.locations.doc(id).get()),
    );
    const sites = locationDocs
      .filter((d) => d.exists)
      .map((d) => ({
        id: d.id,
        name: (d.data() as { name?: string }).name ?? d.id,
        type: (d.data() as { type?: string }).type ?? 'office',
      }));

    // Today's activity, restricted to THIS site admin's locations. Firestore
    // caps an 'in' filter at 30 values, matching the slice above.
    const todaySnap = await this.attendance
      .where('locationId', 'in', locationIds.slice(0, 30))
      .get();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaysRecords = todaySnap.docs
      .map((d) => d.data() as Record<string, unknown>)
      .filter((r) => {
        const at = Date.parse(String(r.checkInUtc ?? ''));
        return !Number.isNaN(at) && at >= startOfToday.getTime();
      });

    const checkedInNow = employees.filter((e) => e.isCheckedIn).length;

    const recentActivity = todaysRecords
      .map((r) => ({
        employeeName: String(r.employeeName ?? ''),
        locationName: String(r.locationName ?? ''),
        status: String(r.status ?? ''),
        // The most recent thing that happened on this record.
        at: String(r.checkOutUtc ?? r.checkInUtc ?? ''),
        action: r.checkOutUtc ? 'checked out' : 'checked in',
      }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);

    return {
      isSiteAdmin: true,
      locationIds,
      sites,
      employees,
      stats: {
        totalEmployees: employees.length,
        checkedIn: checkedInNow,
        checkedOut: employees.length - checkedInNow,
        checkInsToday: todaysRecords.filter((r) => r.status !== 'rejected')
          .length,
        rejectedToday: todaysRecords.filter((r) => r.status === 'rejected')
          .length,
      },
      recentActivity,
    };
  }

  // Claims the single active session for this employee, mirroring what the
  // dashboard already does for admins (AdminsService.claimSession).
  //
  // Signing in mints a fresh sessionId and overwrites the stored one. Any other
  // device still holding the previous id sees the mismatch through its Firestore
  // listener and signs itself out — one account, one device.
  @Post('session')
  async claimSession(@Req() req: AuthedRequest) {
    const sessionId = randomUUID();
    await this.sessions.doc(req.employee.id).set({
      sessionId,
      employeeId: req.employee.id,
      name: req.employee.name,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, sessionId };
  }

  @Post('issue')
  issue(
    @Req() req: AuthedRequest,
    @Body() body: { targetEmployeeId: string; locationId: string },
  ) {
    return this.otpService.issueCode({
      // From the verified token — this is what makes the role check meaningful.
      issuedByEmployeeId: req.employee.id,
      targetEmployeeId: body.targetEmployeeId,
      locationId: body.locationId,
    });
  }
}
