// Temporary in-memory sample data so the dashboard is usable BEFORE the
// NestJS backend exists. Once the backend is ready, the service files
// (employeesService.js, etc.) will fetch from it and this file can be deleted.
//
// The shapes here mirror the fields required by the project spec.

export const mockLocations = [
  {
    id: 'loc1',
    name: 'Dubai Head Office',
    latitude: 25.1189,
    longitude: 55.3773,
    radiusMeters: 150,
  },
  {
    id: 'loc2',
    name: 'Silicon Oasis Site',
    latitude: 25.1206,
    longitude: 55.3877,
    radiusMeters: 100,
  },
]

export const mockEmployees = [
  {
    id: 'emp1',
    name: 'Amash Aal',
    email: 'amash@example.com',
    status: 'active', // 'active' | 'disabled'
    assignedLocationIds: ['loc1'],
  },
  {
    id: 'emp2',
    name: 'Rizwan Buhari',
    email: 'rizwan@example.com',
    status: 'active',
    assignedLocationIds: ['loc1', 'loc2'],
  },
  {
    id: 'emp3',
    name: 'Sara Khan',
    email: 'sara@example.com',
    status: 'disabled',
    assignedLocationIds: [],
  },
]

export const mockAttendance = [
  {
    id: 'att1',
    employeeId: 'emp1',
    employeeName: 'Amash Aal',
    // All timestamps are stored in UTC (per the spec). We only convert to
    // local time when displaying — see src/utils/time.js.
    checkInUtc: '2026-07-13T05:02:00Z',
    checkOutUtc: '2026-07-13T13:31:00Z',
    tzOffsetMinutes: 240, // UTC+4 (Dubai)
    checkInCoords: { lat: 25.119, lng: 55.3774 },
    checkOutCoords: { lat: 25.1188, lng: 55.3772 },
    gpsAccuracy: 8, // meters
    deviceId: 'device-abc-123',
    status: 'checked_out', // 'checked_in' | 'checked_out' | 'left_area'
    locationEvents: [
      { time: '2026-07-13T05:02:00Z', type: 'check_in', inside: true, accuracy: 8 },
      { time: '2026-07-13T09:15:00Z', type: 'heartbeat', inside: true, accuracy: 12 },
      { time: '2026-07-13T13:31:00Z', type: 'check_out', inside: true, accuracy: 6 },
    ],
  },
  {
    id: 'att2',
    employeeId: 'emp2',
    employeeName: 'Rizwan Buhari',
    checkInUtc: '2026-07-13T04:55:00Z',
    checkOutUtc: null, // still checked in
    tzOffsetMinutes: 240,
    checkInCoords: { lat: 25.1205, lng: 55.3878 },
    checkOutCoords: null,
    gpsAccuracy: 15,
    deviceId: 'device-def-456',
    status: 'left_area', // detected leaving the approved area
    locationEvents: [
      { time: '2026-07-13T04:55:00Z', type: 'check_in', inside: true, accuracy: 10 },
      { time: '2026-07-13T07:40:00Z', type: 'exit', inside: false, accuracy: 18 },
    ],
  },
]
