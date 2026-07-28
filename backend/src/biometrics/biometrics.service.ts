import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';

@Injectable()
export class BiometricsService {
  private readonly db = getFirestore();
  private readonly employeesCollection = this.db.collection('employees_ids');
  private readonly challengeMap = new Map<string, { nonce: string; expiresAt: number }>();

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

  async createChallenge(authUid: string) {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 60 * 1000; // 60s expiration
    this.challengeMap.set(authUid, { nonce, expiresAt });
    return { challengeNonce: nonce, expiresAt: new Date(expiresAt).toISOString() };
  }

  verifyChallenge(authUid: string, nonce?: string): boolean {
    if (!nonce) return true; // Optional for backwards compatibility
    const item = this.challengeMap.get(authUid);
    if (!item) return false;
    this.challengeMap.delete(authUid);
    return item.nonce === nonce && Date.now() <= item.expiresAt;
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
    };
  }

  async registerDevice(
    authUid: string,
    payload: { deviceId: string; deviceName?: string; challengeNonce?: string },
  ) {
    if (!payload.deviceId) {
      throw new BadRequestException('deviceId is required.');
    }

    if (payload.challengeNonce && !this.verifyChallenge(authUid, payload.challengeNonce)) {
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
}
