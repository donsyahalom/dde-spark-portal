import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { assignSparks } from '../lib/sparkHelpers'
import { buildReason, JOB_TITLES } from '../lib/constants'

const SORT_OPTIONS = [
  { value: 'name',  label: 'A–Z Name' },
  { value: 'ranking', label: '🏆 Ranking' },
  { value: 'title', label: 'Job Title A–Z' },
]

export default function LeaderboardPage() {
  const { currentUser } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState('name')
  const [titleFilter, setTitleFilter] = useState('')
  const [txnLog, setTxnLog] = useState([])
  const [txnLoading, setTxnLoading] = useState(true)
  const [likes, setLikes] = useState({}) // txnId -> count
  const [myLikes, setMyLikes] = useState(new Set())

  // Match modal state
  const [matchModal, setMatchModal] = useState(null) // { txn, fromName }
  const [matchAmount, setMatchAmount] = useState(1)
  const [matchMsg, setMatchMsg] = useState(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [givenToday, setGivenToday] = useState({})
  const [ctToday, setCtToday] = useState(null)
  const [myData, setMyData] = useState(null)
  const [vestingDays, setVestingDays] = useState(30)

  useEffect(() => {
    fetchAll()
    const empCh = supabase.channel('lb-emp')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, fetchEmployees)
      .subscribe()
    const txnCh = supabase.channel('lb-txn')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spark_transactions' }, fetchTxnLog)
      .subscribe()
    const likeCh = supabase.channel('lb-likes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_likes' }, fetchLikes)
      .subscribe()
    return () => {
      supabase.removeChannel(empCh)
      supabase.removeChannel(txnCh)
      supabase.removeChannel(likeCh)
    }
  }, [])

  const fetchAll = () => { fetchEmployees(); fetchTxnLog(); fetchLikes(); fetchMyContext() }

  const fetchEmployees = async () => {
    const { data } = await supabase.from('employees')
      .select('id, first_name, last_name, vested_sparks, unvested_sparks, job_title, job_grade')
      .eq('is_admin', false)
    if (data) setEmployees(data)
    setLoading(false)
  }

  const fetchTxnLog = async () => {
    const { data } = await supabase
      .from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name, last_name), to_emp:to_employee_id(first_name, last_name)')
      .eq('transaction_type', 'assign')
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setTxnLog(data)
    setTxnLoading(false)
  }

  const fetchLikes = async () => {
    const { data } = await supabase.from('transaction_likes').select('transaction_id, from_employee_id')
    if (!data) return
    const counts = {}
    const mine = new Set()
    data.forEach(l => {
      counts[l.transaction_id] = (counts[l.transaction_id] || 0) + 1
      if (l.from_employee_id === currentUser?.id) mine.add(l.transaction_id)
    })
    setLikes(counts)
    setMyLikes(mine)
  }

  const fetchMyContext = async () => {
    if (!currentUser?.id) return
    const { data: settingsData } = await supabase.from('settings').select('*')
    let vDays = 30
    if (settingsData) {
      const obj = {}; settingsData.forEach(s => { obj[s.key] = s.value })
      vDays = parseInt(obj.vesting_period_days || 30)
      setVestingDays(vDays)
    }
    const { data: todayData } = await supabase.rpc('get_ct_today')
    const today = todayData || new Date().toISOString().split('T')[0]
    setCtToday(today)
    const { data: me } = await supabase.from('employees').select('*').eq('id', currentUser.id).single()
    setMyData(me)
    const { data: givenRows } = await supabase.from('daily_given').select('to_employee_id, amount').eq('from_employee_id', currentUser.id).eq('given_date', today)
    if (givenRows) { const m = {}; givenRows.forEach(r => { m[r.to_employee_id] = r.amount }); setGivenToday(m) }
  }

  // ── Like a transaction ──────────────────────────────
  const handleLike = async (txn) => {
    if (!currentUser || currentUser.is_admin) return
    // Can't like your own spark
    if (txn.from_employee_id === currentUser.id) return
    const already = myLikes.has(txn.id)
    if (already) {
      await supabase.from('transaction_likes').delete().eq('transaction_id', txn.id).eq('from_employee_id', currentUser.id)
      setMyLikes(prev => { const s = new Set(prev); s.delete(txn.id); return s })
      setLikes(prev => ({ ...prev, [txn.id]: Math.max(0, (prev[txn.id] || 1) - 1) }))
    } else {
      await supabase.from('transaction_likes').insert({ transaction_id: txn.id, from_employee_id: currentUser.id })
      setMyLikes(prev => new Set([...prev, txn.id]))
      setLikes(prev => ({ ...prev, [txn.id]: (prev[txn.id] || 0) + 1 }))
      // Prompt to match
      if (!currentUser.is_admin && txn.to_employee_id !== currentUser.id) {
        setMatchModal({ txn })
        setMatchAmount(txn.amount)
        setMatchMsg(null)
      }
    }
  }

  // ── Match spark ─────────────────────────────────────
  const handleMatch = async () => {
    const { txn } = matchModal
    const toId = txn.to_employee_id
    const alreadyGiven = givenToday[toId] || 0
    const perPersonRem = 2 - alreadyGiven
    const totalRem = myData?.daily_sparks_remaining || 0
    const maxMatch = Math.max(0, Math.min(perPersonRem, totalRem, matchAmount))

    if (maxMatch <= 0) {
      setMatchMsg(`You can't give sparks to this person right now (limit reached or no sparks remaining)`)
      return
    }
    const n = Math.min(parseInt(matchAmount) || 1, maxMatch)
    setMatchLoading(true)
    const result = await assignSparks({
      fromId: currentUser.id, toId, amount: n,
      reason: txn.reason ? `Matched: ${txn.reason}` : 'Matched spark',
      vestingDays, ctToday,
      alreadyGivenToRecipient: alreadyGiven,
      currentSenderRemaining: totalRem,
    })
    setMatchLoading(false)
    if (result.error) { setMatchMsg(`Error: ${result.error}`); return }
    setMatchModal(null)
    fetchMyContext()
    fetchTxnLog()
  }

  // ── Sorting / filtering ─────────────────────────────
  let sorted = [...employees]
  if (titleFilter) sorted = sorted.filter(e => e.job_title === titleFilter)
  sorted.sort((a, b) => {
    if (sortMode === 'ranking') return ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))
    if (sortMode === 'title') return (a.job_title||'').localeCompare(b.job_title||'') || a.last_name.localeCompare(b.last_name)
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
  })
  const maxSparks = Math.max(...employees.map(e => (e.vested_sparks||0)+(e.unvested_sparks||0)), 1)
  const getRank = (emp) => [...employees].sort((a,b) => ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))).findIndex(e => e.id === emp.id) + 1

  const usedTitles = [...new Set(employees.map(e => e.job_title).filter(Boolean))].sort()

  return (
    <div className="fade-in">
      <h1 className="page-title">✨ Spark Leaderboard</h1>
      <p className="page-subtitle">Recognizing excellence across the DDE team</p>

      <div style={{display:'flex', gap:'12px', alignItems:'center', marginBottom:'20px', flexWrap:'wrap'}}>
        <div className="sort-control" style={{marginBottom:0}}>
          <span className="sort-label">Sort:</span>
          {SORT_OPTIONS.map(o => (
            <button key={o.value} className={`sort-btn${sortMode===o.value?' active':''}`} onClick={() => setSortMode(o.value)}>{o.label}</button>
          ))}
        </div>
        {usedTitles.length > 0 && (
          <div className="sort-control" style={{marginBottom:0}}>
            <span className="sort-label">Filter by title:</span>
            <button className={`sort-btn${titleFilter===''?' active':''}`} onClick={() => setTitleFilter('')}>All</button>
            {usedTitles.map(t => (
              <button key={t} className={`sort-btn${titleFilter===t?' active':''}`} onClick={() => setTitleFilter(t)}>{t}</button>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{marginBottom:'28px'}}>
        {loading ? <div style={{textAlign:'center',padding:'40px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
        : sorted.length === 0 ? <div className="empty-state"><div className="icon">✨</div><p>No employees{titleFilter ? ' with that title' : ''}</p></div>
        : sorted.map(emp => {
          const total = (emp.vested_sparks||0)+(emp.unvested_sparks||0)
          const rank = getRank(emp)
          const pct = Math.round((total / maxSparks) * 100)
          return (
            <div key={emp.id} className="leaderboard-row">
              <span className={`rank-badge rank-${rank <= 3 ? rank : 'other'}`}>
                {rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}
              </span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:'flex', alignItems:'baseline', gap:'8px', flexWrap:'wrap'}}>
                  <div className="leaderboard-name">{emp.first_name} {emp.last_name}</div>
                  {emp.job_title && <span style={{fontSize:'0.72rem', color:'var(--gold-dark)', background:'rgba(240,192,64,0.1)', border:'1px solid rgba(240,192,64,0.2)', borderRadius:'10px', padding:'2px 8px'}}>{emp.job_title}</span>}
                  {emp.job_grade && <span style={{fontSize:'0.7rem', color:'var(--white-dim)'}}>{emp.job_grade}</span>}
                </div>
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
        })}
      </div>

      {/* Transaction Log with Likes */}
      <div className="card">
        <div className="card-title"><span className="icon">📋</span> Spark Activity Log</div>
        <p style={{color:'var(--white-dim)', fontSize:'0.82rem', marginBottom:'16px'}}>
          All spark activity — click ❤️ to like and optionally match the spark.
        </p>
        {txnLoading ? <div style={{textAlign:'center',padding:'20px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
        : txnLog.length === 0 ? <div className="empty-state"><div className="icon">📋</div><p>No activity yet</p></div>
        : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>From</th><th>To</th><th>✨</th><th>Reason</th><th>Status</th><th>❤️</th></tr></thead>
              <tbody>
                {txnLog.map(txn => {
                  const likeCount = likes[txn.id] || 0
                  const liked = myLikes.has(txn.id)
                  const isOwnTxn = txn.from_employee_id === currentUser?.id
                  const isAdmin = currentUser?.is_admin
                  return (
                    <tr key={txn.id}>
                      <td style={{fontSize:'0.8rem', color:'var(--white-dim)', whiteSpace:'nowrap'}}>{new Date(txn.created_at).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}</td>
                      <td style={{fontWeight:600, fontSize:'0.88rem'}}>{txn.from_emp ? `${txn.from_emp.first_name} ${txn.from_emp.last_name}` : '—'}</td>
                      <td style={{fontWeight:600, fontSize:'0.88rem'}}>{txn.to_emp ? `${txn.to_emp.first_name} ${txn.to_emp.last_name}` : '—'}</td>
                      <td><span className="spark-badge">✨ {txn.amount}</span></td>
                      <td style={{fontSize:'0.82rem', color:'var(--white-dim)', maxWidth:'200px'}}>
                        {txn.reason ? <span style={{color:'var(--white-soft)'}}>{txn.reason}</span> : <span style={{opacity:0.35}}>—</span>}
                      </td>
                      <td><span className={`chip chip-${txn.vested?'green':'gold'}`}>{txn.vested?'Vested':'Pending'}</span></td>
                      <td>
                        <button
                          onClick={() => handleLike(txn)}
                          disabled={isAdmin || isOwnTxn}
                          title={isOwnTxn ? "Can't like your own spark" : liked ? 'Unlike' : 'Like & optionally match'}
                          style={{background:'none', border:'none', cursor: (isAdmin || isOwnTxn) ? 'default' : 'pointer', padding:'4px 6px', borderRadius:'6px', display:'inline-flex', alignItems:'center', gap:'4px', transition:'all 0.15s', opacity: (isAdmin || isOwnTxn) ? 0.35 : 1, background: liked ? 'rgba(224,85,85,0.15)' : 'transparent'}}>
                          <span style={{fontSize:'1rem'}}>{liked ? '❤️' : '🤍'}</span>
                          {likeCount > 0 && <span style={{fontSize:'0.75rem', color: liked ? '#ff8080' : 'var(--white-dim)', fontWeight:600}}>{likeCount}</span>}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Match Spark Modal */}
      {matchModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMatchModal(null)}>
          <div className="modal">
            <div className="modal-title">❤️ You liked that spark! Want to match it?</div>
            <div style={{background:'rgba(0,0,0,0.2)', borderRadius:'8px', padding:'12px', marginBottom:'16px', fontSize:'0.85rem'}}>
              <div><strong style={{color:'var(--gold)'}}>Original spark:</strong> {matchModal.txn.from_emp?.first_name} → {matchModal.txn.to_emp?.first_name} {matchModal.txn.to_emp?.last_name}</div>
              <div style={{marginTop:'4px'}}><strong style={{color:'var(--gold)'}}>Amount:</strong> ✨ {matchModal.txn.amount}</div>
              {matchModal.txn.reason && <div style={{marginTop:'4px', color:'var(--white-dim)'}}><strong style={{color:'var(--gold)'}}>Reason:</strong> {matchModal.txn.reason}</div>}
            </div>

            {matchMsg && <div className="alert alert-error" style={{marginBottom:'12px'}}>{matchMsg}</div>}

            <div className="form-group">
              <label className="form-label">
                Sparks to give (max {Math.min(2 - (givenToday[matchModal.txn.to_employee_id]||0), myData?.daily_sparks_remaining||0)})
              </label>
              <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                {[...Array(Math.max(0, Math.min(2 - (givenToday[matchModal.txn.to_employee_id]||0), myData?.daily_sparks_remaining||0, matchModal.txn.amount)))].map((_,i) => (
                  <button key={i+1}
                    onClick={() => setMatchAmount(i+1)}
                    className={`btn btn-sm ${matchAmount === i+1 ? 'btn-gold' : 'btn-outline'}`}>
                    {i+1}
                  </button>
                ))}
              </div>
            </div>

            <p style={{fontSize:'0.8rem', color:'var(--white-dim)', marginBottom:'16px'}}>
              You have {myData?.daily_sparks_remaining || 0} sparks left. These will vest in {vestingDays} days with the same reason.
            </p>

            <div style={{display:'flex', gap:'10px', flexWrap:'wrap'}}>
              <button className="btn btn-gold" onClick={handleMatch} disabled={matchLoading}>
                {matchLoading ? 'Sending...' : `✨ Match ${matchAmount} Spark${matchAmount !== 1 ? 's' : ''}`}
              </button>
              <button className="btn btn-outline" onClick={() => setMatchModal(null)}>Just Like, No Match</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
