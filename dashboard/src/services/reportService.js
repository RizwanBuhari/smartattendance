// Serializes an attendance report into an Excel workbook (.xlsx), entirely in
// the browser. It takes data the Reports page has ALREADY computed (see
// utils/reportData), so the download is exactly what's shown on screen — for a
// single employee or the whole company, over a daily / monthly / yearly period.
//
// The workbook has four sheets, mirroring the page's tabs:
//   1. Timesheet        — one row per attendance session.
//   2. Summary          — company breakdown (per employee) or one employee's totals.
//   3. Location heat-map — a lat/long density grid coloured green→red.
//   4. Location points  — the raw coordinate samples behind the heat-map.
import { buildHeatmapMatrix } from '../utils/reportData'

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB0000A' } }
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }

function slug(text) {
  return (text || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
}

function num(value, digits = 2) {
  return value == null ? '—' : Number(value.toFixed(digits))
}

// --- Sheet 1: per-session timesheet ---
function buildTimesheet(wb, timesheet, scopeLabel, info, single) {
  const ws = wb.addWorksheet('Timesheet')
  const cols = single
    ? ['Date', 'Check-in', 'Check-out', 'Hours worked', 'Overtime (h)', 'Late by (min)', 'Punctuality', 'Location', 'Outside geofence']
    : ['Employee', 'Date', 'Check-in', 'Check-out', 'Hours worked', 'Overtime (h)', 'Late by (min)', 'Punctuality', 'Location', 'Outside geofence']

  ws.mergeCells(1, 1, 1, cols.length)
  ws.getCell('A1').value = `${scopeLabel} — ${info.label}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.addRow([])

  styleHeaderRow(ws.addRow(cols))

  for (const r of timesheet) {
    const base = [
      r.date,
      r.checkIn,
      r.checkOut ?? '—',
      num(r.workedHours),
      r.overtime > 0 ? num(r.overtime) : 0,
      r.lateMinutes,
      r.late ? 'Late' : 'On time',
      r.location,
      r.flaggedOutside ? 'Yes' : 'No',
    ]
    ws.addRow(single ? base : [r.employeeName, ...base])
  }
  if (timesheet.length === 0) ws.addRow(['No attendance in this period.'])

  const widths = single
    ? [12, 10, 10, 13, 13, 13, 12, 20, 16]
    : [22, 12, 10, 10, 13, 13, 13, 12, 20, 16]
  ws.columns.forEach((col, i) => {
    col.width = widths[i] ?? 14
  })
  ws.views = [{ state: 'frozen', ySplit: 3 }]
  return ws
}

// --- Sheet 2: summary ---
function buildSummary(wb, { scopeLabel, info, single, summary, perEmployee, employeeMeta }) {
  const ws = wb.addWorksheet('Summary')

  if (single) {
    ws.mergeCells('A1:B1')
    ws.getCell('A1').value = `${scopeLabel} — ${info.label}`
    ws.getCell('A1').font = { bold: true, size: 14 }
    ws.addRow([])
    const rows = [
      ['Employee', employeeMeta?.name ?? scopeLabel],
      ['Email', employeeMeta?.email ?? '—'],
      ['Days present', summary.daysPresent],
      ['Sessions', summary.sessions],
      ['Total hours', num(summary.totalHours)],
      ['Total overtime (h)', num(summary.totalOvertime)],
      ['Avg hours/day', num(summary.avgHoursPerDay)],
      ['Late sessions', summary.lateSessions],
      ['Flagged sessions (left geofence)', summary.flaggedSessions],
      ['Open sessions (no check-out)', summary.openSessions],
    ]
    for (const [label, value] of rows) {
      const row = ws.addRow([label, value])
      row.getCell(1).font = { bold: true }
    }
    ws.getColumn(1).width = 34
    ws.getColumn(2).width = 26
    return ws
  }

  // Company breakdown: one row per employee, then a totals row.
  const cols = ['Employee', 'Days present', 'Sessions', 'Total hours', 'Overtime (h)', 'Avg hours/day', 'Late sessions', 'Flagged sessions']
  ws.mergeCells(1, 1, 1, cols.length)
  ws.getCell('A1').value = `${scopeLabel} — ${info.label}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.addRow([])
  styleHeaderRow(ws.addRow(cols))

  for (const e of perEmployee) {
    ws.addRow([
      e.name,
      e.daysPresent,
      e.sessions,
      num(e.totalHours),
      num(e.totalOvertime),
      num(e.avgHoursPerDay),
      e.lateSessions,
      e.flaggedSessions,
    ])
  }
  if (perEmployee.length === 0) ws.addRow(['No attendance in this period.'])

  const totals = ws.addRow([
    'All employees',
    summary.daysPresent,
    summary.sessions,
    num(summary.totalHours),
    num(summary.totalOvertime),
    num(summary.avgHoursPerDay),
    summary.lateSessions,
    summary.flaggedSessions,
  ])
  totals.eachCell((cell) => {
    cell.font = { bold: true }
  })

  ws.columns.forEach((col, i) => {
    col.width = [24, 13, 10, 12, 13, 13, 13, 15][i] ?? 14
  })
  ws.views = [{ state: 'frozen', ySplit: 3 }]
  return ws
}

// --- Sheet 3: location heat-map (density grid, coloured green→red) ---
function buildHeatmap(wb, points, scopeLabel, info) {
  const ws = wb.addWorksheet('Location heat-map')
  ws.mergeCells('A1:M1')
  ws.getCell('A1').value = `${scopeLabel} — location heat-map (${info.label})`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.mergeCells('A2:M2')
  ws.getCell('A2').value =
    'Each cell counts location samples in that latitude/longitude area. Warmer (red) = more time spent there.'
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } }

  const heat = buildHeatmapMatrix(points)
  if (!heat) {
    ws.getCell('A4').value = 'No location data was recorded for this period.'
    return ws
  }

  const { matrix, grid, maxLat, minLng, latStep, lngStep } = heat
  const FIRST_ROW = 4
  const FIRST_COL = 2
  const headerCells = ['Lat \\ Lng']
  for (let c = 0; c < grid; c++) {
    headerCells.push(Number((minLng + lngStep * (c + 0.5)).toFixed(5)))
  }
  const headerRow = ws.getRow(FIRST_ROW)
  headerCells.forEach((v, i) => {
    headerRow.getCell(1 + i).value = v
  })
  styleHeaderRow(headerRow)

  for (let r = 0; r < grid; r++) {
    const row = ws.getRow(FIRST_ROW + 1 + r)
    row.getCell(1).value = Number((maxLat - latStep * (r + 0.5)).toFixed(5))
    row.getCell(1).font = { bold: true }
    for (let c = 0; c < grid; c++) {
      const cell = row.getCell(FIRST_COL + c)
      cell.value = matrix[r][c]
      cell.alignment = { horizontal: 'center' }
    }
  }

  const lastCol = String.fromCharCode('A'.charCodeAt(0) + FIRST_COL - 1 + grid - 1)
  ws.addConditionalFormatting({
    ref: `B${FIRST_ROW + 1}:${lastCol}${FIRST_ROW + grid}`,
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
  for (let c = 0; c < grid; c++) ws.getColumn(FIRST_COL + c).width = 9
  return ws
}

// --- Sheet 4: raw coordinate samples behind the heat-map ---
function buildPoints(wb, points) {
  const ws = wb.addWorksheet('Location points')
  const header = ws.addRow([
    'Employee',
    'Time (local)',
    'Latitude',
    'Longitude',
    'Inside geofence',
    'Location',
    'Source',
  ])
  styleHeaderRow(header)
  for (const p of points) {
    ws.addRow([p.employee, p.time, p.lat, p.lng, p.inside ? 'Yes' : 'No', p.location, p.source])
  }
  if (points.length === 0) ws.addRow(['No location data in this period.'])
  ws.columns.forEach((col, i) => {
    col.width = [22, 18, 12, 12, 15, 20, 14][i] ?? 14
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

// Public entry point. Everything is already computed by the Reports page:
//   scopeLabel   — "All employees" or the employee's name
//   info         — periodInfo() ({ period, prefix, label, ... })
//   single       — true for a single-employee report
//   timesheet    — timesheetRows()
//   summary      — summarize() totals
//   perEmployee  — summarizeByEmployee() (company mode)
//   points       — collectPoints()
//   employeeMeta — { name, email } (single mode)
export async function exportReportExcel({
  scopeLabel,
  info,
  single,
  timesheet,
  summary,
  perEmployee = [],
  points = [],
  employeeMeta,
}) {
  // exceljs is heavy; load it only when an export is requested.
  const ExcelJS = await import('exceljs').then((m) => m.default)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Smart Attendance'
  wb.created = new Date()

  buildTimesheet(wb, timesheet, scopeLabel, info, single)
  buildSummary(wb, { scopeLabel, info, single, summary, perEmployee, employeeMeta })
  buildHeatmap(wb, points, scopeLabel, info)
  buildPoints(wb, points)

  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(buffer, `report-${slug(scopeLabel)}-${info.period}-${info.prefix}.xlsx`)
}
