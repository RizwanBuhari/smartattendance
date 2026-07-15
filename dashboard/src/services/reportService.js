// Builds and downloads an attendance report for ONE employee as an Excel
// workbook (.xlsx), entirely in the browser. From the Employees table each row
// has a "Report" button that offers three period scopes — daily, monthly, and
// yearly — all measured relative to today in the office timezone.
//
// Everything in the workbook is filtered to that employee. Attendance and
// location pings are keyed by `employeeId`, which may be the employee's doc id
// OR their Firebase UID (`authUid`), so we match on either key.
//
// The workbook has four sheets:
//   1. Timesheet        — one row per attendance session (check-in/out, hours,
//                         overtime, punctuality, location).
//   2. Summary          — this employee's totals for the period.
//   3. Location heat-map — a lat/long density grid coloured green→red, so the
//                         areas where they spent the most time stand out.
//   4. Location points  — the raw coordinate samples behind the heat-map.
import { getAttendance } from './attendanceService'
import { getLocationPingsForEmployee } from './locationPingsService'
import { localDateISO, localTime } from '../utils/time'
import { punctuality, overtimeHours } from '../utils/attendance'

// Office timezone offset (Dubai, UTC+4) — matches the backend. Used only to
// decide which local day/month/year a record falls in.
const TZ_OFFSET_MINUTES = 240

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB0000A' } }
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }

// Turns 'daily' | 'monthly' | 'yearly' into a period: a human label and a
// matcher that tells whether a given local date 'YYYY-MM-DD' belongs to it.
function periodInfo(period) {
  const nowLocal = new Date(Date.now() + TZ_OFFSET_MINUTES * 60000)
  const iso = nowLocal.toISOString()

  let prefix
  if (period === 'daily') prefix = iso.slice(0, 10)
  else if (period === 'monthly') prefix = iso.slice(0, 7)
  else prefix = iso.slice(0, 4)

  const labels = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly' }
  return {
    label: `${labels[period]} report — ${prefix}`,
    prefix,
    matches: (localDate) => !!localDate && localDate.startsWith(prefix),
  }
}

function tzOf(record) {
  return record.tzOffsetMinutes ?? TZ_OFFSET_MINUTES
}

// Hours between two UTC timestamps as a number (null if the shift is still open).
function hoursBetween(checkInUtc, checkOutUtc) {
  if (!checkInUtc || !checkOutUtc) return null
  return (new Date(checkOutUtc) - new Date(checkInUtc)) / 3600000
}

function slug(text) {
  return (text || 'employee').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
}

// --- Sheet 1: per-session timesheet ---
function buildTimesheet(wb, records, employeeName, info) {
  const ws = wb.addWorksheet('Timesheet')
  ws.mergeCells('A1:I1')
  ws.getCell('A1').value = `${employeeName} — ${info.label}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.addRow([])

  const header = ws.addRow([
    'Date',
    'Check-in',
    'Check-out',
    'Hours worked',
    'Overtime (h)',
    'Late by (min)',
    'Punctuality',
    'Location',
    'Outside geofence',
  ])
  styleHeaderRow(header)

  for (const r of records) {
    const tz = tzOf(r)
    const p = punctuality(r.checkInUtc, tz)
    const worked = hoursBetween(r.checkInUtc, r.checkOutUtc)
    const ot = overtimeHours(r.checkInUtc, r.checkOutUtc)
    ws.addRow([
      localDateISO(r.checkInUtc, tz),
      localTime(r.checkInUtc, tz),
      r.checkOutUtc ? localTime(r.checkOutUtc, tz) : '—',
      worked == null ? '—' : Number(worked.toFixed(2)),
      ot > 0 ? Number(ot.toFixed(2)) : 0,
      p.lateMinutes,
      p.late ? 'Late' : 'On time',
      r.locationName ?? '—',
      r.flaggedOutside ? 'Yes' : 'No',
    ])
  }

  if (records.length === 0) {
    ws.addRow(['No attendance in this period.'])
  }

  ws.columns.forEach((col, i) => {
    col.width = [12, 10, 10, 13, 13, 13, 12, 20, 16][i] ?? 14
  })
  ws.views = [{ state: 'frozen', ySplit: 3 }]
  return ws
}

// --- Sheet 2: this employee's totals for the period ---
function buildSummary(wb, records, employee, info) {
  const ws = wb.addWorksheet('Summary')
  ws.mergeCells('A1:B1')
  ws.getCell('A1').value = `${employee.name} — ${info.label}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.addRow([])

  const days = new Set()
  let hours = 0
  let ot = 0
  let late = 0
  let flagged = 0
  for (const r of records) {
    const tz = tzOf(r)
    days.add(localDateISO(r.checkInUtc, tz))
    hours += hoursBetween(r.checkInUtc, r.checkOutUtc) ?? 0
    ot += overtimeHours(r.checkInUtc, r.checkOutUtc)
    if (punctuality(r.checkInUtc, tz).late) late += 1
    if (r.flaggedOutside) flagged += 1
  }
  const dayCount = days.size

  const rows = [
    ['Employee', employee.name ?? '—'],
    ['Email', employee.email ?? '—'],
    ['Days present', dayCount],
    ['Total hours', Number(hours.toFixed(2))],
    ['Total overtime (h)', Number(ot.toFixed(2))],
    ['Avg hours/day', dayCount ? Number((hours / dayCount).toFixed(2)) : 0],
    ['Late days', late],
    ['Flagged sessions (left geofence)', flagged],
  ]
  for (const [label, value] of rows) {
    const row = ws.addRow([label, value])
    row.getCell(1).font = { bold: true }
  }

  ws.getColumn(1).width = 32
  ws.getColumn(2).width = 24
  return ws
}

