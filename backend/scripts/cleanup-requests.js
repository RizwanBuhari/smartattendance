const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

const db = getFirestore();

async function run() {
  console.log("Cleaning up offsite requests...");
  const snap = await db.collection('offsite_requests').get();
  const batch = db.batch();
  snap.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log(`Successfully deleted ${snap.size} requests.`);
}

run().catch(console.error);
