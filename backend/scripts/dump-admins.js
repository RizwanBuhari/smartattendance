const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

const db = getFirestore();

async function run() {
  console.log("Fetching admins...");
  const snap = await db.collection('admins').get();
  console.log(`Found ${snap.size} admins:`);
  snap.forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    const data = doc.data();
    console.log(`- Email: ${data.email}`);
    console.log(`- Role: ${data.role}`);
    console.log("-----------------------------------------");
  });
}

run().catch(console.error);
