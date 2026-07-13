// The shell around every logged-in page: a sidebar with navigation on the
// left, and the active page rendered on the right via <Outlet />.
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          {/* White logo on the dark sidebar, per the brand manual. If the file
              isn't added yet, the alt text shows as a graceful fallback. */}
          <img
            className="brand-logo"
            src="/elsewedy-logo-white.png"
            alt="Elsewedy Electric"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling.style.display = 'block'
            }}
          />
          <span className="brand-fallback" style={{ display: 'none' }}>
            Elsewedy Electric
          </span>
          <span className="brand-product">Smart Attendance</span>
        </div>

        <nav className="nav">
          {/* `end` makes "/" only match exactly, not every route. */}
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/attendance">Attendance</NavLink>
          <NavLink to="/employees">Employees</NavLink>
          <NavLink to="/locations">Locations</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-email">{user?.email}</div>
          <button className="btn-secondary" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
