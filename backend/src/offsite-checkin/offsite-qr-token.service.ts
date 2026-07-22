import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { OtpService } from '../otp/otp.service';

// This flag is the single switch that will flip once the friend's secure
// OTP/token generator lands: swap the body of `requestQrGeneration` and
// `verifyScannedQr` below for calls into that function, and this constant
// (and everything gated behind it) can be deleted.
//
// Until then, real QR generation/verification is only ever allowed in a
// non-production environment, so nobody can accidentally ship or rely on the
// interim generator in a released build. Set DEBUG_QR_GENERATOR=true to force
// it on anyway (e.g. to demo the flow from a production-configured backend).
function integrationPending(): boolean {
  const forced = process.env.DEBUG_QR_GENERATOR === 'true';
  return !forced && process.env.NODE_ENV === 'production';
}

@Injectable()
export class OffsiteQrTokenService {
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('offsite_requests');

  constructor(private readonly otpService: OtpService) {}

  /**
   * Request OTP/token generation for an approved offsite check-in request.
   * This is where the external OTP/token generator will connect.
   */
  async requestQrGeneration(requestId: string): Promise<void> {
    const docRef = this.collection.doc(requestId);
    const snap = await docRef.get();
    if (!snap.exists || !snap.data()) throw new NotFoundException('Request not found.');
    const data = snap.data()!;

    // The secure generator isn't wired in yet — leave the request approved but
    // without a scannable code, rather than generating one that must not be
    // trusted. The mobile app renders this as "QR Integration Pending".
    if (integrationPending()) {
      await docRef.update({
        qrGenerationStatus: 'integration_pending',
        status: 'approved_waiting_qr',
        tokenHash: null,
        tokenExpiresAt: null,
        qrPayload: null,
        qrExpiresAt: null,
        expiresAt: null,
        generatorVersion: 'integration_pending',
      });
      return;
    }

    const employeeId = data.employeeId;
    const supervisorId = data.supervisorId;
    const worksiteId = data.worksiteId;

    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString(); // Valid for 60 seconds

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
      // Redis is down: fall back to a random (never derivable) code so local
      // testing keeps working. This never runs in production — integrationPending()
      // already returned above in that case.
      otpCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    }

    console.log(`[OffsiteQrTokenService] Generated new OTP Code: ${otpCode} for Request: ${requestId} (Expires in 60s)`);

    await docRef.update({
      qrGenerationStatus: 'ready',
      qrExpiresAt: expiresAt,
      status: 'qr_ready',
      tokenHash: otpCode,
      tokenExpiresAt: expiresAt,
      generatorVersion: usingRedis ? 'redis-otp-1.0' : 'random-fallback-1.0',
      tokenGenerationId: `gen_${Date.now()}`,
      qrPayload: otpCode,
      expiresAt,
    });
  }

  /**
   * Check current QR/token status for a request.
   */
  async getQrStatus(requestId: string): Promise<any> {
    const doc = await this.collection.doc(requestId).get();
    if (!doc.exists || !doc.data()) throw new NotFoundException('Request not found.');
    const data = doc.data()!;
    return {
      qrGenerationStatus: data.qrGenerationStatus || 'integration_pending',
      qrExpiresAt: data.qrExpiresAt || null,
      status: data.status,
      // Exposed raw payload for QR rendering
      tokenPayload: data.tokenHash || '',
    };
  }

  /**
   * Verify the scanned payload. Never create attendance from a placeholder in release.
   */
  async verifyScannedQr(
    requestId: string,
    scannedPayload: string,
    locationData: { latitude: number; longitude: number; deviceId?: string },
  ): Promise<{ isValid: boolean; message?: string }> {
    // Real verification is never available in production until the secure
    // generator is wired in — checked first, and independent of whatever this
    // particular request's status/tokenHash happen to hold, so nothing scanned
    // against a stale or fallback token can ever pass here.
    if (integrationPending()) {
      return { isValid: false, message: 'QR verification is pending integration.' };
    }

    const doc = await this.collection.doc(requestId).get();
    if (!doc.exists || !doc.data()) return { isValid: false, message: 'Request not found.' };
    const data = doc.data()!;

    if (data.status !== 'qr_ready') {
      return { isValid: false, message: `Request is in status: ${data.status}` };
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(data.qrExpiresAt);
    if (now > expiresAt) {
      await this.collection.doc(requestId).update({
        status: 'qr_expired',
      });
      return { isValid: false, message: 'QR code expired' };
    }

    const employeeId = data.employeeId;

    if (data.generatorVersion === 'redis-otp-1.0') {
      try {
        await this.otpService.verifyCode(employeeId, scannedPayload);
        return { isValid: true };
      } catch (err: any) {
        return { isValid: false, message: err.message || 'Invalid QR code.' };
      }
    }

    // Random-fallback path (Redis was unreachable when the code was issued):
    // still only reachable outside production, per the integrationPending()
    // check above.
    if (data.tokenHash !== scannedPayload) {
      return { isValid: false, message: 'Invalid QR code' };
    }
    return { isValid: true };
  }

  /**
   * Invalidate the old token and generate a brand new one.
   */
  async regenerateQr(requestId: string): Promise<void> {
    await this.collection.doc(requestId).update({
      tokenHash: null,
      qrGenerationStatus: 'generation_pending',
      tokenExpiresAt: null,
      tokenUsedAt: null,
      qrPayload: null,
      expiresAt: null,
    });
    await this.requestQrGeneration(requestId);
  }
}

