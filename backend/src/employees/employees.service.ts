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
  // A handle to the "employees" collection.
  private readonly collection = getFirestore().collection('employees');

  // Returns every employee. Each doc's Firestore ID becomes the `id` field, so
  // the dashboard gets { id, name, email, ... } just like the old mock data.
  async findAll() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  // Adds one employee. Firestore generates the ID; we return it with the data.
  async create(employee: Employee) {
    const ref = await this.collection.add(employee);
    return { id: ref.id, ...employee };
  }

  // Flips an employee between 'active' and 'disabled'.
  async setStatus(id: string, status: Employee['status']) {
    await this.collection.doc(id).update({ status });
    return { id, status };
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
