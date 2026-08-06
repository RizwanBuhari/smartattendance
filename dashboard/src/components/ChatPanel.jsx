// The dashboard assistant — a slide-over panel reachable from every page.
//
// Deliberately a panel rather than a route: the questions an admin asks are
// usually ABOUT the page they are already on ("why is this one flagged?"), so
// navigating away to ask would lose the context that prompted the question.
//
// The panel holds no data of its own. Every answer comes from POST /chat, which
// is admin-guarded and read-only on the server, so there is nothing here that
// could change a record even if it wanted to.
import { useEffect, useRef, useState } from 'react'
import { askAssistant } from '../services/chatService'

// Shown on an empty panel. These are picked to demonstrate the three tools —
// locations, a filtered attendance query, and the flagged-records path — so a
// first-time user sees what the thing is actually for.
const SUGGESTIONS = [
  'Which locations are set up, and what are their radii?',
  'Who checked in today?',
  'Show me any records where the device disagreed with the server',
]

export default function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef(null)
  const inputRef = useRef(null)

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [messages, busy])

  // Focus the box when the panel opens, so it can be used without the mouse.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Escape closes the panel — expected of anything that overlays the page.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send(text) {
    const question = (text ?? input).trim()
    if (!question || busy) return

    setInput('')
    setMessages((m) => [...m, { role: 'user', text: question }])
    setBusy(true)

    try {
      const { answer } = await askAssistant(question)
      setMessages((m) => [...m, { role: 'assistant', text: answer }])
    } catch (err) {
      // The backend answers 200 even when it cannot help, so reaching here
      // means the request itself failed — network, auth, or the server being
      // down. Say which rather than showing a generic apology.
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          error: true,
          text:
            `Could not reach the assistant. ${err.message}\n\n` +
            'Check that the backend is running and that you are still signed in.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        className="chat-fab"
        onClick={() => setOpen(true)}
        title="Ask the assistant"
        aria-label="Ask the assistant"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>Ask</span>
      </button>
    )
  }

  return (
    <aside className="chat-panel" role="dialog" aria-label="Dashboard assistant">
      <header className="chat-head">
        <div className="chat-head-id">
          <span className="chat-avatar" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 8V4H8" />
              <rect x="4" y="8" width="16" height="12" rx="2" />
              <path d="M2 14h2M20 14h2M9 13v2M15 13v2" />
            </svg>
          </span>
          <div>
            <strong>Assistant</strong>
            <span className="chat-sub">
              <span className="chat-status-dot" aria-hidden="true" />
              Online · answers from your data
            </span>
          </div>
        </div>
        <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </header>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Ask about attendance, locations or why a record was flagged. I read
              the same data the dashboard shows — I cannot change anything.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`chat-msg chat-${m.role}${m.error ? ' chat-error' : ''}`}
          >
            <div className="chat-text">{m.text}</div>
          </div>
        ))}

        {busy && (
          <div className="chat-msg chat-assistant chat-typing" aria-label="Assistant is typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Ask about attendance…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — the convention
            // everyone already expects from a chat box.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          disabled={busy}
        />
        <button
          className="chat-send"
          onClick={() => send()}
          disabled={busy || !input.trim()}
          aria-label="Send"
          title="Send"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
