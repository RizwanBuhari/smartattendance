// Data access for employees — now backed by the NestJS backend (Firestore).
import { apiGet, apiSend } from './api'

export async function getEmployees() {
  return apiGet('/employees')
}

export async function createEmployee(employee) {
  return apiSend('POST', '/employees', employee)
}

// Deletes an employee (and their invite codes, server-side).
export async function deleteEmployee(id) {
  return apiSend('DELETE', `/employees/${id}`)
}

export async function setEmployeeStatus(id, status) {
  return apiSend('PATCH', `/employees/${id}`, { status })
}

export async function setEmployeeLocations(id, assignedLocationIds) {
  return apiSend('PATCH', `/employees/${id}`, { assignedLocationIds })
}

// Promotes an employee to site admin (or back to a normal employee). A site
// admin can issue one-time check-in codes for the locations they are assigned
// to, so this is effectively granting approval authority over those sites.
export async function setEmployeeRole(id, role) {
  return apiSend('PATCH', `/employees/${id}`, { role })
}

// Issues a single-use company code (in the company_codes collection). Pass an
// employeeId to tie it to an existing employee, or omit it to issue a standalone
// code for a brand-new user (who supplies name/email when they register).
export async function createInvite(employeeId) {
  return apiSend('POST', '/company-codes', employeeId ? { employeeId } : {})
}

// All company codes — used to show each employee's invite status.
export async function getCompanyCodes() {
  return apiGet('/company-codes')
}

// Deletes (revokes) a company code by its id.
export async function deleteCompanyCode(id) {
  return apiSend('DELETE', `/company-codes/${id}`)
}

// Re-enables a used code so it can be entered again (e.g. the employee entered
// it but never finished registering).
export async function reactivateCompanyCode(id) {
  return apiSend('POST', `/company-codes/${id}/reactivate`)
}
