// Admin review of out-of-radius checkouts. When an employee checks out from
// outside their approved area, the session still closes (so they're never
// stuck) but it lands here as "pending" — the admin accepts it (a valid
// checkout) or rejects it (an improper one). Either decision resolves the item,
// and the employee's anomaly clears on the underlying checkout.
import { useEffect, useState } from 'react'
import {
  acceptCheckoutReview,
  rejectCheckoutReview,
} from '../services/attendanceService'
import { subscribeCheckoutReviews } from '../services/realtime'
import { formatLocal, workedHours } from '../utils/time'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'
import { useConfirm } from '../components/ConfirmProvider'

export default function ReviewPage() {
  const confirm = useConfirm()
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  // Key of the row action in flight, e.g. `accept:<id>` / `reject:<id>`.
  const [busy, setBusy] = useState(null)

  // Realtime: pending out-of-radius checkouts stream in and out of this list on
  // their own as employees check out and as you accept/reject them.
  useEffect(() => {
    const unsubscribe = subscribeCheckoutReviews(
      (data) => {
        setReviews(data)
        setError(false)
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
    return unsubscribe
  }, [])

  async function decide(r, decision) {
    // Rejecting flags the checkout as improper (e.g. left the site without
    // permission), so confirm it. Accepting is the benign resolution.
    let reason = null;
    if (decision === 'reject') {
      const who = r.employeeName ?? 'this employee';
      const ok = await confirm({
        title: 'Reject this checkout?',
        message: `This flags ${who}'s checkout as improper. You can't change the decision afterwards.`,
        confirmText: 'Reject checkout',
        tone: 'danger',
      });
      if (!ok) return;

      reason = window.prompt('Enter rejection reason (optional):');
      if (reason === null) return; // User cancelled prompt
      reason = reason.trim() || 'Outside approved area';
    }
    setBusy(`${decision}:${r.id}`);
    try {
      // Once resolved, the realtime listener drops it from the list.
      if (decision === 'accept') await acceptCheckoutReview(r.id);
      else await rejectCheckoutReview(r.id, reason);
    } finally {
      setBusy(null);
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

  const query = search.trim().toLowerCase()
  const shown = query
    ? reviews.filter((r) => (r.employeeName || '').toLowerCase().includes(query))
    : reviews

  return (
    <div className="reveal">
      <PageHead
        icon={Icon.shield}
        title="Review"
        tone="info"
        hint="Checkouts made from outside an approved location wait here for your decision. Accept to record it as a valid checkout, or reject to flag it as an improper one."
      />

      <div className="filter-bar">
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
            placeholder="Search by employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="panel-count">{reviews.length} pending</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Check-in</th>
              <th>Checkout requested</th>
              <th>Worked</th>
              <th>Distance outside</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="filter-empty">
                  {query
                    ? 'No pending checkouts match your search.'
                    : 'No checkouts are waiting for review.'}
                </td>
              </tr>
            )}
            {shown.map((r) => {
              const review = r.checkoutReview ?? {}
              return (
                <tr key={r.id}>
                  <td>{r.employeeName}</td>
                  <td>{formatLocal(r.checkInUtc, r.tzOffsetMinutes)}</td>
                  <td>{formatLocal(review.requestedAt, r.tzOffsetMinutes)}</td>
                  <td>{workedHours(r.checkInUtc, review.requestedAt)}</td>
                  <td>
                    <span className="badge badge-flagged">
                      {review.distanceMeters != null
                        ? `${review.distanceMeters}m from ${review.locationName ?? 'approved area'}`
                        : 'Outside approved area'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn-sm btn-sm-primary"
                        onClick={() => decide(r, 'accept')}
                        disabled={busy === `accept:${r.id}`}
                      >
                        {busy === `accept:${r.id}` ? (
                          <>
                            <Spinner light /> Accepting…
                          </>
                        ) : (
                          'Accept'
                        )}
                      </button>
                      <button
                        className="btn-sm btn-sm-danger"
                        onClick={() => decide(r, 'reject')}
                        disabled={busy === `reject:${r.id}`}
                      >
                        {busy === `reject:${r.id}` ? <Spinner /> : 'Reject'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
