// Manages the "company_codes" collection: single-use registration codes, each
// tied to one employee. An employee must enter their code in the mobile app
// before they can create their login. Redeeming a code marks it used so it
// can't be used again.
import { Injectable } from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { MailService } from '../mail/mail.service';

export interface CompanyCode {
  code: string;
  employeeId: string | null; // null = a code for a brand-new user (no profile yet)
  used: boolean;
  createdAt: string;
  usedAt?: string;
}

@Injectable()
export class CompanyCodesService {
  constructor(private readonly mail: MailService) {}

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

    // If the code is tied to an existing employee, email it to them (with the
    // app-download link). Standalone codes have no address to send to.
    let emailSent = false;
    if (employeeId) {
      const employeeDoc = await this.db
        .collection('employees')
        .doc(employeeId)
        .get();
      const employee = employeeDoc.data() as
        { name?: string; email?: string } | undefined;
      if (employee?.email) {
        const result = await this.mail.sendInviteCode({
          to: employee.email,
          name: employee.name,
          code,
        });
        emailSent = result.sent;
      }
    }

    return { id: ref.id, code, employeeId: employeeId ?? null, emailSent };
  }

  // Deletes a code (revoke / clean up).
  async remove(id: string) {
    await this.collection.doc(id).delete();
    return { id };
  }

  // Admin action: makes a USED code usable again — for someone who entered
  // their code (which consumes it) but never finished registering. Clears the
  // used flag so the same code can be re-entered.
  async reactivate(id: string) {
    const ref = this.collection.doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { ok: false, message: 'Code not found.' };
    await ref.update({ used: false, usedAt: FieldValue.delete() });
    return { ok: true, id };
  }

  // Called by the mobile app when the user enters their registration code.
  // A valid code is CONSUMED right here: the moment it's verified as unused, we
  // mark it used — so the code counts as used as soon as it's entered, without
  // waiting for the person to finish creating their login. Re-entering a code
  // that's already been verified therefore fails (single-use).
  //
  // When the code is tied to an employee the admin already created (not a
  // standalone code), also returns that employee's name/email so the mobile
  // app can pre-fill and lock those fields — the person registering must use
  // the same email the admin put on the employee record.
  async check(code: string) {
    const snapshot = await this.collection.where('code', '==', code).get();
    if (snapshot.empty) {
      return { ok: false, message: 'Invalid code. Please check it and try again.' };
    }
    const doc = snapshot.docs.find(
      (d) => (d.data() as CompanyCode).used === false,
    );
    if (!doc) {
      // The code exists but was already consumed. If they never finished
      // registering, an admin can reactivate it (dashboard → Access codes).
      return {
        ok: false,
        message:
          "This code has already been used. If you didn't finish registering, please contact your admin to reactivate it.",
      };
    }
    const data = doc.data() as CompanyCode;
    // Mark used immediately on verification (single-use).
    await doc.ref.update({ used: true, usedAt: new Date().toISOString() });

    if (!data.employeeId) {
      return { ok: true, employeeId: null };
    }
    const employeeDoc = await this.db
      .collection('employees')
      .doc(data.employeeId)
      .get();
    const employee = employeeDoc.data() as
      { name?: string; email?: string } | undefined;
    return {
      ok: true,
      employeeId: data.employeeId,
      employeeName: employee?.name ?? null,
      employeeEmail: employee?.email ?? null,
    };
  }

  // Called by the mobile app once registration is actually submitted. The code
  // is now consumed earlier, at verification time (see check()), so by this
  // point it's already marked used. Redeem is therefore idempotent: as long as
  // the code exists it confirms it and returns its employee link so
  // registration can complete (marking it used too if it somehow wasn't yet).
  async redeem(code: string) {
    const snapshot = await this.collection.where('code', '==', code).get();
    if (snapshot.empty) {
      return { ok: false, message: 'Invalid code.' };
    }
    const doc = snapshot.docs[0];
    const data = doc.data() as CompanyCode;
    if (!data.used) {
      await doc.ref.update({ used: true, usedAt: new Date().toISOString() });
    }
    return { ok: true, employeeId: data.employeeId };
  }

  // All codes (the dashboard uses this to show each employee's invite status).
  async findAll() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
}
