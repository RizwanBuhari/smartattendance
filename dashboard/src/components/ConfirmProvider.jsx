// A branded, in-app replacement for the browser's window.confirm() dialog.
//
// Usage anywhere under <ConfirmProvider>:
//   const confirm = useConfirm()
//   if (!(await confirm({ title, message, confirmText, tone: 'danger' }))) return
//
// confirm() returns a Promise<boolean> — true if the admin confirmed, false if
// they cancelled or dismissed it. One dialog shows at a time.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setDialog({
        title: options.title ?? 'Are you sure?',
        message: options.message ?? '',
        confirmText: options.confirmText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        tone: options.tone ?? 'default', // 'default' | 'danger'
      })
    })
  }, [])

  const settle = useCallback((result) => {
    setDialog(null)
    if (resolverRef.current) {
      resolverRef.current(result)
      resolverRef.current = null
    }
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <ConfirmDialog
          {...dialog}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog({ title, message, confirmText, cancelText, tone, onConfirm, onCancel }) {
  // Esc cancels. (Enter naturally activates the focused confirm button.)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className={`modal-icon modal-icon-${tone}`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {tone === 'danger' ? (
              <>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </>
            )}
          </svg>
        </div>
        <h2 className="modal-title">{title}</h2>
        {message && <p className="modal-message">{message}</p>}
        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={`modal-btn ${tone === 'danger' ? 'modal-btn-danger' : 'modal-btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}
