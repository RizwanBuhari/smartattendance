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
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async create(location: Location) {
    const ref = await this.collection.add(location);
    return { id: ref.id, ...location };
  }

  async remove(id: string) {
    await this.collection.doc(id).delete();
    return { id };
  }

  // One-time helper to fill the collection with the two sample sites.
  async seed() {
    const samples: Location[] = [
      { name: 'Dubai Head Office', latitude: 25.1189, longitude: 55.3773, radiusMeters: 150 },
      { name: 'Silicon Oasis Site', latitude: 25.1206, longitude: 55.3877, radiusMeters: 100 },
    ];
    for (const location of samples) {
      await this.collection.add(location);
    }
    return { seeded: samples.length };
  }
}
