// Integration test for the one-time check-in code service.
//
// Drives the REAL OtpService against the REAL Redis container, so it proves the
// actual behaviour rather than a mock of it.
//
// RUN:  docker compose up -d          (Redis must be reachable on :6379)
//       cd backend && npm run build   (this script uses the compiled output)
//       node scripts/test-otp.js
//
// It creates two temporary employee documents in Firestore, prefixed
// "__otptest__", and DELETES them again at the end — including if a test fails.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const serviceAccount = require('../serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const { RedisService } = require('../dist/redis/redis.service');
const { OtpService } = require('../dist/otp/otp.service');

const SITE = 'site-alpha';
const OTHER_SITE = 'site-beta';
const ADMIN_ID = '__otptest__siteadmin';
const EMP_ID = '__otptest__employee';
const PLAIN_ID = '__otptest__plain';
const DISABLED_ID = '__otptest__disabled';

let passed = 0;
let failed = 0;

function ok(name) {
  console.log(`  PASS  ${name}`);
  passed++;
}
function bad(name, detail) {
  console.log(`  FAIL  ${name}\n          -> ${detail}`);
  failed++;
}

// Asserts the call throws, and that the message/status looks like `expect`.
async function expectThrows(name, fn, expect) {
  try {
    await fn();
    bad(name, 'expected it to be rejected, but it succeeded');
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!expect || msg.toLowerCase().includes(expect.toLowerCase())) ok(name);
    else bad(name, `wrong error: "${msg}" (wanted something like "${expect}")`);
  }
}

async function seed() {
  await db.collection('employees_ids').doc(ADMIN_ID).set({
    name: 'Test Site Admin',
    email: 'siteadmin@test.local',
    status: 'active',
    role: 'siteAdmin',
    assignedLocationIds: [SITE],
  });
  await db.collection('employees_ids').doc(EMP_ID).set({
    name: 'Test Employee',
    email: 'employee@test.local',
    status: 'active',
    role: 'employee',
    assignedLocationIds: [SITE],
  });
  await db.collection('employees_ids').doc(PLAIN_ID).set({
    name: 'Test Plain',
    email: 'plain@test.local',
    status: 'active',
    role: 'employee',
    assignedLocationIds: [SITE],
  });
  await db.collection('employees_ids').doc(DISABLED_ID).set({
    name: 'Test Disabled',
    email: 'disabled@test.local',
    status: 'disabled',
    role: 'employee',
    assignedLocationIds: [SITE],
  });
}

async function cleanup(redis) {
  for (const id of [ADMIN_ID, EMP_ID, PLAIN_ID, DISABLED_ID]) {
    await db.collection('employees_ids').doc(id).delete().catch(() => {});
    await redis.del(
      `otp:checkin:${id}`,
      `otp:attempts:${id}`,
      `otp:lockout:${id}`,
    );
  }
}

async function main() {
  const redis = new RedisService();
  // Give ioredis a moment to connect before the first command.
  await new Promise((r) => setTimeout(r, 1500));

  const otp = new OtpService(redis);
  await seed();

  console.log('\n--- AUTHORISATION: who may issue a code ---');

  await expectThrows(
    'a plain employee cannot issue codes',
    () =>
      otp.issueCode({
        issuedByEmployeeId: PLAIN_ID,
        targetEmployeeId: EMP_ID,
        locationId: SITE,
      }),
    'site admin',
  );

  await expectThrows(
    'a site admin cannot issue for a site they are not assigned to',
    () =>
      otp.issueCode({
        issuedByEmployeeId: ADMIN_ID,
        targetEmployeeId: EMP_ID,
        locationId: OTHER_SITE,
      }),
    'not a site admin for this location',
  );

  await expectThrows(
    'cannot issue a code to a disabled employee',
    () =>
      otp.issueCode({
        issuedByEmployeeId: ADMIN_ID,
        targetEmployeeId: DISABLED_ID,
        locationId: SITE,
      }),
    'disabled',
  );

  console.log('\n--- ISSUING ---');

  const issued = await otp.issueCode({
    issuedByEmployeeId: ADMIN_ID,
    targetEmployeeId: EMP_ID,
    locationId: SITE,
  });

  /^\d{6}$/.test(issued.code)
    ? ok(`code is exactly 6 digits (${issued.code})`)
    : bad('code is 6 digits', `got "${issued.code}"`);

  issued.expiresInSeconds === 60
    ? ok('TTL reported as 60 seconds')
    : bad('TTL is 60s', `got ${issued.expiresInSeconds}`);

  const liveTtl = await redis.ttl(`otp:checkin:${EMP_ID}`);
  liveTtl > 50 && liveTtl <= 60
    ? ok(`Redis really expires the key (TTL=${liveTtl}s)`)
    : bad('Redis TTL is ~60s', `TTL=${liveTtl}`);

  console.log('\n--- VERIFYING ---');

  const wrong = issued.code === '000000' ? '111111' : '000000';
  await expectThrows(
    'a wrong code is rejected',
    () => otp.verifyCode(EMP_ID, wrong),
    'incorrect code',
  );

  await expectThrows(
    "another employee cannot use someone else's code",
    () => otp.verifyCode(PLAIN_ID, issued.code),
    'expired',
  );

  const result = await otp.verifyCode(EMP_ID, issued.code);
  result.locationId === SITE && result.issuedBy === ADMIN_ID
    ? ok('correct code accepted, returns site + issuer for the audit trail')
    : bad('verify returns payload', JSON.stringify(result));

  // The bug the original code had: it never deleted the code on success.
  await expectThrows(
    'THE SAME CODE CANNOT BE USED TWICE (single-use)',
    () => otp.verifyCode(EMP_ID, issued.code),
    'expired',
  );

  console.log('\n--- BRUTE-FORCE LOCKOUT ---');

  const fresh = await otp.issueCode({
    issuedByEmployeeId: ADMIN_ID,
    targetEmployeeId: EMP_ID,
    locationId: SITE,
  });
  const notIt = fresh.code === '000000' ? '111111' : '000000';

  let lockedAt = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await otp.verifyCode(EMP_ID, notIt);
    } catch (err) {
      if ((err.message || '').toLowerCase().includes('too many')) {
        lockedAt = attempt;
        break;
      }
    }
  }
  lockedAt === 5
    ? ok(`locks out on the 5th wrong attempt`)
    : bad('lockout at 5 attempts', `locked out at attempt ${lockedAt}`);

  // Once locked out, even the CORRECT code must fail.
  await expectThrows(
    'while locked out, even the correct code is refused',
    () => otp.verifyCode(EMP_ID, fresh.code),
    'too many',
  );

  console.log('\n--- CLEANUP ---');
  await cleanup(redis);
  ok('temporary test employees and Redis keys removed');

  console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
  redis.onModuleDestroy();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\nTest run crashed:', err);
  try {
    const r = new RedisService();
    await new Promise((res) => setTimeout(res, 500));
    await cleanup(r);
    r.onModuleDestroy();
  } catch {}
  process.exit(1);
});
