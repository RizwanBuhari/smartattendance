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
