// Manages the "company_codes" collection: single-use registration codes, each
// tied to one employee. An employee must enter their code in the mobile app
// before they can create their login. Redeeming a code marks it used so it
// can't be used again.
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';

export interface CompanyCode {
  code: string;
  employeeId: string | null; // null = a code for a brand-new user (no profile yet)
  used: boolean;
  createdAt: string;
  usedAt?: string;
}

@Injectable()
export class CompanyCodesService {
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('company_codes');

  // Short, human-typeable code with no ambiguous characters (0/O, 1/I).
  private generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  // Issues a code. If tied to an employee, any previous UNUSED code for that
  // employee is deleted first so only one is active (a "resend" replaces it).
  // With no employeeId, it's a standalone code for a brand-new user (the person
  // supplies their name/email when they register in the app); those are never
  // auto-cleared, so each generated code persists until used.
  async create(employeeId?: string) {
    if (employeeId) {
      const existing = await this.collection
        .where('employeeId', '==', employeeId)
        .where('used', '==', false)
        .get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
    }

    const code = this.generateCode();
    const ref = await this.collection.add({
      code,
      employeeId: employeeId ?? null,
      used: false,
      createdAt: new Date().toISOString(),
    });
    return { id: ref.id, code, employeeId: employeeId ?? null };
  }

  // Deletes a code (revoke / clean up).
  async remove(id: string) {
    await this.collection.doc(id).delete();
    return { id };
  }

  // Validates a code WITHOUT consuming it (read-only). The mobile app calls
  // this while the employee is typing / before registering, so it may run
  // several times — it must not mark the code used. Returns the employeeId
  // (may be null for a new-user code) if valid, or null if invalid/used.
  async check(code: string) {
    const snapshot = await this.collection.where('code', '==', code).get();
    const doc = snapshot.docs.find(
      (d) => (d.data() as CompanyCode).used === false,
    );
    if (!doc) return null;
    return { employeeId: (doc.data() as CompanyCode).employeeId };
  }

  // Called by the mobile app before the employee registers. Succeeds only if
  // the code exists and is still unused, then marks it used (single-use).
  async redeem(code: string) {
    const snapshot = await this.collection.where('code', '==', code).get();
    const doc = snapshot.docs.find((d) => (d.data() as CompanyCode).used === false);
    if (!doc) {
      return { ok: false, message: 'Invalid or already-used code.' };
    }
    await doc.ref.update({ used: true, usedAt: new Date().toISOString() });
    const data = doc.data() as CompanyCode;
    return { ok: true, employeeId: data.employeeId };
  }

  // All codes (the dashboard uses this to show each employee's invite status).
  async findAll() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}
