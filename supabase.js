import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import LeaderboardPage from './pages/LeaderboardPage'
import EmployeePage from './pages/EmployeePage'
import AdminPage from './pages/AdminPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import Layout from './components/Layout'
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

function AppRoutes() {
  const { currentUser } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={currentUser ? <Navigate to="/leaderboard" /> : <LoginPage />} />
      <Route path="/change-password" element={
        <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
      } />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/leaderboard" />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="my-sparks" element={<EmployeePage />} />
        <Route path="admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
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
