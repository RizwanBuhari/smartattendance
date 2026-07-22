const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

const db = getFirestore();

async function run() {
  console.log("Fetching employees...");
  const snap = await db.collection('employees_ids').get();
  console.log(`Found ${snap.size} employees:`);
  snap.forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    const data = doc.data();
    console.log(`- Name: ${data.name}`);
    console.log(`- Email: ${data.email}`);
    console.log(`- Role: ${data.role}`);
    console.log(`- authUid: ${data.authUid}`);
    console.log(`- supervisorId: ${data.supervisorId}`);
    console.log("-----------------------------------------");
  });
}

run().catch(console.error);
