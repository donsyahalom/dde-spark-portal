import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function Layout() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const [hasDashboardAccess, setHasDashboardAccess] = useState(false)
  const handleLogout = () => { logout(); navigate('/login') }

  // Foreman or above check
  const grade = currentUser?.job_grade || ''
  const isForeman = currentUser?.is_admin || /^[FP]/.test(grade) || grade === 'Owner'

  useEffect(() => {
    if (!currentUser) { setHasDashboardAccess(false); return }
    // Admins always have dashboard access (they go to /admin but can also use /dashboard)
    if (currentUser.is_admin) { setHasDashboardAccess(true); return }
    supabase.from('dashboard_access').select('access_level').eq('employee_id', currentUser.id).single()
      .then(({ data }) => setHasDashboardAccess(!!data))
  }, [currentUser])

  return (
    <div className="app-layout">
      <header className="header">
        <div className="header-left">
          <img src="/logo.png" alt="DDE Logo" className="header-logo" onError={e=>{e.target.style.display='none'}} />
          <span className="header-title">DDE Sparks Portal</span>
        </div>
        <nav className="header-nav">
          <NavLink to="/leaderboard" className={({isActive})=>`nav-btn${isActive?' active':''}`}>&#x1F3C6; Board</NavLink>
          {!currentUser?.is_admin && (
            <NavLink to="/my-sparks" className={({isActive})=>`nav-btn${isActive?' active':''}`}>&#x2728; My Sparks</NavLink>
          )}
          <NavLink to="/board" className={({isActive})=>`nav-btn${isActive?' active':''}`}>&#x1F4E2; Company</NavLink>
          {hasDashboardAccess && (
            <NavLink to="/dashboard" className={({isActive})=>`nav-btn${isActive?' active':''}`}>&#x1F4CA; Dashboard</NavLink>
          )}
          {isForeman && (
            <NavLink to="/performance" className={({isActive})=>`nav-btn${isActive?' active':''}`}>&#x1F4CB; Evals</NavLink>
          )}
          {currentUser?.is_admin && (
            <NavLink to="/admin" className={({isActive})=>`nav-btn${isActive?' active':''}`}>&#x2699;&#xFE0F; Admin</NavLink>
          )}
          <span className="user-badge" style={{marginLeft:'8px'}}>
            {currentUser?.first_name}
            {!currentUser?.is_admin && (
              <span className="spark-count">&#x2728; {(currentUser?.vested_sparks||0)+(currentUser?.unvested_sparks||0)}</span>
            )}
          </span>
          <NavLink to="/change-password" className="nav-btn" style={{fontSize:'0.65rem'}}>&#x1F511;</NavLink>
          <button className="nav-btn logout" onClick={handleLogout}>Logout</button>
        </nav>
      </header>
      <main className="main-content"><Outlet /></main>
    </div>
  )
}
