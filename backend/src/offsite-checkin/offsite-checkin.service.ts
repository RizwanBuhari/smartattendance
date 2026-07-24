import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { OffsiteQrTokenService } from './offsite-qr-token.service';
import type { AuthedEmployee } from '../auth/employee.guard';

@Injectable()
export class OffsiteCheckinService {
  constructor(private readonly qrTokenService: OffsiteQrTokenService) {}

  private readonly db = getFirestore();
  private readonly requestsCollection = this.db.collection('offsite_requests');
  private readonly attendanceCollection = this.db.collection('attendance_ids');
  private readonly locationsCollection = this.db.collection('locations_ids');
  private readonly attendanceMetaCollection = this.db.collection('attendance_UTCM');
  private readonly employeesCollection = this.db.collection('employees_ids');

  /**
   * Create an offsite check-in request.
   */
  async createRequest(employee: AuthedEmployee, body: { worksiteId: string; reason: string }) {
    const { worksiteId, reason } = body;

    // 1. Check employee is active
    if (employee.status !== 'active') {
      throw new ForbiddenException('Account is disabled.');
    }

    // 2. Validate role is site_employee or offsite_employee (backwards compatibility)
    if (employee.role !== 'site_employee' && employee.role !== 'offsite_employee') {
      throw new ForbiddenException('Only site employees can request offsite check-in.');
    }

    // 3. Verify supervisor is assigned
    if (!employee.supervisorId) {
      throw new BadRequestException('No supervisor assigned to your profile.');
    }

    // 4. Verify employee is not already checked in
    const activeAttendance = await this.attendanceCollection
      .where('employeeId', '==', employee.id)
      .where('status', '==', 'checked_in')
      .get();
    if (!activeAttendance.empty) {
      throw new BadRequestException('You are already checked in. Please check out first.');
    }

    // 5. Verify no existing pending or approved requests
    const activeRequests = await this.requestsCollection
      .where('employeeId', '==', employee.id)
      .get();
    const hasActive = activeRequests.docs.some((doc) => {
      const status = doc.data().status;
      return ['pending_approval', 'approved_waiting_qr', 'qr_ready'].includes(status);
    });
    if (hasActive) {
      throw new BadRequestException('You already have an active request pending or approved.');
    }

    // 6. Resolve worksite details
    const locSnap = await this.locationsCollection.doc(worksiteId).get();
    if (!locSnap.exists || !locSnap.data()) {
      throw new NotFoundException('Assigned worksite not found.');
    }
    const locData = locSnap.data()!;

    // Resolve supervisor authUid for client streams query mapping
    const supervisorSnap = await this.employeesCollection.doc(employee.supervisorId).get();
    const supervisorData = supervisorSnap.data() as any;
    const supervisorUid = supervisorData?.authUid || null;

    // 7. Write request doc
    const requestData = {
      companyId: employee.photoBase64 ? 'default_company' : 'default_company', // Fallback context
      employeeId: employee.id,
      employeeUid: employee.authUid || null,
      employeeName: employee.name,
      employeeRole: employee.role,
      supervisorId: employee.supervisorId,
      supervisorUid,
      supervisorName: employee.supervisorName || 'Supervisor',
      worksiteId,
      worksiteName: locData.name || 'Offsite Worksite',
      status: 'pending_approval',
      reason: reason || '',
      requestedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ref = await this.requestsCollection.add(requestData);
    return { id: ref.id, ...requestData };
  }

  /**
   * Cancel a pending request.
   */
  async cancelRequest(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    
    const data = snap.data()!;
    if (data.employeeId !== employee.id) {
      throw new ForbiddenException('You do not own this request.');
    }
    if (data.status !== 'pending_approval') {
      throw new BadRequestException(`Cannot cancel request in status: ${data.status}`);
    }

    await docRef.update({
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });

    return { id: requestId, status: 'cancelled' };
  }

  /**
   * Fetch active requests for the logged-in employee.
   */
  async getMyRequests(employee: AuthedEmployee) {
    const snap = await this.requestsCollection
      .where('employeeId', '==', employee.id)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  /**
   * Fetch a single request detail.
   */
  async getRequest(id: string) {
    const snap = await this.requestsCollection.doc(id).get();
    if (!snap.exists) throw new NotFoundException('Request not found.');
    return { id: snap.id, ...snap.data() };
  }

  /**
   * Fetch pending/handled requests for the supervisor.
   */
  async getSupervisorRequests(employee: AuthedEmployee) {
    if (employee.role !== 'siteAdmin') {
      throw new ForbiddenException('Only supervisors can view approvals.');
    }

    const snap = await this.requestsCollection
      .where('supervisorId', '==', employee.id)
      .get();
    
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  /**
   * Supervisor accepts offsite request.
   */
  async acceptRequest(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    
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
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Request token generation through the clean service interface
    await this.qrTokenService.requestQrGeneration(requestId);

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }

  /**
   * Supervisor rejects offsite request.
   */
  async rejectRequest(employee: AuthedEmployee, requestId: string, reason: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    
    const data = snap.data()!;
    if (data.supervisorId !== employee.id) {
      throw new ForbiddenException('This request is not assigned to you.');
    }
    // Rejectable any time before the employee has actually scanned — including
    // while waiting on the QR integration, or while a live QR is showing (the
    // supervisor may need to close it out early, e.g. the employee never shows).
    const rejectableStatuses = [
      'pending_approval',
      'approved_waiting_qr',
      'qr_ready',
      'qr_expired',
    ];
    if (!rejectableStatuses.includes(data.status)) {
      throw new BadRequestException('Request cannot be rejected in this state.');
    }

    await docRef.update({
      status: 'rejected',
      rejectedBy: employee.name,
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason || 'Rejected by supervisor',
      updatedAt: new Date().toISOString(),
    });

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }

  /**
   * Verify the employee's scanned QR.
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
    const { requestId, scannedPayload, latitude, longitude, gpsAccuracy, deviceId } = body;

    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    const data = snap.data()!;

    // 1. Enforce ownership: only the requesting employee can scan
    if (data.employeeId !== employee.id) {
      throw new ForbiddenException('This QR code was not issued for your account.');
    }

    // 2. Delegate secure verification logic to OffsiteQrTokenService
    const verification = await this.qrTokenService.verifyScannedQr(requestId, scannedPayload, {
      latitude,
      longitude,
      deviceId,
    });

    if (!verification.isValid) {
      throw new BadRequestException(verification.message || 'Invalid QR code.');
    }

    // 3. Mark request as scanned, then complete it. Written as two updates
    // (rather than jumping straight to 'completed') so a supervisor watching
    // the request in realtime sees the full qr_ready -> qr_scanned -> completed
    // sequence rather than a silent jump.
    await docRef.update({ status: 'qr_scanned', updatedAt: new Date().toISOString() });

    const checkInUtc = new Date().toISOString();

    // Save attendance atomically
    const attendanceRecord = {
      employeeId: employee.id,
      employeeName: employee.name,
      attendanceType: 'offsite',
      checkInMethod: 'supervisor_qr',
      supervisorId: data.supervisorId,
      worksiteId: data.worksiteId,
      worksiteName: data.worksiteName,
      offsiteRequestId: requestId,
      checkInUtc,
      checkOutUtc: null,
      tzOffsetMinutes: 240, // default Dubai offset
      checkInCoordinates: { lat: latitude, lng: longitude },
      checkOutCoords: null,
      gpsAccuracy: gpsAccuracy || null,
      deviceId: deviceId || null,
      status: 'checked_in',
      approvedBy: data.supervisorName,
      approvedAt: data.approvedAt || checkInUtc,
    };

    const attendanceRef = await this.attendanceCollection.add(attendanceRecord);

    await docRef.update({
      status: 'completed',
      qrUsedAt: checkInUtc,
      completedAt: checkInUtc,
      attendanceId: attendanceRef.id,
      updatedAt: checkInUtc,
    });

    // Write metadata for local time tracking compatibility
    await this.attendanceMetaCollection.doc(attendanceRef.id).set({
      employeeId: employee.id,
      checkInUtc,
      checkInUtcMs: Date.parse(checkInUtc),
    });

    return {
      accepted: true,
      attendanceId: attendanceRef.id,
      message: 'Checked In Successfully!',
      ...attendanceRecord,
    };
  }

  /**
   * Supervisor regenerates QR code.
   */
  async regenerateQr(employee: AuthedEmployee, requestId: string) {
    const docRef = this.requestsCollection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    
    const data = snap.data()!;
    if (data.supervisorId !== employee.id) {
      throw new ForbiddenException('This request is not assigned to you.');
    }
    if (!['approved_waiting_qr', 'qr_ready', 'qr_expired'].includes(data.status)) {
      throw new BadRequestException('Request is in an invalid state for regeneration.');
    }

    await this.qrTokenService.regenerateQr(requestId);

    const updated = await docRef.get();
    return { id: requestId, ...updated.data() };
  }
}
