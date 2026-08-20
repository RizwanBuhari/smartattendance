// Per-location, per-role check-in/check-out hours. A role/action pair with
// either box left blank is unrestricted (see backend's isWithinWindow) — this
// is opt-in per location, not a required schedule.
//
// Each time box is a text input backed by a shared <datalist> of 24-hour,
// 30-minute-interval presets: click to pick from the dropdown, or just type
// any "HH:MM" directly. No date-picker dependency, works in every browser.
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

const TIME_LIST_ID = 'attendance-window-time-options'

const ROLES = [
  { key: 'office_employee', label: 'Office Employees' },
  { key: 'site_employee', label: 'Site Employees' },
  { key: 'site_supervisor', label: 'Supervisors' },
]

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function TimeBox({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      list={TIME_LIST_ID}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={5}
      className={value && !HHMM_RE.test(value) ? 'input-invalid' : undefined}
      style={{ width: 84 }}
    />
  )
}

// `value` is the location's attendanceWindows map (or undefined). `onChange`
// receives the whole updated map on every edit.
export default function AttendanceWindowsEditor({ value, onChange }) {
  const windows = value || {}

  function setField(roleKey, action, field, raw) {
    const next = { ...windows }
    const role = { ...(next[roleKey] || {}) }
    const window_ = { ...(role[action] || {}) }
    window_[field] = raw
    role[action] = window_
    next[roleKey] = role
    onChange(next)
  }

  return (
    <div>
      <datalist id={TIME_LIST_ID}>
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
        Leave a box blank to leave that role unrestricted at this location. Pick a
        preset from the dropdown or type a time directly (24-hour, e.g. "14:30").
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ROLES.map((role) => {
          const roleWindows = windows[role.key] || {}
          return (
            <div
              key={role.key}
              style={{
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                {role.label}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  rowGap: 8,
                  columnGap: 12,
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Check-in</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TimeBox
                    value={roleWindows.checkIn?.from}
                    placeholder="From"
                    onChange={(v) => setField(role.key, 'checkIn', 'from', v)}
                  />
                  <span style={{ color: 'var(--muted)' }}>to</span>
                  <TimeBox
                    value={roleWindows.checkIn?.to}
                    placeholder="To"
                    onChange={(v) => setField(role.key, 'checkIn', 'to', v)}
                  />
                </div>

                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Check-out</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TimeBox
                    value={roleWindows.checkOut?.from}
                    placeholder="From"
                    onChange={(v) => setField(role.key, 'checkOut', 'from', v)}
                  />
                  <span style={{ color: 'var(--muted)' }}>to</span>
                  <TimeBox
                    value={roleWindows.checkOut?.to}
                    placeholder="To"
                    onChange={(v) => setField(role.key, 'checkOut', 'to', v)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
