// Re-runs a data-loading callback so the dashboard reflects the live database:
//   - when the browser tab regains focus / becomes visible (e.g. after you
//     delete something in the Firebase console and switch back), and
//   - periodically, every `intervalMs` (default 20s).
//
// The callback is kept in a ref so the listeners are set up only once and always
// call the latest version — pass a "silent" refresh that updates data without
// flipping the page back to its loading state.
import { useEffect, useRef } from 'react'

export function useAutoRefresh(onRefresh, intervalMs = 20000) {
  const ref = useRef(onRefresh)
  ref.current = onRefresh

  useEffect(() => {
    const run = () => ref.current?.()
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(run, intervalMs)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [intervalMs])
}
