import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import DashboardTab from '../components/DashboardTab'

export default function UserDashboardPage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [access, setAccess] = useState(null)   // null=loading, false=none, {level, teamIds}
  const [teamIds, setTeamIds] = useState([])

  useEffect(() => {
    const checkAccess = async () => {
      // Admins always have full access — redirect to admin panel
      if (currentUser?.is_admin) { navigate('/admin'); return }

      const { data: row } = await supabase
        .from('dashboard_access')
        .select('access_level')
        .eq('employee_id', currentUser.id)
        .single()

      if (!row) { setAccess(false); return }

      // For team-level access, also get the teams they're a lead of
      if (row.access_level === 'team') {
        const { data: teams } = await supabase
          .from('teams')
          .select('id')
          .or(`pm_id.eq.${currentUser.id},foreman_id.eq.${currentUser.id}`)
        const ids = (teams || []).map(t => t.id)
        setTeamIds(ids)
      }

      setAccess(row)
    }
    checkAccess()
  }, [currentUser, navigate])

  if (access === null) {
    return <div style={{ textAlign: 'center', padding: '60px', color: 'var(--white-dim)' }}>
      <div className="spark-loader" style={{ margin: '0 auto 16px' }}></div>
      Checking access…
    </div>
  }

  if (access === false) {
    return (
      <div className="card fade-in" style={{ maxWidth: '480px', margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔒</div>
        <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', marginBottom: '8px' }}>NO DASHBOARD ACCESS</div>
        <p style={{ color: 'var(--white-dim)', fontSize: '0.85rem' }}>
          You have not been granted access to this dashboard. Contact your admin.
        </p>
      </div>
    )
  }

  const isFullAccess = access.access_level === 'full'

  return (
    <div className="fade-in">
      <h1 className="page-title">📊 Spark Dashboard</h1>
      <p className="page-subtitle">
        {isFullAccess ? 'Full analytics view' : 'Team analytics view — no $ amounts shown'}
      </p>
      <DashboardTab
        showDollar={isFullAccess}
        limitToTeamIds={isFullAccess ? null : (teamIds.length > 0 ? teamIds : null)}
      />
    </div>
  )
}
