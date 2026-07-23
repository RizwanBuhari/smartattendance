// Read-only diagnostic for the "site admin never gets the approval" problem.
//
// CodeRequestsService.notifySiteAdmins() finds who to alert with:
//   where('role', '==', 'siteAdmin')
//   where('assignedLocationIds', 'array-contains', <locationId>)
//   ...then keeps only status === 'active'
//
// All three have to hold. This prints each employee against those conditions so
// it is obvious which one is failing, and lists the device tokens that a push
// would actually be delivered to.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: cert('./serviceAccountKey.json') });
const db = getFirestore();

const APPROVER_ROLES = ['siteAdmin', 'site_supervisor'];

(async () => {
  const locs = await db.collection('locations_ids').get();
  const siteIds = [];
  locs.forEach((d) => {
    if (d.data().type === 'site') siteIds.push({ id: d.id, name: d.data().name });
  });
  console.log('Sites requiring approval:');
  siteIds.forEach((s) => console.log(`   ${s.name}  [${s.id}]`));

  console.log('\nEmployees:');
  const emps = await db.collection('employees_ids').get();
  emps.forEach((d) => {
    const x = d.data();
    const assigned = x.assignedLocationIds ?? [];
    console.log(`\n   ${x.name}  [${d.id}]`);
    console.log(`      role                : ${x.role}`);
    console.log(`      status              : ${x.status}`);
    console.log(`      assignedLocationIds : ${JSON.stringify(assigned)}`);
    console.log(
      `      matches CURRENT query (role === 'siteAdmin') : ${x.role === 'siteAdmin'}`,
    );
    console.log(
      `      would match WIDENED query (${APPROVER_ROLES.join('/')}) : ${APPROVER_ROLES.includes(x.role)}`,
    );
    siteIds.forEach((s) => {
      if (assigned.includes(s.id)) console.log(`      covers site: ${s.name}`);
    });
  });

  const tokens = await db.collection('device_Tokens').get();
  console.log(`\ndevice_Tokens documents: ${tokens.size}`);
  tokens.forEach((d) => {
    const n = (d.data().tokens ?? []).length;
    console.log(`   employeeId ${d.id} -> ${n} token(s)`);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
