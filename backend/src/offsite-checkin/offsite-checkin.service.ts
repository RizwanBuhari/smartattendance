import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { OffsiteQrTokenService } from './offsite-qr-token.service';
import type { AuthedEmployee } from '../auth/employee.guard';
import { normalizeRole } from '../employees/employees.service';
import { PushService } from '../push/push.service';

@Injectable()
export class OffsiteCheckinService {
  constructor(
    private readonly qrTokenService: OffsiteQrTokenService,
    private readonly pushService: PushService,
  ) {}

  private readonly db = getFirestore();
  private readonly requestsCollection = this.db.collection('offsite_requests');
  private readonly attendanceCollection = this.db.collection('attendance_ids');
  private readonly locationsCollection = this.db.collection('locations_ids');
  private readonly attendanceMetaCollection =
    this.db.collection('attendance_UTCM');
  private readonly employeesCollection = this.db.collection('employees_ids');

  // Attendance records are keyed by the employee's Firebase UID (authUid) when
  // self-registered, but by the employees_ids doc id for an admin-created
  // account — the same "isMine" split used elsewhere. Look up an OPEN session by
  // BOTH keys: querying by the doc id alone (as this service used to) never
  // matched a record written under the UID, so an offsite employee was wrongly
  // told "no active check-in" and could not check out.
  private async openAttendanceSnap(employee: AuthedEmployee) {
    const keys = [employee.authUid, employee.id].filter(Boolean);
    return this.attendanceCollection
      .where('employeeId', 'in', keys)
      .where('status', '==', 'checked_in')
      .get();
  }

