// The shell around every logged-in page: a TOP navigation bar (like the
// elsewedyelectric.com header) with a thin red utility strip, a bigger logo,
// and horizontal nav — then the active page rendered full-width below.
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import NotificationBell from './NotificationBell'
import LogoShine from './LogoShine'

export default function AppLayout() {
  const { logout } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        {/* Thin red utility strip (brand + account), like the website's top bar. */}
        <div className="topstrip">
          <div className="topstrip-inner">
            <span className="topstrip-brand">Check-N · Admin</span>
            <div className="topstrip-right">
              <NotificationBell />
              <NavLink
                to="/profile"
                className="topstrip-profile"
                title="Profile"
                aria-label="Profile"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </NavLink>
              <button className="topstrip-logout" onClick={logout}>
                Log out
              </button>
            </div>
          </div>
        </div>

        {/* White main bar: bigger logo on the left, horizontal nav. */}
        <div className="topbar">
          <div className="topbar-inner">
            <NavLink to="/" className="topbar-brand" end>
              <LogoShine
                src="/elsewedy-logo-black.png"
                alt="Elsewedy Electric"
                shine="light"
                imgClassName="topbar-logo"
                fallback={
                  <span className="topbar-fallback" style={{ display: 'none' }}>
                    Elsewedy Electric
                  </span>
                }
              />
            </NavLink>

            <nav className="topnav">
              <NavLink to="/" end>
                Overview
              </NavLink>
              <NavLink to="/attendance">Attendance</NavLink>
              <NavLink to="/employees">Employees</NavLink>
              <NavLink to="/reviews">Review</NavLink>
              <NavLink to="/locations">Locations</NavLink>
            </nav>
          </div>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
