import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { PushService } from '../push/push.service';
import { normalizeRole } from '../employees/employees.service';

const HELP_REASON_LABELS: Record<string, string> = {
  face_not_available: 'Face authentication is not available on their device',
  fingerprint_not_available: 'Fingerprint authentication is not available on their device',
  device_lock_not_configured: 'No device PIN, Pattern or Password is configured',
  authentication_not_supported: 'No supported authentication method is available on their device',
};

@Injectable()
export class BiometricsService {
  constructor(private readonly push: PushService) {}

  private readonly db = getFirestore();
  private readonly employeesCollection = this.db.collection('employees_ids');

  // Challenge cache: nonce -> metadata
  private readonly challengeMap = new Map<
    string,
    { authUid: string; nonce: string; action: string; deviceId?: string; expiresAt: number }
  >();

  private async getEmployeeDoc(authUid: string) {
    const snap = await this.employeesCollection
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snap.empty) {
      throw new NotFoundException('Employee profile not found.');
    }
    return snap.docs[0];
  }

  async createChallenge(authUid: string, action = 'check_in', deviceId?: string) {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 60 * 1000; // 60s expiration (Rule #7)
    this.challengeMap.set(nonce, { authUid, nonce, action, deviceId, expiresAt });
    return { nonce, challengeNonce: nonce, expiresAt: new Date(expiresAt).toISOString() };
  }

  verifyChallenge(authUid: string, nonce?: string, action = 'check_in', deviceId?: string): boolean {
    if (!nonce) return true; // Optional for backwards compatibility
    const item = this.challengeMap.get(nonce);
    if (!item) return false;

    // Single-use consumption (Rule #7)
    this.challengeMap.delete(nonce);

    if (item.authUid !== authUid) return false;
    if (item.action !== action) return false;
    if (item.deviceId && deviceId && item.deviceId !== deviceId) return false;
    if (Date.now() > item.expiresAt) return false;

    return true;
  }

  async getStatus(authUid: string) {
    const doc = await this.getEmployeeDoc(authUid);
    const data = doc.data();
    const method = data.attendanceMethod || 'geofence';
    return {
      attendanceMethod: method,
      biometricRequired: method !== 'geofence',
      biometricSetupCompleted: Boolean(data.biometricSetupCompleted),
      biometricDeviceId: data.biometricDeviceId || null,
      biometricDeviceName: data.biometricDeviceName || null,
      biometricActivatedAt: data.biometricActivatedAt || null,
      biometricResetAt: data.biometricResetAt || null,
      faceSetupCompleted: Boolean(data.faceSetupCompleted),
      faceDeviceId: data.faceDeviceId || null,
      faceDeviceName: data.faceDeviceName || null,
      faceSetupVersion: data.faceSetupVersion || 1,
      faceActivatedAt: data.faceActivatedAt || null,
      faceResetAt: data.faceResetAt || null,
    };
  }

  async registerDevice(
    authUid: string,
    payload: { deviceId: string; deviceName?: string; challengeNonce?: string },
  ) {
    if (!payload.deviceId) {
      throw new BadRequestException('deviceId is required.');
    }

    if (payload.challengeNonce && !this.verifyChallenge(authUid, payload.challengeNonce, 'biometric_setup', payload.deviceId)) {
      throw new ForbiddenException('Invalid or expired biometric challenge nonce.');
    }

    const doc = await this.getEmployeeDoc(authUid);
    await doc.ref.update({
      biometricSetupCompleted: true,
      biometricDeviceId: payload.deviceId,
      biometricDeviceName: payload.deviceName || 'Mobile Device',
      biometricActivatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Biometric device registered successfully.',
      deviceId: payload.deviceId,
    };
  }

  async registerFaceDevice(
    authUid: string,
    payload: { deviceId: string; deviceName?: string; nonce?: string },
  ) {
    if (!payload.deviceId) {
      throw new BadRequestException('deviceId is required.');
    }

    if (payload.nonce && !this.verifyChallenge(authUid, payload.nonce, 'face_setup', payload.deviceId)) {
      throw new ForbiddenException('Invalid or expired face setup challenge nonce.');
    }

    const doc = await this.getEmployeeDoc(authUid);
    const data = doc.data();
    const currentVersion = (data.faceSetupVersion as number) || 1;

    await doc.ref.update({
      faceSetupCompleted: true,
      faceDeviceId: payload.deviceId,
      faceDeviceName: payload.deviceName || 'Mobile Phone Camera',
      faceSetupVersion: currentVersion,
      faceActivatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Face recognition device registered successfully.',
      deviceId: payload.deviceId,
      faceSetupVersion: currentVersion,
    };
  }

  async resetDevice(employeeId: string) {
    let docRef = this.employeesCollection.doc(employeeId);
    let docSnap = await docRef.get();

    if (!docSnap.exists) {
      const querySnap = await this.employeesCollection
        .where('authUid', '==', employeeId)
        .limit(1)
        .get();
      if (querySnap.empty) {
        throw new NotFoundException('Employee record not found.');
      }
      docRef = querySnap.docs[0].ref;
    }

    await docRef.update({
      biometricSetupCompleted: false,
      biometricDeviceId: null,
      biometricDeviceName: null,
      biometricResetAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Biometric device setup reset by admin.',
    };
  }

  async resetFaceDevice(employeeId: string) {
    let docRef = this.employeesCollection.doc(employeeId);
    let docSnap = await docRef.get();

    if (!docSnap.exists) {
      const querySnap = await this.employeesCollection
        .where('authUid', '==', employeeId)
        .limit(1)
        .get();
      if (querySnap.empty) {
        throw new NotFoundException('Employee record not found.');
      }
      docRef = querySnap.docs[0].ref;
    }

    // Rule #5: Increment faceSetupVersion on admin reset to invalidate local mobile template
    await docRef.update({
      faceSetupCompleted: false,
      faceDeviceId: null,
      faceDeviceName: null,
      faceSetupVersion: FieldValue.increment(1),
      faceResetAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Face recognition setup reset by admin.',
    };
  }

  // Employee tapped "Contact HR" from an attendance-verification fallback
  // screen (no supported method worked). Rather than routing through a
  // personal supervisor email — which would need a contact address kept in
  // sync for every employee — this raises the same admin_notifications /
  // push alert already proven for fallback events, so it lands wherever HR
  // is already watching, for every role uniformly.
  async requestHelp(
    authUid: string,
    payload: { reason?: string; screen?: string },
  ) {
    const doc = await this.getEmployeeDoc(authUid);
    const data = doc.data();
    const employeeName = data.name || 'An employee';
    const role = normalizeRole(data.role);
    const roleLabel =
      role === 'site_supervisor'
        ? 'Supervisor'
        : role === 'site_employee'
          ? 'Site Employee'
          : 'Office Employee';

    const reasonLabel =
      HELP_REASON_LABELS[payload.reason || ''] ||
      'They could not complete attendance verification';

    const title = 'Authentication Help Requested';
    const bodyText = `${employeeName} (${roleLabel}) needs help completing attendance verification.`;
    const reasonText = `Reason: ${reasonLabel}.`;

    const notifDocId = `${doc.id}_${Date.now()}_help_requested`;
    await this.db
      .collection('admin_notifications')
      .doc(notifDocId)
      .set({
        id: notifDocId,
        type: 'auth_help_requested',
        employeeId: doc.id,
        employeeUid: authUid,
        employeeName,
        role,
        reason: payload.reason || 'unknown',
        screen: payload.screen || null,
        title,
        body: bodyText,
        reasonText,
        message: `${bodyText} ${reasonText}`,
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });

    try {
      const snap = await this.employeesCollection
        .where('role', 'in', ['site_supervisor', 'siteAdmin'])
        .get();
      const supIds = snap.docs
        .map((d) => d.data().authUid || d.id)
        .filter(Boolean);
      if (supIds.length > 0) {
        await this.push.sendToEmployees(supIds, {
          title,
          body: `${bodyText} ${reasonText}`,
        });
      }
    } catch (_) {}

    return { success: true, message: 'HR has been notified.' };
  }
}
