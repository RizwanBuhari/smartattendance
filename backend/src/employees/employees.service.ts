// Talks to the "employees" collection in Firestore.
//
// This is the ONLY place employee data is read/written. The controller calls
// these methods; nothing here knows about HTTP. getFirestore() reuses the
// admin app we initialized in main.ts, so no extra setup is needed.
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';

// The shape of one employee document (mirrors the dashboard's mockData.js).
export interface Employee {
  name: string;
  email: string;
  status: 'active' | 'disabled';
  assignedLocationIds: string[];
}

@Injectable()
export class EmployeesService {
  private readonly db = getFirestore();
  // A handle to the "employees" collection.
  private readonly collection = this.db.collection('employees');

  // Returns every employee. Each doc's Firestore ID becomes the `id` field, so
  // the dashboard gets { id, name, email, ... } just like the old mock data.
  async findAll() {
    const snapshot = await this.collection.get();
    // Spread data first, then id — the Firestore doc id must win over any
    // stored `id` field, so delete/update target the right record.
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  // Adds one employee. Firestore generates the ID; we return it with the data.
  async create(employee: Employee) {
    const ref = await this.collection.add(employee);
    return { id: ref.id, ...employee };
  }

  // Applies a partial update to an employee — used to flip status and to set
  // the list of approved locations. Only known fields are written.
  async update(id: string, changes: Partial<Employee>) {
    const allowed: Partial<Employee> = {};
    if (changes.status !== undefined) allowed.status = changes.status;
    if (changes.assignedLocationIds !== undefined) {
      allowed.assignedLocationIds = changes.assignedLocationIds;
    }
    await this.collection.doc(id).update(allowed);
    const doc = await this.collection.doc(id).get();
    return { ...doc.data(), id };
  }

  // Deletes an employee and cleans up everything tied to them: their attendance
  // records and invite codes. The Firebase Auth login, if any, is separate and
  // can be removed from the Firebase console.
  //
  // Attendance is keyed by `employeeId`, which is the Firebase UID for a
  // registered user (stored on the employee doc as `authUid`) but may also be
  // the employee doc's id for admin-created records — so we delete records
  // matching either key.
  async remove(id: string) {
    const doc = await this.collection.doc(id).get();
    const authUid = (doc.data() as { authUid?: string } | undefined)?.authUid;
    const keys = [id, authUid].filter((k): k is string => !!k);

    const attendance = this.db.collection('attendance');
    for (const key of keys) {
      const snap = await attendance.where('employeeId', '==', key).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }

    const codes = await this.db
      .collection('company_codes')
      .where('employeeId', '==', id)
      .get();
    await Promise.all(codes.docs.map((d) => d.ref.delete()));

    await this.collection.doc(id).delete();
    return { id };
  }

  // One-time helper: fills the collection with sample data so the dashboard has
  // something to show. Safe to remove once you add real employees via the UI.
  async seed() {
    const samples: Employee[] = [
      { name: 'Amash Aal', email: 'amash@example.com', status: 'active', assignedLocationIds: [] },
      { name: 'Rizwan Buhari', email: 'rizwan@example.com', status: 'active', assignedLocationIds: [] },
      { name: 'Sara Khan', email: 'sara@example.com', status: 'disabled', assignedLocationIds: [] },
    ];
    for (const employee of samples) {
      await this.collection.add(employee);
    }
    return { seeded: samples.length };
  }
}