// Collects every coordinate sample in the period from both this employee's
// background pings and their attendance check-in/out coordinates.
function collectPoints(records, pings, employeeName, info) {
  const points = []
  for (const p of pings) {
    const tz = p.tzOffsetMinutes ?? TZ_OFFSET_MINUTES
    const local = localDateISO(p.timestamp, tz)
    if (!info.matches(local)) continue
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue
    points.push({
      employee: p.employeeName ?? employeeName,
      time: `${local} ${localTime(p.timestamp, tz)}`,
      lat: p.lat,
      lng: p.lng,
      inside: p.insideGeofence ? 'Yes' : 'No',
      location: p.locationName ?? '—',
      source: 'Tracking ping',
    })
  }
  for (const r of records) {
    const tz = tzOf(r)
    const add = (coords, whichUtc, source) => {
      if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return
      points.push({
        employee: r.employeeName ?? employeeName,
        time: `${localDateISO(whichUtc, tz)} ${localTime(whichUtc, tz)}`,
        lat: coords.lat,
        lng: coords.lng,
        inside: r.flaggedOutside ? 'No' : 'Yes',
        location: r.locationName ?? '—',
        source,
      })
    }
    add(r.checkInCoords, r.checkInUtc, 'Check-in')
    add(r.checkOutCoords, r.checkOutUtc, 'Check-out')
  }
  return points
}

