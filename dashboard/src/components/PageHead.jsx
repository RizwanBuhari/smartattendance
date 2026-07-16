// A consistent icon-led page header used across every dashboard page: a tinted
// icon badge next to the title, an optional action on the right, and an
// optional hint line beneath. Keeps titles visually aligned page-to-page.
export default function PageHead({ icon, title, hint, tone = 'brand', action }) {
  return (
    <>
      <div className="page-header">
        <div className="page-head-left">
          <span className={`page-lead page-lead-${tone}`}>{icon}</span>
          <h1 className="page-title">{title}</h1>
        </div>
        {action}
      </div>
      {hint && <p className="page-hint">{hint}</p>}
    </>
  )
}