  /**
   * Create an offsite check-in request.
   */
  async createRequest(
    employee: AuthedEmployee,
    body: { worksiteId: string; reason?: string },
  ) {
    const { worksiteId, reason } = body;

    if (employee.status !== 'active') {
      throw new ForbiddenException('Account is disabled.');
    }

    const role = normalizeRole(employee.role);
    if (role !== 'site_employee') {
      throw new ForbiddenException(
        'Only site employees can request offsite check-in.',
      );
    }

    if (!employee.supervisorId) {
      throw new BadRequestException('No supervisor assigned to your profile.');
    }

    const activeAttendance = await this.openAttendanceSnap(employee);
    if (!activeAttendance.empty) {
      throw new BadRequestException(
        'You are already checked in. Please check out first.',
      );
    }

    const activeRequests = await this.requestsCollection
      .where('employeeId', '==', employee.id)
      .get();
    const hasActiveCheckIn = activeRequests.docs.some((doc) => {
      const d = doc.data();
      const type = d.requestType || 'check_in';
      const status = d.status;
      return (
        type === 'check_in' &&
        ['pending_approval', 'approved_waiting_qr', 'qr_ready'].includes(status)
      );
    });
    if (hasActiveCheckIn) {
      throw new BadRequestException(
        'You already have an active check-in request pending or approved.',
      );
    }

    let locSnap = worksiteId ? await this.locationsCollection.doc(worksiteId).get() : null;
    if (!locSnap || !locSnap.exists || !locSnap.data()) {
      const queryByName = await this.locationsCollection
        .where('name', '==', worksiteId)
        .limit(1)
        .get();
      if (!queryByName.empty) {
        locSnap = queryByName.docs[0];
      } else {
        const firstLocId = employee.assignedLocationIds?.[0];
        if (firstLocId) {
          locSnap = await this.locationsCollection.doc(firstLocId).get();
        }
      }
    }

    if (!locSnap || !locSnap.exists || !locSnap.data()) {
      const anyLoc = await this.locationsCollection.limit(1).get();
      if (!anyLoc.empty) {
        locSnap = anyLoc.docs[0];
      }
    }

    const locData = locSnap && locSnap.exists ? locSnap.data()! : null;
    const finalWorksiteId = locSnap && locSnap.exists ? locSnap.id : (worksiteId || 'default_worksite');
    const worksiteName = locData?.name || worksiteId || 'Assigned Worksite';

    let supervisorSnap = employee.supervisorId 
      ? await this.employeesCollection.doc(employee.supervisorId).get() 
      : null;

    if (!supervisorSnap || !supervisorSnap.exists || !supervisorSnap.data()) {
      if (employee.supervisorId) {
        const queryByAuth = await this.employeesCollection
          .where('authUid', '==', employee.supervisorId)
          .limit(1)
          .get();
        if (!queryByAuth.empty) {
          supervisorSnap = queryByAuth.docs[0];
        }
      }
    }

    if (!supervisorSnap || !supervisorSnap.exists || !supervisorSnap.data()) {
      const queryByRole = await this.employeesCollection
        .where('role', '==', 'site_supervisor')
        .limit(1)
        .get();
      if (!queryByRole.empty) {
        supervisorSnap = queryByRole.docs[0];
      }
    }

    const supervisorData = supervisorSnap && supervisorSnap.exists ? (supervisorSnap.data() as any) : null;
    const supervisorUid = supervisorData?.authUid || null;
    const supervisorId = supervisorSnap && supervisorSnap.exists ? supervisorSnap.id : (employee.supervisorId || 'default_supervisor');
    const supervisorName = employee.supervisorName || supervisorData?.name || (supervisorData ? `${supervisorData.firstName || ''} ${supervisorData.lastName || ''}`.trim() : 'Site Supervisor');

    const requestData = {
      companyId: employee.companyId || 'default_company',
      employeeId: employee.id,
      employeeUid: employee.authUid || null,
      employeeName: employee.name,
      employeeRole: role,
      supervisorId,
      supervisorUid,
      supervisorName,
      worksiteId: finalWorksiteId,
      worksiteName,
      requestType: 'check_in' as const,
      status: 'pending_approval',
      reason: reason || '',
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await this.requestsCollection.add(requestData);
    const saved = await ref.get();

    const supervisorRecipients = [employee.supervisorId, supervisorUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(supervisorRecipients, {
      title: 'New Offsite Request Received',
      body: `${employee.name} has requested offsite check-in for ${worksiteName}.`,
      data: { type: 'offsite_request_created', requestId: ref.id },
    });

    return { id: ref.id, ...saved.data() };
  }

  /**
   * Create an offsite check-out request.
   */
  async createCheckoutRequest(
    employee: AuthedEmployee,
    body: { worksiteId?: string; reason?: string },
  ) {
    if (employee.status !== 'active') {
      throw new ForbiddenException('Account is disabled.');
    }

    const role = normalizeRole(employee.role);
    if (role !== 'site_employee') {
      throw new ForbiddenException(
        'Only site employees can request offsite checkout.',
      );
    }

    if (!employee.supervisorId) {
      throw new BadRequestException('No supervisor assigned to your profile.');
    }

    const activeAttendanceSnap = await this.openAttendanceSnap(employee);
    if (activeAttendanceSnap.empty) {
      throw new BadRequestException(
        'No active check-in found to check out from.',
      );
    }
    const activeAttendanceDoc = activeAttendanceSnap.docs[0];
    const activeAttendance = activeAttendanceDoc.data();

    const activeRequests = await this.requestsCollection
      .where('employeeId', '==', employee.id)
      .get();
    const hasActiveCheckout = activeRequests.docs.some((doc) => {
      const d = doc.data();
      const type = d.requestType || 'check_in';
      const status = d.status;
      return (
        type === 'check_out' &&
        ['pending_approval', 'approved_waiting_qr', 'qr_ready'].includes(status)
      );
    });
    if (hasActiveCheckout) {
      throw new BadRequestException(
        'You already have an active checkout request pending or approved.',
      );
    }

    const worksiteId = body.worksiteId || activeAttendance.worksiteId;
    const locSnap = await this.locationsCollection.doc(worksiteId).get();
    const worksiteName = locSnap.exists
      ? locSnap.data()?.name || activeAttendance.worksiteName
      : activeAttendance.worksiteName || 'Offsite Worksite';

    const supervisorSnap = await this.employeesCollection
      .doc(employee.supervisorId)
      .get();
    const supervisorData = supervisorSnap.data() as any;
    const supervisorUid = supervisorData?.authUid || null;

    const requestData = {
      companyId: employee.companyId || 'default_company',
      employeeId: employee.id,
      employeeUid: employee.authUid || null,
      employeeName: employee.name,
      employeeRole: role,
      supervisorId: employee.supervisorId,
      supervisorUid,
      supervisorName:
        employee.supervisorName || supervisorData?.name || 'Supervisor',
      worksiteId,
      worksiteName,
      attendanceId: activeAttendanceDoc.id,
      requestType: 'check_out' as const,
      status: 'pending_approval',
      reason: body.reason || '',
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await this.requestsCollection.add(requestData);
    const saved = await ref.get();

    const supervisorRecipients = [employee.supervisorId, supervisorUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(supervisorRecipients, {
      title: 'New Offsite Checkout Request Received',
      body: `${employee.name} has requested offsite checkout for ${worksiteName}.`,
      data: { type: 'offsite_checkout_request_created', requestId: ref.id },
    });

    return { id: ref.id, ...saved.data() };
  }

  async cancelRequest(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data())
      throw new NotFoundException('Request not found.');

    const data = snap.data()!;
    if (data.employeeId !== employee.id) {
      throw new ForbiddenException('You do not own this request.');
    }
    if (data.status !== 'pending_approval') {
      throw new BadRequestException(
        `Cannot cancel request in status: ${data.status}`,
      );
    }

    await docRef.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const supervisorRecipients = [data.supervisorId, data.supervisorUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(supervisorRecipients, {
      title: 'Request Cancelled by Employee',
      body: `${employee.name} cancelled the offsite ${data.requestType === 'check_out' ? 'check-out' : 'check-in'} request.`,
      data: { type: 'offsite_request_cancelled', requestId: requestId },
    });

    return { id: requestId, status: 'cancelled' };
  }

  async getMyRequests(employee: AuthedEmployee) {
    const snap = await this.requestsCollection
      .where('employeeId', '==', employee.id)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getRequest(id: string) {
    const snap = await this.requestsCollection.doc(id).get();
    if (!snap.exists) throw new NotFoundException('Request not found.');
    return { id: snap.id, ...snap.data() };
  }

  async getSupervisorRequests(employee: AuthedEmployee) {
    const role = normalizeRole(employee.role);
    if (role !== 'site_supervisor') {
      throw new ForbiddenException('Only site supervisors can view approvals.');
    }

    const snap = await this.requestsCollection
      .where('supervisorId', '==', employee.id)
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  /**
   * Supervisor accepts request. Sets status to approved_waiting_qr.
   * Does NOT auto-generate OTP until Show QR Code is tapped or generateQr is invoked.
   */
  async acceptRequest(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data())
      throw new NotFoundException('Request not found.');

    const data = snap.data()!;
    if (data.supervisorId !== employee.id) {
      throw new ForbiddenException('This request is not assigned to you.');
    }
    if (data.status !== 'pending_approval') {
      throw new BadRequestException('Request has already been handled.');
    }

    await docRef.update({
      status: 'approved_waiting_qr',
      approvedBy: employee.name,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const isCheckout = data.requestType === 'check_out';
    const employeeRecipients = [data.employeeId, data.employeeUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(employeeRecipients, {
      title: isCheckout
        ? 'Offsite Checkout Request Approved'
        : 'Offsite Request Approved',
      body: isCheckout
        ? `Your checkout request for ${data.worksiteName} was approved. Ready to scan the checkout QR code.`
        : `Your offsite request for ${data.worksiteName} was approved. Ready to scan QR code.`,
      data: { type: 'offsite_request_approved', requestId },
    });

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }

  /**
   * Generate QR Code for an approved request when requested by the supervisor.
   */
  async generateQr(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data())
      throw new NotFoundException('Request not found.');

    const data = snap.data()!;
    if (data.supervisorId !== employee.id) {
      throw new ForbiddenException('This request is not assigned to you.');
    }
    if (
      !['approved_waiting_qr', 'qr_ready', 'qr_expired'].includes(data.status)
    ) {
      throw new BadRequestException(
        `Cannot generate QR code for request in status: ${data.status}`,
      );
    }

    await this.qrTokenService.requestQrGeneration(requestId);

    const employeeRecipients = [data.employeeId, data.employeeUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(employeeRecipients, {
      title: 'QR Code Regenerated',
      body: 'A new QR code is ready. Please scan it from your supervisor’s device.',
      data: { type: 'qr_regenerated', requestId },
    });

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }

  async rejectRequest(
    employee: AuthedEmployee,
    requestId: string,
    reason: string,
  ) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data())
      throw new NotFoundException('Request not found.');

    const data = snap.data()!;
    if (data.supervisorId !== employee.id) {
      throw new ForbiddenException('This request is not assigned to you.');
    }
    const rejectableStatuses = [
      'pending_approval',
      'approved_waiting_qr',
      'qr_ready',
      'qr_expired',
    ];
    if (!rejectableStatuses.includes(data.status)) {
      throw new BadRequestException(
        'Request cannot be rejected in this state.',
      );
    }

    await docRef.update({
      status: 'rejected',
      rejectedBy: employee.name,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectionReason: reason || 'Rejected by supervisor',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const isCheckout = data.requestType === 'check_out';
    const employeeRecipients = [data.employeeId, data.employeeUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(employeeRecipients, {
      title: isCheckout
        ? 'Offsite Checkout Request Rejected'
        : 'Offsite Request Rejected',
      body: isCheckout
        ? `Your checkout request was rejected. You are still checked in. (Reason: ${reason || 'Rejected by supervisor'})`
        : `Your offsite request for ${data.worksiteName} was rejected. (Reason: ${reason || 'Rejected by supervisor'})`,
      data: { type: 'offsite_request_rejected', requestId },
    });

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }

  /**
   * Verify scanned QR payload and handle check-in or checkout attendance atomically.
   */
  async verifyScannedQr(
    employee: AuthedEmployee,
    body: {
      requestId: string;
      scannedPayload: string;
      latitude: number;
      longitude: number;
      gpsAccuracy?: number;
      deviceId?: string;
    },
  ) {
    const {
      requestId,
      scannedPayload,
      latitude,
      longitude,
      gpsAccuracy,
      deviceId,
    } = body;

    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data())
      throw new NotFoundException('Request not found.');
    const data = snap.data()!;

    if (data.employeeId !== employee.id) {
      throw new ForbiddenException(
        'This QR code was not issued for your account.',
      );
    }

    const requestType: 'check_in' | 'check_out' =
      data.requestType || 'check_in';

    const verification = await this.qrTokenService.verifyScannedQr(
      requestId,
      scannedPayload,
      {
        latitude,
        longitude,
        deviceId,
        expectedRequestType: requestType,
      },
    );

    if (!verification.isValid) {
      throw new BadRequestException(verification.message || 'Invalid QR code.');
    }

    await docRef.update({
      status: 'qr_scanned',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const checkTimeUtc = new Date().toISOString();

    if (requestType === 'check_in') {
      const activeAttendance = await this.openAttendanceSnap(employee);
      if (!activeAttendance.empty) {
        throw new BadRequestException('You are already checked in.');
      }

      const attendanceRecord = {
        employeeId: employee.authUid || employee.id,
        employeeDocId: employee.id,
        employeeName: employee.name,
        attendanceType: 'offsite',
        checkInMethod: 'supervisor_qr',
        supervisorId: data.supervisorId,
        worksiteId: data.worksiteId,
        worksiteName: data.worksiteName,
        offsiteCheckInRequestId: requestId,
        checkInUtc: checkTimeUtc,
        checkOutUtc: null,
        tzOffsetMinutes: 240,
        checkInCoordinates: { lat: latitude, lng: longitude },
        checkOutCoords: null,
        gpsAccuracy: gpsAccuracy || null,
        deviceId: deviceId || null,
        status: 'checked_in',
        approvedBy: data.supervisorName,
        approvedAt: data.approvedAt || checkTimeUtc,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const attendanceRef =
        await this.attendanceCollection.add(attendanceRecord);

      await docRef.update({
        status: 'completed',
        qrUsedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
        attendanceId: attendanceRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await this.attendanceMetaCollection.doc(attendanceRef.id).set({
        employeeId: employee.id,
        checkInUtc: checkTimeUtc,
        checkInUtcMs: Date.parse(checkTimeUtc),
      });

      const supervisorRecipients = [
        data.supervisorId,
        data.supervisorUid,
      ].filter(Boolean) as string[];
      await this.pushService.sendToEmployees(supervisorRecipients, {
        title: 'Employee Check-in Completed',
        body: `${employee.name} successfully checked in at ${data.worksiteName}.`,
        data: {
          type: 'employee_checkin_completed',
          attendanceId: attendanceRef.id,
        },
      });

      return {
        accepted: true,
        requestType: 'check_in',
        attendanceId: attendanceRef.id,
        message: 'Checked In Successfully!',
        ...attendanceRecord,
      };
    } else {
      // Checkout request handling: update existing attendance record atomically
      const attendanceId = data.attendanceId;
      if (!attendanceId) {
        throw new BadRequestException(
          'Missing linked active attendance record for checkout.',
        );
      }

      const attendanceRef = this.attendanceCollection.doc(attendanceId);
      const attSnap = await attendanceRef.get();
      if (!attSnap.exists || !attSnap.data()) {
        throw new NotFoundException('Active attendance record not found.');
      }
      const attData = attSnap.data()!;
      if (attData.status !== 'checked_in') {
        throw new BadRequestException(
          'Attendance record is not in checked_in status.',
        );
      }

      await attendanceRef.update({
        status: 'checked_out',
        checkOutUtc: checkTimeUtc,
        checkOutCoordinates: { lat: latitude, lng: longitude },
        checkOutMethod: 'supervisor_qr',
        offsiteCheckoutRequestId: requestId,
        checkOutAccuracy: gpsAccuracy || null,
        checkoutSupervisorId: data.supervisorId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await docRef.update({
        status: 'completed',
        qrUsedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const supervisorRecipients = [
        data.supervisorId,
        data.supervisorUid,
      ].filter(Boolean) as string[];
      await this.pushService.sendToEmployees(supervisorRecipients, {
        title: 'Employee Checkout Completed',
        body: `${employee.name} successfully checked out from ${data.worksiteName}.`,
        data: {
          type: 'employee_checkout_completed',
          attendanceId: attendanceRef.id,
        },
      });

      return {
        accepted: true,
        requestType: 'check_out',
        attendanceId: attendanceRef.id,
        message: 'Checked Out Successfully!',
        status: 'checked_out',
      };
    }
  }

  async regenerateQr(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data())
      throw new NotFoundException('Request not found.');

    const data = snap.data()!;
    if (data.supervisorId !== employee.id) {
      throw new ForbiddenException('This request is not assigned to you.');
    }
    if (
      !['approved_waiting_qr', 'qr_ready', 'qr_expired'].includes(data.status)
    ) {
      throw new BadRequestException(
        'Request is in an invalid state for regeneration.',
      );
    }

    await this.qrTokenService.regenerateQr(requestId, employee.name);

    const employeeRecipients = [data.employeeId, data.employeeUid].filter(
      Boolean,
    ) as string[];
    await this.pushService.sendToEmployees(employeeRecipients, {
      title: 'QR Code Regenerated',
      body: 'A new QR code is ready. Please scan it from your supervisor’s device.',
      data: { type: 'qr_regenerated', requestId },
    });

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }
}
