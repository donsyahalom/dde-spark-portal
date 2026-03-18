import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Layout() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const [hasDashboardAccess, setHasDashboardAccess] = useState(false)

  useEffect(() => {
    if (!currentUser || currentUser.is_admin) return
    supabase
      .from('dashboard_access')
      .select('access_level')
      .eq('employee_id', currentUser.id)
      .single()
      .then(({ data }) => setHasDashboardAccess(!!data))
  }, [currentUser])

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="app-layout">
      <header className="header">
        <div className="header-left">
          <img src="/logo.png" alt="DDE Logo" className="header-logo" onError={e=>{e.target.style.display='none'}} />
          <span className="header-title">DDE Spark Portal</span>
        </div>
        <nav className="header-nav">
          <NavLink to="/leaderboard" className={({isActive})=>`nav-btn${isActive?' active':''}`}>🏆 Board</NavLink>
          {!currentUser?.is_admin && (
            <NavLink to="/my-sparks" className={({isActive})=>`nav-btn${isActive?' active':''}`}>✨ My Sparks</NavLink>
          )}
          <NavLink to="/board" className={({isActive})=>`nav-btn${isActive?' active':''}`}>📢 Company</NavLink>
          {/* Dashboard link: admins go to /admin, granted users go to /dashboard */}
          {currentUser?.is_admin && (
            <NavLink to="/admin" className={({isActive})=>`nav-btn${isActive?' active':''}`}>⚙️ Admin</NavLink>
          )}
          {!currentUser?.is_admin && hasDashboardAccess && (
            <NavLink to="/dashboard" className={({isActive})=>`nav-btn${isActive?' active':''}`}>📊 Dashboard</NavLink>
          )}
          <span className="user-badge" style={{marginLeft:'8px'}}>
            {currentUser?.first_name}
            {!currentUser?.is_admin && (
              <span className="spark-count">✨ {(currentUser?.vested_sparks||0)+(currentUser?.unvested_sparks||0)}</span>
            )}
          </span>
          <NavLink to="/change-password" className="nav-btn" style={{fontSize:'0.65rem'}}>🔑</NavLink>
          <button className="nav-btn logout" onClick={handleLogout}>Logout</button>
        </nav>
      </header>
      <main className="main-content"><Outlet /></main>
    </div>
  )
}
