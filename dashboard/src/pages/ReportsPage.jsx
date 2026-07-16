// The admin's reporting hub. One generic report that the admin scopes with
// filters — the whole company or a single employee (searchable), over a daily,
// monthly, or yearly period — and reads on-screen across four tabs that mirror
// the Excel workbook: Timesheet, Summary, Location heat-map, Location points.
// "Export to Excel" downloads exactly what's shown.
import { useEffect, useMemo, useState } from 'react'
import { subscribeAttendance, subscribeCollection } from '../services/realtime'
import { getLocationPingsForEmployee } from '../services/locationPingsService'
import { exportReportExcel } from '../services/reportService'
import {
  periodInfo,
  defaultPeriodValue,
  filterRecords,
  timesheetRows,
  summarize,
  summarizeByEmployee,
  collectPoints,
} from '../utils/reportData'
import { formatHours, formatDuration } from '../utils/time'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'
import LocationMap from '../components/LocationMap'
import ReportCharts from '../components/ReportCharts'

const TABS = [
  { id: 'insights', label: 'Insights' },
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'summary', label: 'Summary' },
  { id: 'heatmap', label: 'Location heat-map' },
  { id: 'points', label: 'Location points' },
]

export default function ReportsPage() {
  const [attendance, setAttendance] = useState([])
  const [employees, setEmployees] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Filters.
  const [employeeId, setEmployeeId] = useState('all')
  const [empSearch, setEmpSearch] = useState('')
  const [period, setPeriod] = useState('monthly')
  const [periodValue, setPeriodValue] = useState(() => defaultPeriodValue('monthly'))
  const [activeTab, setActiveTab] = useState('insights')

  // Location pings are fetched per-employee and only when a location tab is
  // opened. `key` records which scope the cached pings belong to.
  const [pingState, setPingState] = useState({
    key: null,
    pings: [],
    loading: false,
    error: false,
  })
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const onErr = () => {
      setError(true)
      setLoading(false)
    }
    const unsubAttendance = subscribeAttendance((data) => {
      setAttendance(data)
      setError(false)
      setLoading(false)
    }, onErr)
    const unsubEmployees = subscribeCollection('employees', setEmployees, onErr)
    const unsubLocations = subscribeCollection('locations', setLocations, onErr)
    return () => {
      unsubAttendance()
      unsubEmployees()
      unsubLocations()
    }
  }, [])

  const selectedEmployee = useMemo(
    () => (employeeId === 'all' ? null : employees.find((e) => e.id === employeeId) ?? null),
    [employeeId, employees],
  )
  const scopeLabel = employeeId === 'all' ? 'All employees' : (selectedEmployee?.name ?? 'Employee')
  const single = employeeId !== 'all'
  const scopeKey = employeeId === 'all' ? `all:${employees.length}` : employeeId

  const info = useMemo(() => periodInfo(period, periodValue), [period, periodValue])
  const records = useMemo(
    () => filterRecords(attendance, { employee: selectedEmployee, info }),
    [attendance, selectedEmployee, info],
  )
  const timesheet = useMemo(() => timesheetRows(records), [records])
  const summary = useMemo(() => summarize(records), [records])
  const perEmployee = useMemo(() => summarizeByEmployee(records), [records])

  const pingsReady = pingState.key === scopeKey && !pingState.loading
  const points = useMemo(
    () => collectPoints(records, pingsReady ? pingState.pings : [], info),
    [records, pingsReady, pingState.pings, info],
  )

  // Which employees' pings to fetch for the current scope.
  const scopeEmployees = employeeId === 'all' ? employees : selectedEmployee ? [selectedEmployee] : []

  async function loadPings(list, key) {
    setPingState((s) => ({ ...s, loading: true, error: false }))
    try {
      const keys = [...new Set(list.flatMap((e) => [e.id, e.authUid].filter(Boolean)))]
      const lists = await Promise.all(
        keys.map((k) => getLocationPingsForEmployee(k).catch(() => [])),
      )
      const pings = lists.flat()
      setPingState({ key, pings, loading: false, error: false })
      return pings
    } catch {
      setPingState({ key, pings: [], loading: false, error: true })
      return []
    }
  }

  // Lazy-load pings the first time a location tab is opened for a given scope.
  useEffect(() => {
    const isLocationTab = activeTab === 'heatmap' || activeTab === 'points'
    if (!isLocationTab || loading) return
    if (pingState.key === scopeKey || pingState.loading) return
    loadPings(scopeEmployees, scopeKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, scopeKey, loading])

  function changePeriod(next) {
    setPeriod(next)
    setPeriodValue(defaultPeriodValue(next))
  }

  async function handleExport() {
    setExporting(true)
    try {
      // Make sure the location sheets reflect the current scope.
      let pings = pingState.key === scopeKey && !pingState.loading ? pingState.pings : null
      if (pings == null) pings = await loadPings(scopeEmployees, scopeKey)
      const pts = collectPoints(records, pings, info)
      await exportReportExcel({
        scopeLabel,
        info,
        single,
        timesheet,
        summary,
        perEmployee,
        points: pts,
        employeeMeta: selectedEmployee
          ? { name: selectedEmployee.name, email: selectedEmployee.email }
          : undefined,
      })
    } catch (err) {
      window.alert(`Couldn't export the report: ${err?.message ?? err}`)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <PageLoader />
  if (error)
    return (
      <div className="error">
        Couldn't load live data. If this persists, your Firestore security rules
        may be blocking reads — publish firestore.rules (Firebase Console →
        Firestore → Rules).
      </div>
    )

  const sortedEmployees = [...employees].sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  )
  const q = empSearch.trim().toLowerCase()
  let employeeOptions = q
    ? sortedEmployees.filter((e) => (e.name || '').toLowerCase().includes(q))
    : sortedEmployees
  // Keep the current selection visible even if the search would hide it.
  if (selectedEmployee && !employeeOptions.some((e) => e.id === selectedEmployee.id)) {
    employeeOptions = [selectedEmployee, ...employeeOptions]
  }

  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - i))

  const tiles = [
    ...(single ? [] : [{ label: 'Employees', value: perEmployee.length, icon: Icon.users, tone: 'brand' }]),
    { label: 'Sessions', value: summary.sessions, icon: Icon.list, tone: 'info' },
    { label: 'Days present', value: summary.daysPresent, icon: Icon.calendar, tone: 'good' },
    { label: 'Total hours', value: formatHours(summary.totalHours), icon: Icon.clock, tone: 'info' },
    { label: 'Overtime', value: formatHours(summary.totalOvertime), icon: Icon.trendingUp, tone: 'brand' },
    { label: 'Late', value: summary.lateSessions, icon: Icon.clock, tone: summary.lateSessions > 0 ? 'warn' : 'good' },
    { label: 'Flagged', value: summary.flaggedSessions, icon: Icon.alert, tone: summary.flaggedSessions > 0 ? 'alert' : 'good' },
  ]

  const pingsBusy = pingState.loading && pingState.key !== scopeKey

  return (
    <div className="reveal">
      <PageHead
        icon={Icon.chart}
        title="Reports"
        tone="info"
        hint={
          <>
            {scopeLabel} · {info.label}. Pick an employee (or the whole company)
            and a daily, monthly, or yearly period; the tabs below mirror the
            Excel export.
          </>
        }
        action={
          <button
            className="btn-sm btn-sm-primary"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <>
                <Spinner light /> Exporting…
              </>
            ) : (
              'Export to Excel'
            )}
          </button>
        }
      />

      <div className="filter-bar report-filters">
        <div className="search-field">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search employee…"
            value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)}
          />
        </div>

        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="all">All employees (company-wide)</option>
          {employeeOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <select value={period} onChange={(e) => changePeriod(e.target.value)}>
          <option value="daily">Daily</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>

        {period === 'daily' && (
          <input
            type="date"
            value={periodValue}
            onChange={(e) => setPeriodValue(e.target.value)}
          />
        )}
        {period === 'monthly' && (
          <input
            type="month"
            value={periodValue}
            onChange={(e) => setPeriodValue(e.target.value)}
          />
        )}
        {period === 'yearly' && (
          <select value={periodValue} onChange={(e) => setPeriodValue(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className={`stat-tile stat-tone-${t.tone}`}>
            <div className="stat-top">
              <span className="stat-icon">{t.icon}</span>
            </div>
            <div className="stat-value">{t.value}</div>
            <div className="stat-label">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="report-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`report-tab${activeTab === t.id ? ' report-tab-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'insights' && (
        <ReportCharts perEmployee={perEmployee} summary={summary} single={single} />
      )}
      {activeTab === 'timesheet' && (
        <TimesheetTab timesheet={timesheet} single={single} />
      )}
      {activeTab === 'summary' && (
        <SummaryTab
          single={single}
          summary={summary}
          perEmployee={perEmployee}
          employee={selectedEmployee}
        />
      )}
      {activeTab === 'heatmap' && (
        <HeatmapTab
          points={points}
          locations={locations}
          busy={pingsBusy}
          error={pingState.error}
        />
      )}
      {activeTab === 'points' && (
        <PointsTab
          points={points}
          locations={locations}
          busy={pingsBusy}
          error={pingState.error}
        />
      )}
    </div>
  )
}

function TimesheetTab({ timesheet, single }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {!single && <th>Employee</th>}
            <th>Date</th>
            <th>Check-in</th>
            <th>Check-out</th>
            <th>Worked</th>
            <th>Overtime</th>
            <th>Late by</th>
            <th>Punctuality</th>
            <th>Location</th>
            <th>Outside</th>
          </tr>
        </thead>
        <tbody>
          {timesheet.length === 0 && (
            <tr>
              <td colSpan={single ? 9 : 10} className="filter-empty">
                No attendance in this period.
              </td>
            </tr>
          )}
          {timesheet.map((r) => (
            <tr key={r.id}>
              {!single && <td>{r.employeeName}</td>}
              <td>{r.date}</td>
              <td>{r.checkIn}</td>
              <td>{r.checkOut ?? '—'}</td>
              <td>{r.workedHours == null ? '—' : formatHours(r.workedHours)}</td>
              <td>{r.overtime > 0 ? `+${formatHours(r.overtime)}` : '—'}</td>
              <td>{r.late ? formatDuration(r.lateMinutes) : '—'}</td>
              <td>
                {r.late ? (
                  <span className="badge badge-late">Late</span>
                ) : (
                  <span className="badge badge-ontime">On time</span>
                )}
              </td>
              <td>{r.location}</td>
              <td>
                {r.flaggedOutside ? (
                  <span className="badge badge-flagged">Yes</span>
                ) : (
                  'No'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryTab({ single, summary, perEmployee, employee }) {
  if (single) {
    const rows = [
      ['Employee', employee?.name ?? '—'],
      ['Email', employee?.email ?? '—'],
      ['Days present', summary.daysPresent],
      ['Sessions', summary.sessions],
      ['Total hours', formatHours(summary.totalHours)],
      ['Total overtime', formatHours(summary.totalOvertime)],
      ['Avg hours/day', formatHours(summary.avgHoursPerDay)],
      ['Late sessions', summary.lateSessions],
      ['Flagged sessions (left geofence)', summary.flaggedSessions],
      ['Open sessions (no check-out)', summary.openSessions],
    ]
    return (
      <div className="table-wrap">
        <table className="summary-kv">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Days present</th>
            <th>Sessions</th>
            <th>Total hours</th>
            <th>Overtime</th>
            <th>Avg hours/day</th>
            <th>Late</th>
            <th>Flagged</th>
          </tr>
        </thead>
        <tbody>
          {perEmployee.length === 0 && (
            <tr>
              <td colSpan={8} className="filter-empty">
                No attendance in this period.
              </td>
            </tr>
          )}
          {perEmployee.map((e) => (
            <tr key={e.name}>
              <td>{e.name}</td>
              <td>{e.daysPresent}</td>
              <td>{e.sessions}</td>
              <td>{formatHours(e.totalHours)}</td>
              <td>{e.totalOvertime > 0 ? `+${formatHours(e.totalOvertime)}` : '—'}</td>
              <td>{formatHours(e.avgHoursPerDay)}</td>
              <td>{e.lateSessions}</td>
              <td>{e.flaggedSessions}</td>
            </tr>
          ))}
          {perEmployee.length > 0 && (
            <tr className="summary-total">
              <td>All employees</td>
              <td>{summary.daysPresent}</td>
              <td>{summary.sessions}</td>
              <td>{formatHours(summary.totalHours)}</td>
              <td>{summary.totalOvertime > 0 ? `+${formatHours(summary.totalOvertime)}` : '—'}</td>
              <td>{formatHours(summary.avgHoursPerDay)}</td>
              <td>{summary.lateSessions}</td>
              <td>{summary.flaggedSessions}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function LocationState({ busy, error }) {
  if (busy)
    return (
      <div className="report-loc-state">
        <Spinner /> Loading location data…
      </div>
    )
  if (error)
    return (
      <div className="report-loc-state">
        Couldn't load location data. Make sure the backend is running.
      </div>
    )
  return null
}

function HeatmapTab({ points, locations, busy, error }) {
  if (busy || error) return <LocationState busy={busy} error={error} />
  if (!points.length && !locations.length)
    return (
      <div className="report-loc-state">
        No location data was recorded for this period.
      </div>
    )
  return (
    <div className="report-heatmap">
      <p className="page-hint">
        Live heat map of every location sample in this period ({points.length}{' '}
        points). Warmer (red) areas are where the most time was spent; blue
        outlines are your approved-site boundaries.
      </p>
      <LocationMap points={points} locations={locations} mode="heat" />
      <div className="heat-legend">
        <span>Fewer</span>
        <span className="heat-legend-bar" />
        <span>More</span>
      </div>
    </div>
  )
}

function PointsTab({ points, locations, busy, error }) {
  if (busy || error) return <LocationState busy={busy} error={error} />
  return (
    <div>
      {(points.length > 0 || locations.length > 0) && (
        <>
          <p className="page-hint">
            Every location sample in this period ({points.length} points). Green
            pins are inside the approved area, red are outside, blue outlines
            are your approved-site boundaries — hover or click a pin for details.
          </p>
          <LocationMap points={points} locations={locations} mode="markers" />
        </>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Time (local)</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Inside geofence</th>
              <th>Location</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {points.length === 0 && (
              <tr>
                <td colSpan={7} className="filter-empty">
                  No location data in this period.
                </td>
              </tr>
            )}
            {points.map((p, i) => (
              <tr key={i}>
                <td>{p.employee}</td>
                <td>{p.time}</td>
                <td>{p.lat.toFixed(5)}</td>
                <td>{p.lng.toFixed(5)}</td>
                <td>
                  {p.inside ? (
                    <span className="badge badge-ontime">Inside</span>
                  ) : (
                    <span className="badge badge-flagged">Outside</span>
                  )}
                </td>
                <td>{p.location}</td>
                <td>{p.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
