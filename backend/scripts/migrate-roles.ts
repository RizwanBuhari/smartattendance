/**
 * One-off migration: rewrite legacy employee role values to the canonical set.
 *
 *   onsite_employee  -> office_employee   (Office employee)
 *   employee         -> office_employee
 *   offsite_employee -> site_employee     (Site employee)
 *   siteAdmin        -> site_supervisor
 *
 * Canonical values (office_employee / site_employee / site_supervisor) are left
 * untouched. The backend keeps accepting the legacy values via normalizeRole(),
 * so running this is safe at any time and safe to run more than once
 * (idempotent) — a second run finds nothing left to change.
 *
 * SAFETY:
 *   • Dry-run by DEFAULT. It prints exactly what it WOULD change and writes
 *     nothing. Pass `--commit` to actually write.
 *   • Only the `role` field is touched; attendance/checkout records are never
 *     modified, so historical data is preserved.
 *   • No secrets are printed — only doc ids, names and role values.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/migrate-roles.ts            # dry run
 *   npx ts-node scripts/migrate-roles.ts --commit   # apply
 *
 * Requires ./serviceAccountKey.json (same key main.ts uses); it is read locally
 * and never logged.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Kept in lockstep with normalizeRole() in src/employees/employees.service.ts.
const LEGACY_TO_CANONICAL: Record<string, string> = {
  onsite_employee: 'office_employee',
  employee: 'office_employee',
  offsite_employee: 'site_employee',
  siteAdmin: 'site_supervisor',
};

async function main() {
  const commit = process.argv.includes('--commit');

  initializeApp({ credential: cert('./serviceAccountKey.json') });
  const db = getFirestore();

  const snap = await db.collection('employees_ids').get();
  let changed = 0;
  let unchanged = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as { role?: string; name?: string };
    const current = data.role ?? '';
    const next = LEGACY_TO_CANONICAL[current];

    if (!next) {
      unchanged++;
      continue;
    }

    changed++;
    // eslint-disable-next-line no-console
    console.log(
      `${commit ? 'UPDATE' : 'WOULD UPDATE'} ${doc.id} (${data.name ?? 'unnamed'}): ${current} -> ${next}`,
    );

    if (commit) {
      await doc.ref.update({
        role: next,
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Lightweight audit trail of the migration itself.
      await db.collection('role_audit_logs').add({
        employeeId: doc.id,
        employeeName: data.name ?? doc.id,
        changedBy: 'role-migration-script',
        changedAt: FieldValue.serverTimestamp(),
        previousRole: current,
        newRole: next,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n${commit ? 'Applied' : 'Dry run —'} ${changed} role(s) ${commit ? 'migrated' : 'to migrate'}; ${unchanged} already canonical/empty. Total ${snap.size}.`,
  );
  if (!commit && changed > 0) {
    // eslint-disable-next-line no-console
    console.log('Re-run with --commit to apply.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Migration failed:', err);
    process.exit(1);
  });
