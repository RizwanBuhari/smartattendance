// Talks to the "locations" collection in Firestore — the approved work sites
// (with a GPS centre + allowed radius) that attendance is checked against.
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

@Injectable()
export class LocationsService {
  private readonly collection = getFirestore().collection('locations');

  async findAll() {
    const snapshot = await this.collection.get();
    // Spread data first, then id — the Firestore doc id must win over any
    // stored `id` field so delete targets the right record.
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  async create(location: Location) {
    const ref = await this.collection.add(location);
    return { id: ref.id, ...location };
  }

  // Updates a location's editable fields (name / coordinates / radius). Writes
  // straight to Firestore — which is exactly what the mobile geofence reads, so
  // a change here takes effect immediately for check-ins.
  async update(id: string, changes: Partial<Location>) {
    const allowed: Partial<Location> = {};
    if (changes.name !== undefined) allowed.name = changes.name;
    if (changes.latitude !== undefined) allowed.latitude = changes.latitude;
    if (changes.longitude !== undefined) allowed.longitude = changes.longitude;
    if (changes.radiusMeters !== undefined) {
      allowed.radiusMeters = changes.radiusMeters;
    }
    await this.collection.doc(id).update(allowed);
    const doc = await this.collection.doc(id).get();
    return { ...doc.data(), id };
  }

  async remove(id: string) {
    await this.collection.doc(id).delete();
    return { id };
  }

  // One-time helper to seed the single approved site: the Dubai office.
  // Coordinates are the office's official location; the 100 m radius gives a
  // reasonable geofence allowing for normal GPS drift.
  async seed() {
    const samples: Location[] = [
      { name: 'Dubai Head Office', latitude: 25.133093, longitude: 55.387385, radiusMeters: 100 },
    ];
    for (const location of samples) {
      await this.collection.add(location);
    }
    return { seeded: samples.length };
  }
}
