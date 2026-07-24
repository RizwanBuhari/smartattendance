import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { OtpService } from '../otp/otp.service';

function integrationPending(): boolean {
  const forced = process.env.DEBUG_QR_GENERATOR === 'true';
  return !forced && process.env.NODE_ENV === 'production';
}

export interface TokenBinding {
  requestId: string;
  requestType: 'check_in' | 'check_out';
  employeeId: string;
  supervisorId: string;
  worksiteId: string;
  tokenGenerationId: string;
  expiresAt: string;
  code: string;
  revoked: boolean;
  used: boolean;
}

@Injectable()
export class OffsiteQrTokenService {
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('offsite_requests');
  private readonly tokenBindingsCollection = this.db.collection('offsite_token_bindings');

  constructor(private readonly otpService: OtpService) {}

  /**
   * Request OTP/token generation for an approved offsite check-in or check-out request.
   * Bound securely to: requestId, requestType, employeeId, supervisorId, worksiteId, tokenGenerationId, expiresAt.
   */
  async requestQrGeneration(requestId: string): Promise<void> {
    const docRef = this.collection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    const data = snap.data()!;

    if (integrationPending()) {
      await docRef.update({
        qrGenerationStatus: 'integration_pending',
        status: 'approved_waiting_qr',
        tokenHash: null,
        tokenExpiresAt: null,
        qrPayload: null,
        qrExpiresAt: null,
        generatorVersion: 'integration_pending',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const employeeId = data.employeeId;
    const supervisorId = data.supervisorId;
    const worksiteId = data.worksiteId;
    const requestType = data.requestType || 'check_in';
    const tokenGenerationId = `gen_${Date.now()}_${randomInt(1000, 9999)}`;
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

    let otpCode: string;
    let usingRedis = false;

    try {
      const res = await this.otpService.issueCode({
        issuedByEmployeeId: supervisorId,
        targetEmployeeId: employeeId,
        locationId: worksiteId,
      });
      otpCode = res.code;
      usingRedis = true;
    } catch {
      otpCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    }

    // Revoke any previous token bindings for this request
    const prevBindings = await this.tokenBindingsCollection.where('requestId', '==', requestId).get();
    for (const bDoc of prevBindings.docs) {
      await bDoc.ref.update({ revoked: true, updatedAt: FieldValue.serverTimestamp() });
    }

    // Create a new bound token record in Firestore
    const bindingRecord: TokenBinding = {
      requestId,
      requestType,
      employeeId,
      supervisorId,
      worksiteId,
      tokenGenerationId,
      expiresAt,
      code: otpCode,
      revoked: false,
      used: false,
    };

    await this.tokenBindingsCollection.doc(tokenGenerationId).set({
      ...bindingRecord,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[OffsiteQrTokenService] Generated OTP Code: ${otpCode} [${requestType}] for Request: ${requestId} (GenId: ${tokenGenerationId})`);

    const currentGenCount = (data.qrRegenerationCount as number | undefined) ?? 0;

    await docRef.update({
      qrGenerationStatus: 'ready',
      qrExpiresAt: expiresAt,
      status: 'qr_ready',
      tokenHash: otpCode,
      tokenExpiresAt: expiresAt,
      generatorVersion: usingRedis ? 'redis-otp-1.0' : 'random-fallback-1.0',
      tokenGenerationId,
      qrPayload: otpCode,
      qrRegenerationCount: currentGenCount + 1,
      qrRegeneratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async getQrStatus(requestId: string): Promise<any> {
    const doc = await this.collection.doc(requestId).get();
    if (!doc.exists || !doc.data()) throw new NotFoundException('Request not found.');
    const data = doc.data()!;
    return {
      qrGenerationStatus: data.qrGenerationStatus || 'integration_pending',
      qrExpiresAt: data.qrExpiresAt || null,
      status: data.status,
      requestType: data.requestType || 'check_in',
      tokenPayload: data.tokenHash || '',
      tokenGenerationId: data.tokenGenerationId || null,
    };
  }

  /**
   * Verify the scanned payload with multi-field binding checks.
   */
  async verifyScannedQr(
    requestId: string,
    scannedPayload: string,
    locationData: { latitude: number; longitude: number; deviceId?: string; expectedRequestType?: 'check_in' | 'check_out' },
  ): Promise<{ isValid: boolean; message?: string }> {
    if (integrationPending()) {
      return { isValid: false, message: 'QR verification is pending integration.' };
    }

    const doc = await this.collection.doc(requestId).get();
    if (!doc.exists || !doc.data()) return { isValid: false, message: 'Request not found.' };
    const data = doc.data()!;

    if (data.status !== 'qr_ready') {
      return { isValid: false, message: `Request is in status: ${data.status}` };
    }

    // Verify requestType binding: Check-in QR must NEVER perform checkout and vice versa
    if (locationData.expectedRequestType && data.requestType !== locationData.expectedRequestType) {
      return { isValid: false, message: `Request type mismatch. Expected ${locationData.expectedRequestType} but request is ${data.requestType}.` };
    }

    // Check expiry against server/ISO time
    const now = new Date();
    const expiresAt = new Date(data.qrExpiresAt);
    if (now > expiresAt) {
      await this.collection.doc(requestId).update({
        status: 'qr_expired',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { isValid: false, message: 'QR code expired' };
    }

    // Verify token binding in tokenBindingsCollection
    const genId = data.tokenGenerationId;
    if (genId) {
      const bindingSnap = await this.tokenBindingsCollection.doc(genId).get();
      if (bindingSnap.exists) {
        const binding = bindingSnap.data() as TokenBinding;
        if (binding.revoked) {
          return { isValid: false, message: 'This QR code generation has been revoked.' };
        }
        if (binding.used) {
          return { isValid: false, message: 'This QR code has already been used.' };
        }
        if (binding.requestId !== requestId || binding.requestType !== data.requestType || binding.employeeId !== data.employeeId) {
          return { isValid: false, message: 'Token binding validation failed.' };
        }
      }
    }

    const employeeId = data.employeeId;

    if (data.generatorVersion === 'redis-otp-1.0') {
      try {
        await this.otpService.verifyCode(employeeId, scannedPayload);
      } catch (err: any) {
        return { isValid: false, message: err.message || 'Invalid QR code.' };
      }
    } else {
      if (data.tokenHash !== scannedPayload) {
        return { isValid: false, message: 'Invalid QR code' };
      }
    }

    // Mark token binding as used
    if (genId) {
      await this.tokenBindingsCollection.doc(genId).update({
        used: true,
        usedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { isValid: true };
  }

  /**
   * Invalidate previous generation and issue a brand new OTP token generation.
   */
  async regenerateQr(requestId: string, supervisorName?: string): Promise<void> {
    const docRef = this.collection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    const data = snap.data()!;

    // Revoke previous generation token binding if present
    if (data.tokenGenerationId) {
      await this.tokenBindingsCollection.doc(data.tokenGenerationId).update({
        revoked: true,
        revokedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await docRef.update({
      tokenHash: null,
      qrGenerationStatus: 'generation_pending',
      tokenExpiresAt: null,
      qrPayload: null,
      qrRegeneratedBy: supervisorName || data.supervisorName || 'supervisor',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await this.requestQrGeneration(requestId);
  }
}
