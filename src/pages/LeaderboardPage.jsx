import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function LeaderboardPage() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState('name')
  const [txnLog, setTxnLog] = useState([])
  const [txnLoading, setTxnLoading] = useState(true)

  useEffect(() => {
    fetchEmployees()
    fetchTxnLog()

    const empChannel = supabase
      .channel('leaderboard-emp')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, fetchEmployees)
      .subscribe()

    const txnChannel = supabase
      .channel('leaderboard-txn')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spark_transactions' }, fetchTxnLog)
      .subscribe()

    return () => {
      supabase.removeChannel(empChannel)
      supabase.removeChannel(txnChannel)
    }
  }, [])

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, vested_sparks, unvested_sparks')
      .eq('is_admin', false)
    if (data) setEmployees(data)
    setLoading(false)
  }

  const fetchTxnLog = async () => {
    const { data } = await supabase
      .from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name, last_name), to_emp:to_employee_id(first_name, last_name)')
      .in('transaction_type', ['assign'])
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setTxnLog(data)
    setTxnLoading(false)
  }

  const sorted = [...employees].sort((a, b) => {
    if (sortMode === 'ranking') {
      return ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))
    }
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
  })

  const maxSparks = Math.max(...employees.map(e => (e.vested_sparks||0) + (e.unvested_sparks||0)), 1)

  const getRankingPosition = (emp) =>
    [...employees]
      .sort((a,b) => ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0)))
      .findIndex(e => e.id === emp.id) + 1

  return (
    <div className="fade-in">
      <h1 className="page-title">✨ Spark Leaderboard</h1>
      <p className="page-subtitle">Recognizing excellence across the DDE team</p>

      <div className="sort-control">
        <span className="sort-label">Sort by:</span>
        <button className={`sort-btn${sortMode==='name'?' active':''}`} onClick={() => setSortMode('name')}>A–Z Name</button>
        <button className={`sort-btn${sortMode==='ranking'?' active':''}`} onClick={() => setSortMode('ranking')}>🏆 Ranking</button>
      </div>

      <div className="card" style={{marginBottom:'28px'}}>
        {loading ? (
          <div style={{textAlign:'center',padding:'40px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
        ) : sorted.length === 0 ? (
          <div className="empty-state"><div className="icon">✨</div><p>No employees yet</p></div>
        ) : (
          sorted.map((emp) => {
            const total = (emp.vested_sparks||0) + (emp.unvested_sparks||0)
            const overallRank = sortMode === 'ranking'
              ? sorted.indexOf(emp) + 1
              : getRankingPosition(emp)
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

      {/* TRANSACTION LOG */}
      <div className="card">
        <div className="card-title"><span className="icon">📋</span> Spark Activity Log</div>
        <p style={{color:'var(--white-dim)', fontSize:'0.82rem', marginBottom:'16px'}}>
          All sparks given across the team — most recent first.
        </p>
        {txnLoading ? (
          <div style={{textAlign:'center',padding:'20px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
        ) : txnLog.length === 0 ? (
          <div className="empty-state"><div className="icon">📋</div><p>No spark activity yet</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th>✨</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {txnLog.map(txn => (
                  <tr key={txn.id}>
                    <td style={{fontSize:'0.8rem', color:'var(--white-dim)', whiteSpace:'nowrap'}}>
                      {new Date(txn.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
                    </td>
                    <td style={{fontWeight:600, fontSize:'0.88rem'}}>
                      {txn.from_emp ? `${txn.from_emp.first_name} ${txn.from_emp.last_name}` : '—'}
                    </td>
                    <td style={{fontWeight:600, fontSize:'0.88rem'}}>
                      {txn.to_emp ? `${txn.to_emp.first_name} ${txn.to_emp.last_name}` : '—'}
                    </td>
                    <td><span className="spark-badge">✨ {txn.amount}</span></td>
                    <td style={{fontSize:'0.82rem', color:'var(--white-dim)', maxWidth:'220px'}}>
                      {txn.reason
                        ? <span style={{color:'var(--white-soft)'}}>{txn.reason}</span>
                        : <span style={{opacity:0.35}}>No reason provided</span>}
                    </td>
                    <td>
                      <span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>
                        {txn.vested ? 'Vested' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
