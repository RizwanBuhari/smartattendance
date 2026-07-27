// Single source of truth for role meaning + display in the dashboard.
//
// Mirrors normalizeRole() in the backend (src/employees/employees.service.ts):
// the dashboard reads Firestore directly and may see un-migrated legacy role
// values, so every screen classifies/labels roles through here rather than
// comparing raw strings.
//
// Canonical roles and their user-facing names:
//   office_employee  -> "Office employee"  (formerly Onsite Employee)
//   site_employee    -> "Site employee"    (formerly Offsite employee)
//   site_supervisor  -> "Site Supervisor"

export function normalizeRole(role) {
  if (role === 'siteAdmin' || role === 'site_supervisor') return 'site_supervisor'
  if (role === 'offsite_employee' || role === 'site_employee') return 'site_employee'
  return 'office_employee'
}

export const ROLE_LABELS = {
  office_employee: 'Office employee',
  site_employee: 'Site employee',
  site_supervisor: 'Site Supervisor',
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)]
}

export function isSupervisorRole(role) {
  return normalizeRole(role) === 'site_supervisor'
}

export function isSiteEmployeeRole(role) {
  return normalizeRole(role) === 'site_employee'
}
