// One-off script: recreates the six collections in a FRESH Firebase project's
// Firestore, so the new database has the same shape as the old one.
//
// Firestore can't hold an *empty* collection — a collection only appears once it
// has a document. So this writes a starter doc into each collection:
//   • admins        -> your admin email(s)      (needed to log into the dashboard)
//   • locations     -> the Dubai Head Office    (needed so check-ins have a site)
//   • employees / attendance / locationPings / company_codes
//                   -> a single _placeholder doc, just so the collection exists.
//     These four fill themselves in normally as the app is used (registering an
//     employee, checking in, background pings, generating a code), so you can
//     DELETE the placeholder docs whenever you like.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────────
//   1. Put the NEW project's service-account key at  backend/serviceAccountKey.json
//      (this script writes to whatever project that key belongs to — make sure
//       it's the new one, not the old!).
//   2. Set ADMIN_EMAILS below to the email(s) you'll sign in with. Each MUST also
//      exist as a user in the new project's Firebase Authentication, or login
//      still fails (the dashboard checks Auth first, then this admins list).
//   3. From the backend folder:   node scripts/seed-new-firestore.js
//
// Safe to run more than once: it won't duplicate an admin or the location, and it
// only adds a placeholder to a collection that is still empty.

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

// ▼▼▼ EDIT THIS: the admin email(s) that may log into the dashboard ▼▼▼
const ADMIN_EMAILS = [
  'ahmedhany@elsewedy.com',
];
// ▲▲▲ each must also be created in the new project's Authentication ▲▲▲

// The approved work site (same values your old project used).
const LOCATION = {
  name: 'Dubai Head Office',
  latitude: 25.133093,
  longitude: 55.387385,
  radiusMeters: 100,
};

// Collections that the app populates on its own — we only drop a deletable
// placeholder so they show up in the console immediately.
const PLACEHOLDER_COLLECTIONS = [
  'employees',
  'attendance',
  'locationPings',
  'company_codes',
];

const keyPath = path.resolve(__dirname, '..', 'serviceAccountKey.json');
const serviceAccount = require(keyPath);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function ensureAdmins() {
  for (const email of ADMIN_EMAILS) {
    const existing = await db
      .collection('admins')
      .where('email', '==', email)
      .limit(1)
      .get();
    if (existing.empty) {
      await db.collection('admins').add({ email });
      console.log(`  admins:        added ${email}`);
    } else {
      console.log(`  admins:        ${email} already present — skipped`);
    }
  }
}

async function ensureLocation() {
  const existing = await db
    .collection('locations')
    .where('name', '==', LOCATION.name)
    .limit(1)
    .get();
  if (existing.empty) {
    await db.collection('locations').add(LOCATION);
    console.log(`  locations:     added "${LOCATION.name}"`);
  } else {
    console.log(`  locations:     "${LOCATION.name}" already present — skipped`);
  }
}

async function ensurePlaceholder(name) {
  const snap = await db.collection(name).limit(1).get();
  if (snap.empty) {
    await db.collection(name).doc('_placeholder').set({
      _placeholder: true,
      note: 'Auto-created so the collection exists. Safe to delete once real data arrives.',
      createdAt: new Date().toISOString(),
    });
    console.log(`  ${name.padEnd(14)} created (placeholder — deletable)`);
  } else {
    console.log(`  ${name.padEnd(14)} already has data — skipped`);
  }
}

async function main() {
  console.log(`Seeding project: ${serviceAccount.project_id}\n`);
  await ensureAdmins();
  await ensureLocation();
  for (const name of PLACEHOLDER_COLLECTIONS) {
    await ensurePlaceholder(name);
  }
  console.log('\nDone. All six collections now exist in the new Firestore.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nSeeding failed:', err);
  process.exit(1);
});
