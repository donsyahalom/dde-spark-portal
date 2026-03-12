import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { assignSparks } from '../lib/sparkHelpers'
import { REASON_CATEGORIES, buildReason, getFrequencyLabel, getFrequencyResetDesc, getPeriodLabel } from '../lib/constants'
import { addDays, format, differenceInHours, differenceInDays } from 'date-fns'

const PER_PERSON_CAP = 2

export default function EmployeePage() {
  const { currentUser, refreshUser } = useAuth()
  const [me, setMe] = useState(currentUser)
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({ vesting_period_days: 30, spark_frequency: 'daily' })
  const [givenToday, setGivenToday] = useState({})
  const [ctToday, setCtToday] = useState(null)
  const [nextReset, setNextReset] = useState(null)

  // Single give form
  const [selEmp, setSelEmp] = useState('')
  const [amount, setAmount] = useState(1)
  const [reasonCat, setReasonCat] = useState('')
  const [reasonText, setReasonText] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  // List distribution form
  const [listAmounts, setListAmounts] = useState({}) // empId -> amount string
  const [listReasonCat, setListReasonCat] = useState('')
  const [listReasonText, setListReasonText] = useState('')
  const [listMsg, setListMsg] = useState(null)
  const [listLoading, setListLoading] = useState(false)

  // History
  const [historyGiven, setHistoryGiven] = useState([])
  const [historyReceived, setHistoryReceived] = useState([])

  // Watchlist
  const [watchlistIds, setWatchlistIds] = useState([])
  const [watchlistTxns, setWatchlistTxns] = useState([])
  const [watchlistEditing, setWatchlistEditing] = useState(false)

  const isManagement = me?.is_management || false
  const hasList = me?.has_spark_list || false

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    await supabase.rpc('reset_daily_sparks')
    await supabase.rpc('process_vesting')

    const { data: todayData } = await supabase.rpc('get_ct_today')
    const today = todayData || new Date().toISOString().split('T')[0]
    setCtToday(today)

    // Settings
    const { data: settingsData } = await supabase.from('settings').select('*')
    const sObj = {}
    if (settingsData) settingsData.forEach(s => { sObj[s.key] = s.value })
    const freq = sObj.spark_frequency || 'daily'
    setSettings({
      vesting_period_days: parseInt(sObj.vesting_period_days || 30),
      spark_frequency: freq,
    })

    // Next reset time
    const { data: resetTime } = await supabase.rpc('get_next_reset', { freq })
    setNextReset(resetTime)

    // All other employees
    const { data: emps } = await supabase
      .from('employees')
      .select('id, first_name, last_name, job_title')
      .eq('is_admin', false)
      .neq('id', currentUser.id)
      .order('last_name')
    if (emps) setEmployees(emps)

    // Per-recipient given counts
    const { data: givenRows } = await supabase
      .from('daily_given')
      .select('to_employee_id, amount')
      .eq('from_employee_id', currentUser.id)
      .eq('given_date', today)
    if (givenRows) {
      const map = {}
      givenRows.forEach(r => { map[r.to_employee_id] = r.amount })
      setGivenToday(map)
    }

    // Given history
    const { data: given } = await supabase
      .from('spark_transactions')
      .select('*, to_employee:to_employee_id(first_name, last_name)')
      .eq('from_employee_id', currentUser.id)
      .eq('transaction_type', 'assign')
      .order('created_at', { ascending: false })
      .limit(40)
    if (given) setHistoryGiven(given)

    // Received history
    const { data: received } = await supabase
      .from('spark_transactions')
      .select('*, from_employee:from_employee_id(first_name, last_name)')
      .eq('to_employee_id', currentUser.id)
      .eq('transaction_type', 'assign')
      .order('created_at', { ascending: false })
      .limit(40)
    if (received) setHistoryReceived(received)

    // Refresh self
    const updated = await refreshUser()
    if (updated) {
      setMe(updated)
      setWatchlistIds(updated.watchlist || [])
    }
  }

  const fetchWatchlistTxns = async (ids) => {
    if (!ids || ids.length === 0) { setWatchlistTxns([]); return }
    const { data } = await supabase
      .from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name, last_name), to_emp:to_employee_id(first_name, last_name)')
      .in('to_employee_id', ids)
      .eq('transaction_type', 'assign')
      .order('created_at', { ascending: false })
      .limit(60)
    if (data) setWatchlistTxns(data)
  }

  useEffect(() => { fetchWatchlistTxns(watchlistIds) }, [watchlistIds])

  // Realtime self-update
  useEffect(() => {
    const channel = supabase.channel('emp-self')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${currentUser.id}` }, async () => {
        const updated = await refreshUser()
        if (updated) { setMe(updated); setWatchlistIds(updated.watchlist || []) }
      }).subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const dailyRemaining = me?.daily_sparks_remaining || 0
  const dailyAllowance = me?.daily_accrual || 0
  const alreadyGivenToSel = selEmp ? (givenToday[selEmp] || 0) : 0
  const perPersonRemaining = PER_PERSON_CAP - alreadyGivenToSel
  const maxCanGive = Math.max(0, Math.min(perPersonRemaining, dailyRemaining))
  const totalSparks = (me?.vested_sparks || 0) + (me?.unvested_sparks || 0)
  const freqLabel = getFrequencyLabel(settings.spark_frequency)
  const resetDesc = getFrequencyResetDesc(settings.spark_frequency)
  const periodLabel = getPeriodLabel(settings.spark_frequency)

  // Expiry countdown
  const expiryAlert = useMemo(() => {
    if (!dailyRemaining || dailyRemaining <= 0 || !nextReset) return null
    const resetDate = new Date(nextReset)
    const now = new Date()
    const hoursLeft = differenceInHours(resetDate, now)
    const daysLeft = differenceInDays(resetDate, now)
    let timeStr = hoursLeft < 24 ? `${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}` : `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
    return `You have ${dailyRemaining} spark${dailyRemaining !== 1 ? 's' : ''} to give — they expire in ${timeStr}. Use them before they reset!`
  }, [dailyRemaining, nextReset])

  // ── SINGLE ASSIGN ──────────────────────────────────────
  const handleAssign = async () => {
    if (!selEmp) { setMsg({ type: 'error', text: 'Please select an employee' }); return }
    const n = parseInt(amount)
    if (n < 1 || n > maxCanGive) { setMsg({ type: 'error', text: `Max ${maxCanGive} spark${maxCanGive !== 1 ? 's' : ''} to this person` }); return }
    setLoading(true); setMsg(null)
    const reason = buildReason(reasonCat, reasonText)
    const result = await assignSparks({
      fromId: currentUser.id, toId: selEmp, amount: n, reason,
      vestingDays: settings.vesting_period_days, ctToday,
      alreadyGivenToRecipient: alreadyGivenToSel, currentSenderRemaining: dailyRemaining,
    })
    setLoading(false)
    if (result.error) { setMsg({ type: 'error', text: result.error }); return }
    const name = employees.find(e => e.id === selEmp)
    setMsg({ type: 'success', text: `✨ ${n} spark${n > 1 ? 's' : ''} given to ${name?.first_name}!` })
    setSelEmp(''); setAmount(1); setReasonCat(''); setReasonText('')
    fetchAll()
  }

  // ── LIST DISTRIBUTION ──────────────────────────────────
  const listTotal = Object.values(listAmounts).reduce((s, v) => s + (parseInt(v) || 0), 0)

  const handleListDistribute = async () => {
    setListLoading(true); setListMsg(null)
    const reason = buildReason(listReasonCat, listReasonText)
    const entries = Object.entries(listAmounts).filter(([, v]) => parseInt(v) > 0)
    if (!entries.length) { setListMsg({ type: 'error', text: 'Enter at least one amount' }); setListLoading(false); return }

    // Validate all limits before sending
    let currentRemaining = dailyRemaining
    for (const [empId, valStr] of entries) {
      const n = parseInt(valStr)
      const alreadyGiven = givenToday[empId] || 0
      if (n > PER_PERSON_CAP - alreadyGiven) {
        const name = employees.find(e => e.id === empId)
        setListMsg({ type: 'error', text: `Too many sparks for ${name?.first_name} ${name?.last_name} — max ${PER_PERSON_CAP - alreadyGiven} today` })
        setListLoading(false); return
      }
      if (n > currentRemaining) {
        setListMsg({ type: 'error', text: `Not enough sparks remaining (${currentRemaining} left)` })
        setListLoading(false); return
      }
      currentRemaining -= n
    }

    // Re-fetch latest state before sending
    const { data: latestMe } = await supabase.from('employees').select('daily_sparks_remaining').eq('id', currentUser.id).single()
    let senderRemaining = latestMe?.daily_sparks_remaining || 0

    let errors = 0
    for (const [empId, valStr] of entries) {
      const n = parseInt(valStr)
      const alreadyGiven = givenToday[empId] || 0
      const result = await assignSparks({
        fromId: currentUser.id, toId: empId, amount: n, reason,
        vestingDays: settings.vesting_period_days, ctToday,
        alreadyGivenToRecipient: alreadyGiven, currentSenderRemaining: senderRemaining,
        isListDistribution: true,
      })
      if (result.error) errors++
      else senderRemaining = Math.max(0, senderRemaining - n)
    }

    setListLoading(false)
    if (errors) setListMsg({ type: 'error', text: `${errors} assignment(s) failed` })
    else {
      setListMsg({ type: 'success', text: `✨ Distributed sparks to ${entries.length} employees!` })
      setListAmounts({}); setListReasonCat(''); setListReasonText('')
    }
    fetchAll()
  }

  // ── WATCHLIST ──────────────────────────────────────────
  const saveWatchlist = async (newIds) => {
    await supabase.from('employees').update({ watchlist: newIds }).eq('id', currentUser.id)
    setWatchlistIds(newIds)
    fetchWatchlistTxns(newIds)
    setWatchlistEditing(false)
  }

  return (
    <div className="fade-in">
      {/* Expiry reminder banner */}
      {expiryAlert && (
        <div style={{background:'rgba(224,85,85,0.2)', border:'1px solid rgba(224,85,85,0.5)', borderRadius:'10px', padding:'12px 16px', marginBottom:'20px', color:'#ff8080', fontWeight:600, fontSize:'0.9rem'}}>
          ⚠️ {expiryAlert}
        </div>
      )}

      <h1 className="page-title">My Sparks</h1>
      <p className="page-subtitle">Recognize your colleagues with sparks</p>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--gold-light)'}}>{totalSparks}</div>
          <div className="stat-label">Total Sparks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{me?.vested_sparks || 0}</div>
          <div className="stat-label">Vested</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--white-dim)'}}>{me?.unvested_sparks || 0}</div>
          <div className="stat-label">Pending Vesting</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{color: dailyRemaining > 0 ? 'var(--green-bright)' : 'var(--red)'}}>
            {dailyRemaining}<span style={{fontSize:'0.9rem', color:'var(--white-dim)'}}> / {dailyAllowance}</span>
          </div>
          <div className="stat-label">{freqLabel} Sparks Left</div>
        </div>
      </div>

      {/* ── GIVE A SPARK ── */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div className="card-title"><span className="icon">✨</span> Give a Spark</div>
        {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
        {dailyRemaining === 0 ? (
          <div className="alert alert-warning">
            🌙 You've used all your {periodLabel} sparks! They reset at {resetDesc}.
          </div>
        ) : (
          <>
            <div className="alert alert-warning" style={{marginBottom:'16px', fontSize:'0.82rem'}}>
              <strong>Rules:</strong> {dailyAllowance} sparks per {periodLabel} total · max {PER_PERSON_CAP} per person per {periodLabel} ·
              vests in {settings.vesting_period_days} days · resets at {resetDesc}
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Give Sparks To</label>
                <select className="form-select" value={selEmp} onChange={e => { setSelEmp(e.target.value); setAmount(1); setMsg(null) }}>
                  <option value="">Select employee...</option>
                  {employees.map(e => {
                    const given = givenToday[e.id] || 0
                    const canGive = PER_PERSON_CAP - given
                    return <option key={e.id} value={e.id} disabled={canGive <= 0 || dailyRemaining <= 0}>
                      {e.first_name} {e.last_name}{e.job_title ? ` — ${e.job_title}` : ''}
                      {canGive <= 0 ? ' (limit reached)' : given > 0 ? ` (${given} given)` : ''}
                    </option>
                  })}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Amount{selEmp && maxCanGive > 0 && <span style={{color:'var(--white-dim)', fontWeight:400, textTransform:'none', letterSpacing:0}}> (max {maxCanGive})</span>}</label>
                <select className="form-select" value={amount} onChange={e => setAmount(e.target.value)} disabled={!selEmp || maxCanGive <= 0}>
                  {maxCanGive > 0 ? [...Array(maxCanGive)].map((_,i) => <option key={i+1} value={i+1}>{i+1}</option>) : <option value={0}>0</option>}
                </select>
              </div>
            </div>
            <div style={{borderTop:'1px solid var(--border)', paddingTop:'14px', marginBottom:'14px'}}>
              <div style={{fontSize:'0.72rem', textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--white-dim)', marginBottom:'10px'}}>
                Recognition Reason <span style={{opacity:0.5}}>(optional)</span>
              </div>
              <div className="form-grid">
                <div className="form-group" style={{marginBottom:'8px'}}>
                  <label className="form-label">Category</label>
                  <select className="form-select" value={reasonCat} onChange={e => setReasonCat(e.target.value)}>
                    <option value="">Select category...</option>
                    {REASON_CATEGORIES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:'8px'}}>
                  <label className="form-label">Additional Details</label>
                  <input className="form-input" value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="Describe what they did..." maxLength={200} />
                </div>
              </div>
            </div>
            <button className="btn btn-gold" onClick={handleAssign} disabled={loading || !selEmp || maxCanGive <= 0}>
              {loading ? 'Sending...' : '✨ Give Spark'}
            </button>
          </>
        )}
      </div>

      {/* ── LIST DISTRIBUTION (only for has_spark_list users) ── */}
      {hasList && (
        <div className="card" style={{marginBottom:'20px'}}>
          <div className="card-title"><span className="icon">📋</span> {freqLabel} Spark Distribution List</div>
          {listMsg && <div className={`alert alert-${listMsg.type}`}>{listMsg.text}</div>}
          <p style={{color:'var(--white-dim)', fontSize:'0.83rem', marginBottom:'16px'}}>
            Assign sparks to multiple employees at once. All same limits apply: max {PER_PERSON_CAP} per person, {dailyRemaining} remaining today.
            {listTotal > 0 && <span style={{color:'var(--gold)', marginLeft:'8px'}}>Total to give: {listTotal}</span>}
          </p>

          {/* Single reason for the whole list */}
          <div className="form-grid" style={{marginBottom:'14px'}}>
            <div className="form-group" style={{marginBottom:'8px'}}>
              <label className="form-label">Reason Category <span style={{opacity:0.5}}>(optional, applies to all)</span></label>
              <select className="form-select" value={listReasonCat} onChange={e => setListReasonCat(e.target.value)}>
                <option value="">Select category...</option>
                {REASON_CATEGORIES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:'8px'}}>
              <label className="form-label">Additional Details</label>
              <input className="form-input" value={listReasonText} onChange={e => setListReasonText(e.target.value)} placeholder="Applies to everyone on this list..." maxLength={200} />
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:'10px', marginBottom:'16px'}}>
            {employees.map(emp => {
              const alreadyGiven = givenToday[emp.id] || 0
              const canGive = Math.min(PER_PERSON_CAP - alreadyGiven, dailyRemaining)
              const val = listAmounts[emp.id] || ''
              return (
                <div key={emp.id} style={{display:'flex', alignItems:'center', gap:'10px', background:'rgba(0,0,0,0.2)', borderRadius:'8px', padding:'10px 12px', border:'1px solid var(--border)'}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600, fontSize:'0.88rem'}}>{emp.first_name} {emp.last_name}</div>
                    {emp.job_title && <div style={{fontSize:'0.72rem', color:'var(--white-dim)'}}>{emp.job_title}</div>}
                    {alreadyGiven > 0 && <div style={{fontSize:'0.7rem', color:'var(--gold)'}}>Given today: {alreadyGiven}</div>}
                  </div>
                  <input
                    type="number" min="0" max={canGive > 0 ? canGive : 0}
                    value={val}
                    onChange={e => setListAmounts(prev => ({ ...prev, [emp.id]: e.target.value }))}
                    placeholder="0"
                    disabled={canGive <= 0}
                    style={{width:'60px', background:'rgba(0,0,0,0.5)', border:`1px solid ${canGive <= 0 ? 'rgba(224,85,85,0.3)' : 'var(--gold-dark)'}`, borderRadius:'6px', color: canGive <= 0 ? 'var(--white-dim)' : 'var(--white)', padding:'6px 8px', textAlign:'center', fontSize:'0.9rem', outline:'none'}}
                  />
                  <span style={{fontSize:'0.72rem', color:'var(--white-dim)'}}>/ {canGive > 0 ? canGive : 0}</span>
                </div>
              )
            })}
          </div>

          <button className="btn btn-gold" onClick={handleListDistribute} disabled={listLoading || listTotal === 0 || dailyRemaining === 0}>
            {listLoading ? 'Distributing...' : `✨ Distribute ${listTotal > 0 ? listTotal + ' Sparks' : 'Sparks'}`}
          </button>
        </div>
      )}

      {/* ── SPARKS I'VE GIVEN ── */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div className="card-title"><span className="icon">📤</span> Sparks I've Given</div>
        <TxnTable rows={historyGiven} mode="given" />
      </div>

      {/* ── SPARKS I'VE RECEIVED ── */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div className="card-title"><span className="icon">📥</span> Sparks I've Received</div>
        <TxnTable rows={historyReceived} mode="received" />
      </div>

      {/* ── WATCHLIST (management only) ── */}
      {isManagement && (
        <div className="card">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px', flexWrap:'wrap', gap:'10px'}}>
            <div className="card-title" style={{marginBottom:0}}><span className="icon">👁️</span> Sparks I'm Watching</div>
            <button className="btn btn-outline btn-sm" onClick={() => setWatchlistEditing(v => !v)}>
              {watchlistEditing ? 'Close' : '⚙️ Edit Watchlist'}
            </button>
          </div>

          {watchlistEditing && (
            <div style={{marginBottom:'20px', background:'rgba(0,0,0,0.2)', padding:'16px', borderRadius:'8px', border:'1px solid var(--border)'}}>
              <p style={{fontSize:'0.82rem', color:'var(--white-dim)', marginBottom:'10px'}}>Select employees to watch:</p>
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'8px', marginBottom:'12px'}}>
                {employees.map(emp => {
                  const checked = watchlistIds.includes(emp.id)
                  return (
                    <label key={emp.id} style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', padding:'8px 10px', background: checked ? 'rgba(240,192,64,0.1)' : 'rgba(0,0,0,0.2)', borderRadius:'6px', border:`1px solid ${checked ? 'var(--border-bright)' : 'var(--border)'}`, transition:'all 0.2s'}}>
                      <input type="checkbox" checked={checked}
                        onChange={e => {
                          if (e.target.checked) setWatchlistIds(prev => [...prev, emp.id])
                          else setWatchlistIds(prev => prev.filter(id => id !== emp.id))
                        }}
                        style={{accentColor:'var(--gold)'}} />
                      <span style={{fontSize:'0.85rem'}}>{emp.first_name} {emp.last_name}</span>
                    </label>
                  )
                })}
              </div>
              <button className="btn btn-gold btn-sm" onClick={() => saveWatchlist(watchlistIds)}>💾 Save Watchlist</button>
            </div>
          )}

          {watchlistIds.length === 0 ? (
            <div className="empty-state"><div className="icon">👁️</div><p>No employees on your watchlist yet. Click Edit Watchlist to add some.</p></div>
          ) : watchlistTxns.length === 0 ? (
            <div className="empty-state"><div className="icon">📋</div><p>No spark activity for watched employees yet.</p></div>
          ) : (
            <>
              <p style={{fontSize:'0.8rem', color:'var(--white-dim)', marginBottom:'12px'}}>
                Watching {watchlistIds.length} employee{watchlistIds.length !== 1 ? 's' : ''} — showing their recent spark activity
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Employee</th><th>From</th><th>✨</th><th>Reason</th><th>Status</th></tr></thead>
                  <tbody>
                    {watchlistTxns.map(txn => (
                      <tr key={txn.id}>
                        <td style={{fontSize:'0.8rem', color:'var(--white-dim)', whiteSpace:'nowrap'}}>{new Date(txn.created_at).toLocaleDateString()}</td>
                        <td style={{fontWeight:600}}>{txn.to_emp?.first_name} {txn.to_emp?.last_name}</td>
                        <td style={{fontSize:'0.85rem'}}>{txn.from_emp?.first_name} {txn.from_emp?.last_name}</td>
                        <td><span className="spark-badge">✨ {txn.amount}</span></td>
                        <td style={{fontSize:'0.82rem', color:'var(--white-dim)', maxWidth:'180px'}}>{txn.reason || <span style={{opacity:0.35}}>—</span>}</td>
                        <td><span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>{txn.vested ? 'Vested' : 'Pending'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TxnTable({ rows, mode }) {
  if (rows.length === 0) return <div className="empty-state"><div className="icon">{mode === 'given' ? '📤' : '📥'}</div><p>No sparks {mode === 'given' ? 'given' : 'received'} yet</p></div>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{mode === 'given' ? 'To' : 'From'}</th>
            <th>✨</th>
            <th>Reason</th>
            <th>Vests On</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(txn => (
            <tr key={txn.id}>
              <td style={{fontWeight:600}}>
                {mode === 'given'
                  ? `${txn.to_employee?.first_name || ''} ${txn.to_employee?.last_name || ''}`
                  : txn.from_employee
                    ? `${txn.from_employee.first_name} ${txn.from_employee.last_name}`
                    : <span style={{color:'var(--white-dim)'}}>Admin</span>}
              </td>
              <td><span className="spark-badge">✨ {txn.amount}</span></td>
              <td style={{fontSize:'0.82rem', color:'var(--white-dim)', maxWidth:'200px'}}>
                {txn.reason ? <span style={{color:'var(--white-soft)'}}>{txn.reason}</span> : <span style={{opacity:0.35}}>—</span>}
              </td>
              <td style={{fontSize:'0.8rem'}}>{txn.vesting_date || '—'}</td>
              <td><span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>{txn.vested ? 'Vested' : 'Pending'}</span></td>
              <td style={{fontSize:'0.8rem', color:'var(--white-dim)', whiteSpace:'nowrap'}}>{new Date(txn.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