// --- Sheet 3: location heat-map (density grid, coloured green→red) ---
function buildHeatmap(wb, points, employeeName, info) {
  const ws = wb.addWorksheet('Location heat-map')
  ws.mergeCells('A1:M1')
  ws.getCell('A1').value = `${employeeName} — location heat-map (${info.label})`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.mergeCells('A2:M2')
  ws.getCell('A2').value =
    'Each cell counts location samples that fell in that latitude/longitude area. Warmer (red) = more time spent there.'
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } }

  if (points.length === 0) {
    ws.getCell('A4').value = 'No location data was recorded for this period.'
    return ws
  }

  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)
  let minLng = Math.min(...lngs)
  let maxLng = Math.max(...lngs)
  // Guard against a zero-width span (all points at one spot).
  if (maxLat - minLat < 1e-6) {
    minLat -= 0.0005
    maxLat += 0.0005
  }
  if (maxLng - minLng < 1e-6) {
    minLng -= 0.0005
    maxLng += 0.0005
  }

  const GRID = 12
  const latStep = (maxLat - minLat) / GRID
  const lngStep = (maxLng - minLng) / GRID
  const matrix = Array.from({ length: GRID }, () => Array(GRID).fill(0))
  const clamp = (v) => Math.max(0, Math.min(GRID - 1, v))
  for (const p of points) {
    const row = clamp(Math.floor((maxLat - p.lat) / latStep)) // top = highest lat
    const col = clamp(Math.floor((p.lng - minLng) / lngStep))
    matrix[row][col] += 1
  }

  const FIRST_ROW = 4 // grid header row
  const FIRST_COL = 2 // column B holds the first data column
  const headerCells = ['Lat \\ Lng']
  for (let c = 0; c < GRID; c++) {
    headerCells.push(Number((minLng + lngStep * (c + 0.5)).toFixed(5)))
  }
  const headerRow = ws.getRow(FIRST_ROW)
  headerCells.forEach((v, i) => {
    headerRow.getCell(1 + i).value = v
  })
  styleHeaderRow(headerRow)

  for (let r = 0; r < GRID; r++) {
    const row = ws.getRow(FIRST_ROW + 1 + r)
    row.getCell(1).value = Number((maxLat - latStep * (r + 0.5)).toFixed(5))
    row.getCell(1).font = { bold: true }
    for (let c = 0; c < GRID; c++) {
      const cell = row.getCell(FIRST_COL + c)
      cell.value = matrix[r][c]
      cell.alignment = { horizontal: 'center' }
    }
  }

  // Colour scale across the whole grid: low = green, high = red.
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + FIRST_COL - 1 + GRID - 1)
  const ref = `B${FIRST_ROW + 1}:${lastCol}${FIRST_ROW + GRID}`
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'colorScale',
        priority: 1,
        cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
        color: [
          { argb: 'FF63BE7B' }, // green (few visits)
          { argb: 'FFFFEB84' }, // yellow
          { argb: 'FFF8696B' }, // red (many visits)
        ],
      },
    ],
  })

  ws.getColumn(1).width = 12
  for (let c = 0; c < GRID; c++) ws.getColumn(FIRST_COL + c).width = 9
  return ws
}

// --- Sheet 4: raw coordinate samples behind the heat-map ---
function buildPoints(wb, points) {
  const ws = wb.addWorksheet('Location points')
  const header = ws.addRow([
    'Time (local)',
    'Latitude',
    'Longitude',
    'Inside geofence',
    'Location',
    'Source',
  ])
  styleHeaderRow(header)
  for (const p of points) {
    ws.addRow([p.time, p.lat, p.lng, p.inside, p.location, p.source])
  }
  if (points.length === 0) ws.addRow(['No location data in this period.'])
  ws.columns.forEach((col, i) => {
    col.width = [18, 12, 12, 15, 20, 14][i] ?? 14
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return ws
}

function triggerDownload(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Public entry point. `employee` is the row object ({ id, authUid?, name, ... });
// `period` is 'daily' | 'monthly' | 'yearly'. All data is filtered to this
// employee and this period.
export async function downloadEmployeeReport(employee, period) {
  const info = periodInfo(period)
  const name = employee.name ?? 'Employee'

  // Keys attendance/pings might be filed under for this person.
  const keys = [employee.id, employee.authUid].filter(Boolean)
  const keySet = new Set(keys)

  // exceljs is heavy (~fat bundle); load it only when a report is requested.
  const [ExcelJS, attendance, pingLists] = await Promise.all([
    import('exceljs').then((m) => m.default),
    getAttendance(),
    // Fetch pings under each possible key; best-effort so a failure here
    // doesn't sink the whole report.
    Promise.all(
      keys.map((k) => getLocationPingsForEmployee(k).catch(() => [])),
    ),
  ])

  const records = attendance.filter(
    (r) => keySet.has(r.employeeId) && info.matches(localDateISO(r.checkInUtc, tzOf(r))),
  )
  const pings = pingLists.flat()
  const points = collectPoints(records, pings, name, info)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Smart Attendance'
  wb.created = new Date()

  buildTimesheet(wb, records, name, info)
  buildSummary(wb, records, employee, info)
  buildHeatmap(wb, points, name, info)
  buildPoints(wb, points)

  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(buffer, `report-${slug(name)}-${period}-${info.prefix}.xlsx`)
}
