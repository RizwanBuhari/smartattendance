const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

const db = getFirestore();

async function run() {
  console.log("Fetching offsite requests...");
  const snap = await db.collection('offsite_requests').get();
  console.log(`Found ${snap.size} requests:`);
  snap.forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    const data = doc.data();
    console.log(`- Status: ${data.status}`);
    console.log(`- Employee: ${data.employeeName} (${data.employeeId} / ${data.employeeUid})`);
    console.log(`- Supervisor: ${data.supervisorName} (${data.supervisorId} / ${data.supervisorUid})`);
    console.log(`- Worksite: ${data.worksiteName}`);
    console.log("-----------------------------------------");
  });
}

run().catch(console.error);
