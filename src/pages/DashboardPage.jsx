import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import DashboardTab from '../components/DashboardTab'

export default function DashboardPage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [accessLevel, setAccessLevel] = useState(null)  // 'full' | 'team' | null
  const [teamIds, setTeamIds] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAccess = async () => {
      // Admins always get full access via /admin
      if (currentUser?.is_admin) { navigate('/admin'); return }

      const { data } = await supabase
        .from('dashboard_access')
        .select('access_level')
        .eq('employee_id', currentUser.id)
        .single()

      if (!data) { navigate('/leaderboard'); return }

      setAccessLevel(data.access_level)

      if (data.access_level === 'team') {
        // Load which teams this user is a lead of (pm_id or foreman_id)
        const { data: teamRows } = await supabase
          .from('teams')
          .select('id')
          .or(`pm_id.eq.${currentUser.id},foreman_id.eq.${currentUser.id}`)
        setTeamIds((teamRows || []).map(t => t.id))
      }

      setLoading(false)
    }
    checkAccess()
  }, [currentUser, navigate])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px', color: 'var(--white-dim)' }}>
      <div className="spark-loader" style={{ margin: '0 auto 16px' }}></div>
      Loading dashboard…
    </div>
  )

  if (!accessLevel) return null

  return (
    <div className="fade-in">
      <h1 className="page-title">📊 Spark Dashboard</h1>
      <p className="page-subtitle">
        {accessLevel === 'full'
          ? 'Company-wide spark analytics'
          : 'Your team\'s spark analytics'}
      </p>
      <DashboardTab
        showDollar={accessLevel === 'full'}
        limitToTeamIds={accessLevel === 'team' ? (teamIds || []) : null}
      />
    </div>
  )
}
