// Creates a ready-to-test site: one site admin, two employees, and a location
// that requires a scanned code to check in.
//
// It creates real Firebase Auth logins so you can actually sign in on the phone.
//
// RUN:      node scripts/seed-site-admin-demo.js
// UNDO:     node scripts/seed-site-admin-demo.js --cleanup
//
// Everything it creates is prefixed/suffixed "demo" so cleanup can find it again.
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('../serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

const CLEANUP = process.argv.includes('--cleanup');
const PASSWORD = 'Demo1234!';

const LOCATION_ID = 'demo-site-dubai';
const PEOPLE = [
  {
    docId: 'demo-siteadmin',
    email: 'siteadmin@demo.local',
    name: 'Sara Site-Admin',
    role: 'siteAdmin',
  },
  {
    docId: 'demo-employee-1',
    email: 'employee1@demo.local',
    name: 'Omar Employee',
    role: 'employee',
  },
  {
    docId: 'demo-employee-2',
    email: 'employee2@demo.local',
    name: 'Layla Employee',
    role: 'employee',
  },
];

// Reuses the Auth user if the email already exists, so re-running is safe.
async function ensureAuthUser(email, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password: PASSWORD, displayName });
    return existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const created = await auth.createUser({
      email,
      password: PASSWORD,
      displayName,
      emailVerified: true,
    });
    return created.uid;
  }
}

async function seed() {
  console.log(`Project: ${serviceAccount.project_id}\n`);

  // 1. A site that demands a scanned code on top of the geofence.
  //    Coordinates match the existing Dubai office; widen the radius so a phone
  //    on the same site passes the geofence while testing.
  await db.collection('locations_ids').doc(LOCATION_ID).set({
    name: 'Demo Site (Dubai)',
    latitude: 25.133093,
    longitude: 55.387385,
    radiusMeters: 500,
    requiresCheckInCode: true,
  });
  console.log(`Location "${LOCATION_ID}" created (requiresCheckInCode: true)`);

  // 2. The people, each with a real login and an employee record linked by uid.
  console.log('\nAccounts:');
  for (const person of PEOPLE) {
    const uid = await ensureAuthUser(person.email, person.name);
    await db.collection('employees_ids').doc(person.docId).set({
      name: person.name,
      email: person.email,
      status: 'active',
      role: person.role,
      assignedLocationIds: [LOCATION_ID],
      authUid: uid,
    });
    console.log(
      `  ${person.role.padEnd(10)} ${person.email.padEnd(24)} ${PASSWORD}`,
    );
  }

  console.log(`
Done.

Sign in on the phone as siteadmin@demo.local to get the "Site" tab; sign in as
employee1@demo.local on another device to scan the code.

Both accounts are assigned to "Demo Site (Dubai)", which requires a scanned code
to check in.
`);
}

async function cleanup() {
  for (const person of PEOPLE) {
    await db.collection('employees_ids').doc(person.docId).delete().catch(() => {});
    try {
      const user = await auth.getUserByEmail(person.email);
      await auth.deleteUser(user.uid);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
    console.log(`removed ${person.email}`);
  }
  await db.collection('locations_ids').doc(LOCATION_ID).delete().catch(() => {});
  console.log(`removed location ${LOCATION_ID}`);
}

(CLEANUP ? cleanup() : seed())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
