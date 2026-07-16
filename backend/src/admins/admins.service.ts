// Manages the "admins" collection and verifies who is allowed into the admin
// dashboard. An admin is simply an email listed in the admins collection.
//
// The dashboard sends the logged-in user's Firebase ID token; we verify it with
// the Admin SDK (so it can't be faked) and check the email against the list.
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

@Injectable()
export class AdminsService {
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('admins');
  // One doc per admin uid, holding the id of the CURRENTLY active session. A
  // new login overwrites it, which the previous session detects (via its
  // onSnapshot listener) and signs itself out — enforcing one login per account.
  private readonly sessions = this.db.collection('adminSessions');

  private async isAdminEmail(email: string) {
    if (!email) return false;
    const snap = await this.collection
      .where('email', '==', email)
      .limit(1)
      .get();
    return !snap.empty;
  }

  // Verifies a Firebase ID token and reports whether that user is an admin.
  async verify(idToken: string) {
    if (!idToken) return { isAdmin: false };
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      const email = decoded.email ?? '';
      return { isAdmin: await this.isAdminEmail(email), email };
    } catch {
      return { isAdmin: false };
    }
  }

  // Claims the single active session for this admin: mints a fresh session id,
  // records it as THE active one, and returns it. Any other device still holding
  // an older id will see the mismatch and sign out.
  async claimSession(idToken: string) {
    if (!idToken) return { ok: false };
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      const email = decoded.email ?? '';
      if (!(await this.isAdminEmail(email))) return { ok: false };
      const sessionId = randomUUID();
      await this.sessions.doc(decoded.uid).set({
        sessionId,
        email,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true, sessionId };
    } catch {
      return { ok: false };
    }
  }

  // Resolves the verified email from a Firebase ID token (null if invalid).
  private async emailFromToken(idToken: string) {
    if (!idToken) return null;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      return decoded.email ?? null;
    } catch {
      return null;
    }
  }

  private async docByEmail(email: string) {
    const snap = await this.collection
      .where('email', '==', email)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0];
  }

  // The logged-in admin's own profile (from their admins doc).
  async me(idToken: string) {
    const email = await this.emailFromToken(idToken);
    if (!email) return null;
    const doc = await this.docByEmail(email);
    return doc ? { ...doc.data(), id: doc.id } : null;
  }

  // Updates the logged-in admin's editable profile fields.
  async updateMe(
    idToken: string,
    changes: {
      displayName?: string;
      phone?: string;
      jobTitle?: string;
      photoBase64?: string;
    },
  ) {
    const email = await this.emailFromToken(idToken);
    if (!email) return { ok: false };
    const doc = await this.docByEmail(email);
    if (!doc) return { ok: false };

    const allowed: Record<string, string> = {};
    for (const key of ['displayName', 'phone', 'jobTitle', 'photoBase64']) {
      const value = changes[key as keyof typeof changes];
      if (value !== undefined) allowed[key] = value;
    }
    await doc.ref.update(allowed);
    const updated = await doc.ref.get();
    return { ...updated.data(), id: doc.id };
  }

  async findAll() {
    const snap = await this.collection.get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }

  // Adds an admin by email (no duplicates).
  async add(email: string) {
    const existing = await this.collection
      .where('email', '==', email)
      .limit(1)
      .get();
    if (!existing.empty) {
      return { id: existing.docs[0].id, email, existed: true };
    }
    const ref = await this.collection.add({ email });
    return { id: ref.id, email, existed: false };
  }

  async remove(id: string) {
    await this.collection.doc(id).delete();
    return { id };
  }
}
