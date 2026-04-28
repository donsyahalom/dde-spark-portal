import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// UAT environment banner — only shows when VITE_ENV=UAT is set in Netlify env vars.
const IS_UAT = import.meta.env.VITE_ENV === 'UAT'
console.log('IS_UAT:', IS_UAT, 'VITE_ENV:', import.meta.env.VITE_ENV)

export default function Layout() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const [compensationEnabled, setCompensationEnabled] = useState(true)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key','compensation_enabled').single()
      .then(({ data }) => {
        if (data) setCompensationEnabled(data.value !== 'false')
      })
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const canSeeOps = currentUser?.is_admin || currentUser?.job_grade === 'Owner'

  return (
    <div className="app-layout">

      {IS_UAT && (
        <div style={{
          background: '#f59e0b',
          color: '#000',
          textAlign: 'center',
          padding: '6px 16px',
          fontWeight: 'bold',
          fontSize: '12px',
          letterSpacing: '0.06em',
          zIndex: 9999,
        }}>
          ⚠️ UAT ENVIRONMENT — Changes here do NOT affect production. Data resets every Sunday.
        </div>
      )}

      <header className="header">
        <div className="header-left">
          <img src="/logo.png" alt="DDE Logo" className="header-logo"
            onError={e => { e.target.style.display='none' }} />
          <span className="header-title">
            DDE Spark Portal{IS_UAT ? ' (UAT)' : ''}
          </span>
        </div>
        <nav className="header-nav">
          <NavLink to="/leaderboard" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}>
            🏆 Board
          </NavLink>
          {!currentUser?.is_admin && (
            <NavLink to="/my-sparks" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}>
              ✨ My Sparks
            </NavLink>
          )}
          {!currentUser?.is_admin && compensationEnabled && (
            <NavLink to="/compensation" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}>
              💵 My Pay
            </NavLink>
          )}
          {!currentUser?.is_admin && (
            <NavLink to="/performance" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}>
              📋 Evals
            </NavLink>
          )}
          {canSeeOps && (
            <NavLink to="/ops" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}>
              📊 Ops
            </NavLink>
          )}
          {currentUser?.is_admin && (
            <NavLink to="/admin" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}>
              ⚙️ Admin
            </NavLink>
          )}
          <NavLink to="/my-sparks" className={({isActive}) => `nav-btn${isActive ? ' active' : ''}`}
            style={currentUser?.is_admin ? {display:'none'} : {}}>
          </NavLink>
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
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
