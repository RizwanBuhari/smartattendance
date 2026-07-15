// Re-runs a data-loading callback so the dashboard reflects the live database:
//   - when the browser tab regains focus / becomes visible (e.g. after you
//     delete something in the Firebase console and switch back), and
//   - periodically, every `intervalMs` (default 60s).
//
// The periodic tick is SKIPPED while the tab is hidden — a background tab
// shouldn't keep hammering Firestore (and burning free-tier read quota) when
// no one is looking at it; it refreshes once the moment it becomes visible
// again. The callback is kept in a ref so the listeners are set up only once
// and always call the latest version — pass a "silent" refresh that updates
// data without flipping the page back to its loading state.
import { useEffect, useRef } from 'react'

export function useAutoRefresh(onRefresh, intervalMs = 60000) {
  const ref = useRef(onRefresh)
  ref.current = onRefresh

  useEffect(() => {
    const run = () => ref.current?.()
    const runIfVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', runIfVisible)
    // Only poll while the tab is actually visible.
    const id = setInterval(runIfVisible, intervalMs)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', runIfVisible)
      clearInterval(id)
    }
  }, [intervalMs])
}
