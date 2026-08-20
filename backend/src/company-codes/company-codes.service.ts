// Manages the "company_Codes" collection: single-use registration codes, each
// tied to one employee. An employee must enter their code in the mobile app
// before they can create their login.
//
// The code is consumed by consume(), inside POST /auth/register, and nowhere
// else — that is the one moment where "this person holds a valid invite" is
// actually being decided. peek() is a read-only preview for the form.
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
  private readonly collection = this.db.collection('company_Codes');

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
        .collection('employees_ids')
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

  // A READ-ONLY preview, so the app can tell the user "that code is wrong"
  // while they type and pre-fill the name/email the admin registered.
  //
  // This used to mark the code used, which is what made the whole invite system
  // decorative: by the time registration was submitted the code was already
  // consumed, so the final step had nothing left to verify and just trusted
  // that the client had been here first. Consuming now happens in consume()
  // below, as part of registering — the only moment it actually means anything.
  //
  // A pleasant side effect: abandoning the form no longer burns the code, so
  // admins stop having to reactivate codes for people who backed out.
  async peek(code: string) {
    const snapshot = await this.collection.where('code', '==', code).get();
    if (snapshot.empty) {
      return {
        ok: false as const,
        message: 'Invalid code. Please check it and try again.',
      };
    }
    const doc = snapshot.docs.find(
      (d) => (d.data() as CompanyCode).used === false,
    );
    if (!doc) {
      return {
        ok: false as const,
        message:
          "This code has already been used. If you didn't finish registering, please contact your admin to reactivate it.",
      };
    }

    const data = doc.data() as CompanyCode;
    if (!data.employeeId) {
      return { ok: true as const, employeeId: null };
    }
    const employeeDoc = await this.db
      .collection('employees_ids')
      .doc(data.employeeId)
      .get();
    const employee = employeeDoc.data() as
      { name?: string; email?: string } | undefined;
    return {
      ok: true as const,
      employeeId: data.employeeId,
      employeeName: employee?.name ?? null,
      employeeEmail: employee?.email ?? null,
    };
  }

  // Validates AND consumes the code in one atomic step, returning the employee
  // it was issued for. That employee id is the only trustworthy source of the
  // link — a client-supplied one would let anyone attach their new login to any
  // existing employee record.
  //
  // The transaction is what makes "single use" true: two people submitting the
  // same code at the same moment cannot both read `used: false` and both win.
  async consume(code: string) {
    return this.db.runTransaction(async (tx) => {
      // Filtered in memory rather than with a second `where`, so this needs no
      // composite index.
      const snapshot = await tx.get(this.collection.where('code', '==', code));
      if (snapshot.empty) {
        return {
          ok: false as const,
          message: 'Invalid code. Please check it and try again.',
        };
      }
      const doc = snapshot.docs.find(
        (d) => (d.data() as CompanyCode).used === false,
      );
      if (!doc) {
        return {
          ok: false as const,
          message:
            "This code has already been used. If you didn't finish registering, please contact your admin to reactivate it.",
        };
      }
      tx.update(doc.ref, { used: true, usedAt: new Date().toISOString() });
      return {
        ok: true as const,
        employeeId: (doc.data() as CompanyCode).employeeId ?? null,
      };
    });
  }

  // Puts a consumed code back, used when registration fails after the code was
  // taken. Without this a crash mid-registration would silently burn someone's
  // invite and require an admin to reissue it.
  async release(code: string) {
    const snapshot = await this.collection.where('code', '==', code).get();
    const doc = snapshot.docs[0];
    if (!doc) return;
    await doc.ref.update({ used: false, usedAt: FieldValue.delete() });
  }

  // All codes (the dashboard uses this to show each employee's invite status).
  async findAll() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
}
