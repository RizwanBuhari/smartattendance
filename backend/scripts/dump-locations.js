// Read-only: prints how each location is configured for the check-in gate.
//
// attendance.service.ts only demands site-admin approval when isSite(location)
// is true, and that is `location.type === 'site'`. A location left on the older
// `requiresCheckInCode` flag reads as an ordinary office, so the approval step
// is skipped and no site admin is ever notified. This shows both fields side by
// side so that mismatch is obvious.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: cert('./serviceAccountKey.json') });

const db = getFirestore();

async function run() {
  const snap = await db.collection('locations_ids').get();
  console.log(`Found ${snap.size} locations:\n`);

  let needsMigration = 0;

  snap.forEach((doc) => {
    const d = doc.data();
    const gated = d.type === 'site';
    if (d.requiresCheckInCode === true && !gated) needsMigration++;

    console.log(`  ${d.name ?? '(unnamed)'}  [${doc.id}]`);
    console.log(`    type                 : ${d.type ?? '(unset)'}`);
    console.log(`    requiresCheckInCode  : ${d.requiresCheckInCode ?? '(unset)'}`);
    console.log(`    -> approval required : ${gated ? 'YES' : 'NO'}`);
    console.log('');
  });

  if (needsMigration > 0) {
    console.log(
      `${needsMigration} location(s) still use requiresCheckInCode but have no ` +
        `type:'site', so approval is NOT being enforced on them.`,
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
