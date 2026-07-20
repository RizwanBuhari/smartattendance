// One-off migration: copies every document from the OLD collection names to the
// NEW ones, preserving document IDs (so any cross-collection references by ID —
// e.g. geofenceEvents.locationId → a locations doc — keep working).
//
// Firestore has no "rename collection" operation, so renaming is really: create
// the new collection by copying docs into it, verify, then delete the old one.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────────
//   1. Make sure backend/serviceAccountKey.json points at the RIGHT project
//      (the one whose data you want to migrate — currently check-a-92b0e).
//   2. From the backend folder:   node scripts/migrate-collection-names.js
//   3. Check the dashboard/mobile work against the new collections.
//   4. Only THEN, to remove the old collections, re-run with:
//         node scripts/migrate-collection-names.js --delete-old
//
// Safe to run more than once: copying overwrites the same new-doc IDs with the
// same data (idempotent). It never deletes anything unless you pass --delete-old.

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

// OLD collection name  ->  NEW collection name
const RENAMES = {
  admins: 'admin_Users',
  adminSessions: 'admin_Sessions',
  attendance: 'attendance_ids',
  attendanceMeta: 'attendance_UTCM',
  company_codes: 'company_Codes',
  employees: 'employees_ids',
  geofenceEvents: 'geofence_Events',
  locations: 'locations_ids',
  locationPings: 'location_Pings',
};

const DELETE_OLD = process.argv.includes('--delete-old');

const keyPath = path.resolve(__dirname, '..', 'serviceAccountKey.json');
const serviceAccount = require(keyPath);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Copies all docs from `from` to `to`, keeping the same doc IDs. Commits in
// batches (Firestore caps a batch at 500 writes).
async function copyCollection(from, to) {
  const snap = await db.collection(from).get();
  if (snap.empty) {
    console.log(`  ${from.padEnd(16)} -> ${to.padEnd(18)} (empty — nothing to copy)`);
    return 0;
  }
  let batch = db.batch();
  let inBatch = 0;
  let copied = 0;
  for (const docSnap of snap.docs) {
    batch.set(db.collection(to).doc(docSnap.id), docSnap.data());
    inBatch++;
    copied++;
    if (inBatch === 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  console.log(`  ${from.padEnd(16)} -> ${to.padEnd(18)} copied ${copied} doc(s)`);
  return copied;
}

// Deletes every doc in a collection (used only with --delete-old).
async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  if (snap.empty) {
    console.log(`  ${name.padEnd(16)} already empty`);
    return;
  }
  let batch = db.batch();
  let inBatch = 0;
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    inBatch++;
    if (inBatch === 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  console.log(`  ${name.padEnd(16)} deleted ${snap.size} doc(s)`);
}

async function main() {
  console.log(`Project: ${serviceAccount.project_id}\n`);

  console.log('Copying OLD -> NEW collections:');
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    await copyCollection(oldName, newName);
  }

  if (DELETE_OLD) {
    console.log('\n--delete-old given: removing OLD collections:');
    for (const oldName of Object.keys(RENAMES)) {
      await deleteCollection(oldName);
    }
    console.log('\nDone. Old collections removed; data now lives under the new names.');
  } else {
    console.log(
      '\nDone COPYING. The old collections are untouched (kept as a backup).\n' +
        'Verify the app works against the new names, then delete the old ones with:\n' +
        '   node scripts/migrate-collection-names.js --delete-old',
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
