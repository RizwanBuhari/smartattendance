// Manages the "admins" collection and verifies who is allowed into the admin
// dashboard. An admin is simply an email listed in the admins collection.
//
// The dashboard sends the logged-in user's Firebase ID token; we verify it with
// the Admin SDK (so it can't be faked) and check the email against the list.
import { Injectable } from '@nestjs/common';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

@Injectable()
export class AdminsService {
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('admins');

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
