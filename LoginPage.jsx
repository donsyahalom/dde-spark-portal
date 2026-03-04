import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function LeaderboardPage() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState('name') // 'name' or 'ranking'

  useEffect(() => {
    fetchEmployees()
    // Subscribe to realtime changes
    const channel = supabase
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, fetchEmployees)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, vested_sparks, unvested_sparks')
      .eq('is_admin', false)
    if (data) setEmployees(data)
    setLoading(false)
  }

  const sorted = [...employees].sort((a, b) => {
    if (sortMode === 'ranking') {
      const totalA = (a.vested_sparks || 0) + (a.unvested_sparks || 0)
      const totalB = (b.vested_sparks || 0) + (b.unvested_sparks || 0)
      return totalB - totalA
    } else {
      return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    }
  })

  const maxSparks = Math.max(...employees.map(e => (e.vested_sparks||0) + (e.unvested_sparks||0)), 1)

  return (
    <div className="fade-in">
      <h1 className="page-title">✨ Spark Leaderboard</h1>
      <p className="page-subtitle">Recognizing excellence across the DDE team</p>

      <div className="sort-control">
        <span className="sort-label">Sort by:</span>
        <button className={`sort-btn${sortMode==='name'?' active':''}`} onClick={() => setSortMode('name')}>
          A–Z Name
        </button>
        <button className={`sort-btn${sortMode==='ranking'?' active':''}`} onClick={() => setSortMode('ranking')}>
          🏆 Ranking
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{textAlign:'center',padding:'40px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
        ) : sorted.length === 0 ? (
          <div className="empty-state"><div className="icon">✨</div><p>No employees yet</p></div>
        ) : (
          sorted.map((emp, idx) => {
            const total = (emp.vested_sparks || 0) + (emp.unvested_sparks || 0)
            const rank = sortMode === 'ranking' ? idx + 1 : null
            const overallRank = sortMode === 'name'
              ? [...employees].sort((a,b) => ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))).findIndex(e=>e.id===emp.id) + 1
              : idx + 1
            const pct = Math.round((total / maxSparks) * 100)

            return (
              <div key={emp.id} className="leaderboard-row">
                <span className={`rank-badge rank-${overallRank <= 3 ? overallRank : 'other'}`}>
                  {overallRank <= 3 ? ['🥇','🥈','🥉'][overallRank-1] : overallRank}
                </span>
                <div style={{flex:1}}>
                  <div className="leaderboard-name">{emp.first_name} {emp.last_name}</div>
                  <div className="progress-bar"><div className="progress-fill" style={{width:`${pct}%`}}></div></div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div className="leaderboard-sparks">✨ {total}</div>
                  <div style={{fontSize:'0.72rem', color:'var(--white-dim)', marginTop:'2px'}}>
                    <span style={{color:'var(--gold-light)'}}>{emp.vested_sparks||0} vested</span>
                    {(emp.unvested_sparks||0) > 0 && <span> · {emp.unvested_sparks} pending</span>}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
