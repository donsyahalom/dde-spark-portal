import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import LeaderboardPage from './pages/LeaderboardPage'
import EmployeePage from './pages/EmployeePage'
import AdminPage from './pages/AdminPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import MessageBoardPage from './pages/MessageBoardPage'
import UserDashboardPage from './pages/UserDashboardPage'
import DashboardPage from './pages/DashboardPage'
import PerformanceRatingPage from './pages/PerformanceRatingPage'
import CompensationPage from './pages/CompensationPage'
import Layout from './components/Layout'
// Ops (financial operations) dashboard — nested under /ops
import OpsLayout from './components/ops/OpsLayout'
import OpsOverviewPage from './pages/ops/OpsOverviewPage'
import OpsPnlPage from './pages/ops/OpsPnlPage'
import OpsJobsPage from './pages/ops/OpsJobsPage'
import OpsCashflowPage from './pages/ops/OpsCashflowPage'
import OpsArPage from './pages/ops/OpsArPage'
import OpsApPage from './pages/ops/OpsApPage'
import OpsKpisPage from './pages/ops/OpsKpisPage'
import OpsPayrollPage from './pages/ops/OpsPayrollPage'
import OpsPermissionsPage from './pages/ops/OpsPermissionsPage'
import './styles.css'

function ProtectedRoute({ children, adminOnly = false }) {
  const { currentUser, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spark-loader"></div></div>
  if (!currentUser) return <Navigate to="/login" />
  if (adminOnly && !currentUser.is_admin) return <Navigate to="/leaderboard" />
  if (currentUser.must_change_password && window.location.pathname !== '/change-password') {
    return <Navigate to="/change-password" />
  }
  return children
}

// Guard: foreman or admin only
function ForemanRoute({ children }) {
  const { currentUser } = useAuth()
  const grade = currentUser?.job_grade || ''
  const isForeman = currentUser?.is_admin || /^[FP]/.test(grade) || grade === 'Owner'
  if (!isForeman) return <Navigate to="/leaderboard" />
  return children
}

// Guard: ops/financial dashboard — admins and owners only.
// When the server-side `ops_access` RLS table is wired we'll replace
// this with a per-row lookup; for now keep the gate client-side.
function OpsRoute({ children }) {
  const { currentUser } = useAuth()
  const grade = currentUser?.job_grade || ''
  const canSeeOps = currentUser?.is_admin || grade === 'Owner'
  if (!canSeeOps) return <Navigate to="/leaderboard" />
  return children
}

function AppRoutes() {
  const { currentUser } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={currentUser ? <Navigate to="/leaderboard" /> : <LoginPage />} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/leaderboard" />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="my-sparks" element={<EmployeePage />} />
        <Route path="board" element={<MessageBoardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="performance" element={<ForemanRoute><PerformanceRatingPage /></ForemanRoute>} />
        <Route path="admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
        <Route path="dashboard" element={<ProtectedRoute><UserDashboardPage /></ProtectedRoute>} />
        <Route path="compensation" element={<ProtectedRoute><CompensationPage /></ProtectedRoute>} />
        {/* Ops (financial operations) dashboard — admin/Owner only */}
        <Route path="ops" element={<OpsRoute><OpsLayout /></OpsRoute>}>
          <Route index element={<OpsOverviewPage />} />
          <Route path="pnl"         element={<OpsPnlPage />} />
          <Route path="jobs"        element={<OpsJobsPage />} />
          <Route path="cashflow"    element={<OpsCashflowPage />} />
          <Route path="ar"          element={<OpsArPage />} />
          <Route path="ap"          element={<OpsApPage />} />
          <Route path="kpis"        element={<OpsKpisPage />} />
          <Route path="payroll"     element={<OpsPayrollPage />} />
          <Route path="permissions" element={<OpsPermissionsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/leaderboard" />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
