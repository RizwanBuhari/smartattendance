/// Canonical employee roles + normalization for the mobile app.
///
/// Mirrors normalizeRole() in the backend
/// (backend/src/employees/employees.service.ts). Records may still carry LEGACY
/// role values until the backend migration runs, and the app must keep working
/// for both, so every role decision in the UI goes through normalizeRole()
/// rather than comparing raw strings. Without this, a migrated "site_employee"
/// would fall through to the office default and lose its site screens.
///
/// User-facing names:
///   office_employee -> "Office employee" (formerly "Onsite Employee")
///   site_employee   -> "Site employee"   (formerly "Offsite employee")
///   site_supervisor -> "Site Supervisor"
library;

const String roleOfficeEmployee = 'office_employee';
const String roleSiteEmployee = 'site_employee';
const String roleSiteSupervisor = 'site_supervisor';

String normalizeRole(String? role) {
  if (role == 'siteAdmin' || role == 'site_supervisor') {
    return roleSiteSupervisor;
  }
  if (role == 'offsite_employee' || role == 'site_employee') {
    return roleSiteEmployee;
  }
  // onsite_employee / employee / null / anything else.
  return roleOfficeEmployee;
}

bool isSupervisorRole(String? role) =>
    normalizeRole(role) == roleSiteSupervisor;

bool isSiteEmployeeRole(String? role) =>
    normalizeRole(role) == roleSiteEmployee;

bool isOfficeEmployeeRole(String? role) =>
    normalizeRole(role) == roleOfficeEmployee;
