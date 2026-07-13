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
