// The shell around every logged-in page: a sidebar with navigation on the
// left, and the active page rendered on the right via <Outlet />.
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Smart Attendance</div>

        <nav className="nav">
          {/* `end` makes "/" only match exactly, not every route. */}
          <NavLink to="/" end>
            Attendance
          </NavLink>
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
