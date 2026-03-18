import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import DashboardTab from '../components/DashboardTab'

export default function UserDashboardPage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [access, setAccess] = useState(null)   // null=loading, false=none, object=granted
  const [teamIds, setTeamIds] = useState([])

  useEffect(() => {
    const checkAccess = async () => {
      if (currentUser?.is_admin) { navigate('/admin'); return }

      const { data: row } = await supabase
        .from('dashboard_access')
        .select('access_level')
        .eq('employee_id', currentUser.id)
        .single()

      if (!row) { setAccess(false); return }

      // For team-level access, find teams where this user is listed as a PM or Foreman
      if (row.access_level === 'team') {
        const { data: teams } = await supabase
          .from('teams')
          .select('id, pm_ids, foreman_ids')
        const myTeams = (teams || []).filter(t =>
          (t.pm_ids || []).includes(currentUser.id) ||
          (t.foreman_ids || []).includes(currentUser.id)
        )
        setTeamIds(myTeams.map(t => t.id))
      }

      setAccess(row)
    }
    if (currentUser) checkAccess()
  }, [currentUser, navigate])

  if (access === null) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--white-dim)' }}>
        <div className="spark-loader" style={{ margin: '0 auto 16px' }}></div>
        Checking access...
      </div>
    )
  }

  if (access === false) {
    return (
      <div className="card fade-in" style={{ maxWidth: '480px', margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>&#x1F512;</div>
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
      <h1 className="page-title">&#x1F4CA; Spark Dashboard</h1>
      <p className="page-subtitle">
        {isFullAccess ? 'Full analytics view' : 'Team analytics — spark counts only'}
      </p>
      <DashboardTab
        showDollar={isFullAccess}
        limitToTeamIds={isFullAccess ? null : (teamIds.length > 0 ? teamIds : null)}
      />
    </div>
  )
}
