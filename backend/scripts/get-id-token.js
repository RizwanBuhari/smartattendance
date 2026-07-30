// Prints a Firebase ID token for an existing account, for manual API testing.
//
// Why this is needed: every guarded route wants `Authorization: Bearer <ID
// token>`, and an ID token can only come from a real sign-in. Normally that
// means logging into the dashboard and digging the token out of the browser.
// This script skips the browser entirely.
//
//   node scripts/get-id-token.js admin@example.com
//
// How it works, in two hops:
//   1. The Admin SDK (serviceAccountKey.json) mints a CUSTOM token for the uid.
//      This needs no password — the service account is already trusted.
//   2. That custom token is exchanged for an ID token via Identity Toolkit,
//      which is the same REST API the mobile app's SDK uses under the hood.
//
// The token is valid for one hour, and carries whatever custom claims the
// account already has. Note that being able to sign in is NOT the same as being
// an admin: AdminGuard additionally requires the email to be listed in
// admin_Users (see scripts/dump-admins.js).
// quiet: true matters more than it looks. dotenv v17 prints an "injected env"
// banner to STDOUT, which would end up glued to the front of the token and make
// it an invalid header value — the server rejects it with a bare 400 that is
// very hard to diagnose. Keeping stdout clean is what makes `| clip` work.
require('dotenv').config({ quiet: true });
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const emailOrUid = process.argv[2];
if (!emailOrUid) {
  console.error('Usage: node scripts/get-id-token.js <email|uid>');
  process.exit(1);
}

const apiKey = (process.env.FIREBASE_API_KEY || '').replace(/^["']|["']$/g, '');
if (!apiKey) {
  console.error(
    'FIREBASE_API_KEY is missing from backend/.env — the exchange in step 2 needs it.',
  );
  process.exit(1);
}

initializeApp({ credential: cert('./serviceAccountKey.json') });

async function run() {
  // An email is friendlier to type, but a uid works too — accept either.
  const user = emailOrUid.includes('@')
    ? await getAuth().getUserByEmail(emailOrUid)
    : await getAuth().getUser(emailOrUid);

  const customToken = await getAuth().createCustomToken(user.uid);

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );

  const body = await response.json();
  if (!response.ok || !body.idToken) {
    throw new Error(`Token exchange failed: ${JSON.stringify(body)}`);
  }

  // Everything explanatory goes to stderr so that stdout is the token and
  // nothing else — that keeps `node scripts/get-id-token.js x | clip` usable.
  console.error(`Signed in as ${user.email ?? user.uid} — valid for 1 hour.`);
  console.log(body.idToken);
}

run().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
