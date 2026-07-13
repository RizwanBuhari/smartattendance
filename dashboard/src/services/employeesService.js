// Data access for employees — now backed by the NestJS backend (Firestore).
import { apiGet, apiSend } from './api'

export async function getEmployees() {
  return apiGet('/employees')
}

export async function createEmployee(employee) {
  return apiSend('POST', '/employees', employee)
}

export async function setEmployeeStatus(id, status) {
  return apiSend('PATCH', `/employees/${id}`, { status })
}

export async function setEmployeeLocations(id, assignedLocationIds) {
  return apiSend('PATCH', `/employees/${id}`, { assignedLocationIds })
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
