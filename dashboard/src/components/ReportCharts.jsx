// The Reports "Insights" tab — a small set of brand-consistent charts that turn
// the per-employee summary into something the admin can read at a glance. Built
// with plain SVG + CSS (no chart library), so it stays self-contained and on
// theme. Colours: data series use an accessible blue/amber pair (validated for
// colour-blind separation); punctuality uses reserved status colours (green =
// good, amber = warning) and always ships with labels, never colour alone.
import { formatHours } from '../utils/time'
import { Icon } from './icons'

// Series colours (kept off the brand red, which stays reserved for chrome and
// alerts so it never competes with data).
const C_REGULAR = '#2563eb' // regular hours
const C_OVERTIME = '#d97706' // overtime
const C_ONTIME = '#1e7a34' // on time (status: good)
const C_LATE = '#d97706' // late (status: warning)

function Legend({ items }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className="legend-item">
          <span className="legend-swatch" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// A donut for a two-way split (on-time vs late). Center shows the on-time rate.
function Donut({ onTime, late }) {
  const total = onTime + late
  const r = 54
  const c = 2 * Math.PI * r
  const pct = total ? onTime / total : 0
  const onLen = c * pct
  const gap = total && onTime > 0 && late > 0 ? 3 : 0 // 2–3px surface gap
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img"
        aria-label={`${Math.round(pct * 100)}% on time, ${late} late of ${total} sessions`}>
        {/* Late fills the whole ring; on-time is drawn on top as an arc. */}
        <circle cx="70" cy="70" r={r} fill="none" stroke={late ? C_LATE : '#eef0f2'} strokeWidth="16" />
        {onTime > 0 && (
          <circle
            cx="70" cy="70" r={r} fill="none"
            stroke={C_ONTIME} strokeWidth="16" strokeLinecap="round"
            strokeDasharray={`${Math.max(0, onLen - gap)} ${c}`}
            transform="rotate(-90 70 70)"
          />
        )}
        <text className="donut-pct" x="70" y="66">{Math.round(pct * 100)}%</text>
        <text className="donut-cap" x="70" y="86">on time</text>
      </svg>
      <Legend
        items={[
          { label: `On time · ${onTime}`, color: C_ONTIME },
          { label: `Late · ${late}`, color: C_LATE },
        ]}
      />
    </div>
  )
}

export default function ReportCharts({ perEmployee, summary }) {
  const hasData = perEmployee.length > 0 && summary.sessions > 0
  if (!hasData) {
    return (
      <div className="chart-card">
        <div className="empty-state">
          <span className="empty-icon">{Icon.chart}</span>
          <p>No attendance in this period — nothing to chart yet.</p>
        </div>
      </div>
    )
  }

  // --- Hours worked (regular + overtime), top 10 by total hours ---
  const hours = [...perEmployee]
    .map((e) => ({
      name: e.name,
      regular: Math.max(0, e.totalHours - e.totalOvertime),
      overtime: e.totalOvertime,
      total: e.totalHours,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
  const maxHours = Math.max(...hours.map((h) => h.total), 1)

  // --- Late arrivals per employee (only those with any), top 10 ---
  const lates = [...perEmployee]
    .filter((e) => e.lateSessions > 0)
    .map((e) => ({ name: e.name, value: e.lateSessions }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
  const maxLate = Math.max(...lates.map((l) => l.value), 1)

  const onTime = Math.max(0, summary.sessions - summary.lateSessions)

  return (
    <div className="charts">
      {/* Hours worked — stacked horizontal bars */}
      <div className="chart-card">
        <div className="chart-head">
          <div>
            <h3 className="chart-title">Hours worked by employee</h3>
            <p className="chart-sub">Regular vs overtime · top {hours.length}</p>
          </div>
          <Legend
            items={[
              { label: 'Regular', color: C_REGULAR },
              { label: 'Overtime', color: C_OVERTIME },
            ]}
          />
        </div>
        <div className="hbars">
          {hours.map((h) => (
            <div key={h.name} className="hbar-row">
              <div className="hbar-name" title={h.name}>{h.name}</div>
              <div className="hbar-track">
                {h.regular > 0 && (
                  <div
                    className="hbar-seg"
                    style={{ width: `${(h.regular / maxHours) * 100}%`, background: C_REGULAR }}
                    title={`Regular: ${formatHours(h.regular)}`}
                  />
                )}
                {h.overtime > 0 && (
                  <div
                    className="hbar-seg"
                    style={{ width: `${(h.overtime / maxHours) * 100}%`, background: C_OVERTIME }}
                    title={`Overtime: ${formatHours(h.overtime)}`}
                  />
                )}
              </div>
              <div className="hbar-value">{formatHours(h.total)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-two">
        {/* Punctuality donut */}
        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3 className="chart-title">Punctuality</h3>
              <p className="chart-sub">{summary.sessions} sessions this period</p>
            </div>
          </div>
          <Donut onTime={onTime} late={summary.lateSessions} />
        </div>

        {/* Late arrivals per employee */}
        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3 className="chart-title">Late arrivals</h3>
              <p className="chart-sub">Late sessions by employee</p>
            </div>
          </div>
          {lates.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon empty-icon-good">{Icon.check}</span>
              <p>Everyone arrived on time this period.</p>
            </div>
          ) : (
            <div className="hbars">
              {lates.map((l) => (
                <div key={l.name} className="hbar-row">
                  <div className="hbar-name" title={l.name}>{l.name}</div>
                  <div className="hbar-track">
                    <div
                      className="hbar-seg"
                      style={{ width: `${(l.value / maxLate) * 100}%`, background: C_LATE }}
                      title={`${l.value} late`}
                    />
                  </div>
                  <div className="hbar-value">{l.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
