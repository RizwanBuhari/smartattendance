// Sets up routing for the whole dashboard.
//
// - /login is public.
// - Everything else is wrapped in <ProtectedRoute> (redirects to /login if not
//   signed in) and rendered inside <AppLayout> (the sidebar shell).
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ConfirmProvider } from './components/ConfirmProvider'
import ProtectedRoute from './auth/ProtectedRoute'
import AppLayout from './components/AppLayout'
import SplashScreen from './components/SplashScreen'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import AttendancePage from './pages/AttendancePage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import ReviewPage from './pages/ReviewPage'
import LocationsPage from './pages/LocationsPage'
import ProfilePage from './pages/ProfilePage'

export default function App() {
  return (
    <AuthProvider>
      <SplashScreen />
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<OverviewPage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reviews" element={<ReviewPage />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </AuthProvider>
  )
}
