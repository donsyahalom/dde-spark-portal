import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { assignSparks } from '../lib/sparkHelpers'
import { buildReason, getRangeWindow } from '../lib/constants'

// ── SparkLogTable ─────────────────────────────────────────────────────────────
// Renders the activity log. Admins get an Edit button on each row that opens
// an inline edit/delete panel. Non-admins see the like button as before.
// On delete:  recipient loses sparks (vested first, then unvested), sender gets accrual back.
// On edit:    if recipient changes, old recipient loses, new recipient gains. Amount diffs adjust.
function SparkLogTable({ txnLog, txnLoading, likes, myLikes, isAdmin, currentUser, onLike, onRefresh }) {
  const [editId, setEditId] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [employees, setEmployees] = useState([])
  const [reasons, setReasons] = useState([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [msg, setMsg] = useState(null)

  const showMsg = (text, type='success') => { setMsg({text,type}); setTimeout(()=>setMsg(null),4000) }

  useEffect(() => {
    if (!isAdmin) return
    Promise.all([
      supabase.from('employees').select('id,first_name,last_name').eq('is_admin',false).order('last_name'),
      supabase.from('custom_lists').select('value').eq('list_type','reason_category').order('sort_order'),
    ]).then(([{data:emps},{data:rsns}]) => {
      setEmployees(emps||[])
      setReasons((rsns||[]).map(r=>r.value))
    })
  }, [isAdmin])

  const openEdit = (txn) => {
    setEditId(txn.id)
    setEditValues({
      from_employee_id: txn.from_employee_id,
      to_employee_id:   txn.to_employee_id,
      amount:           txn.amount,
      reason:           txn.reason || '',
    })
    setConfirmDelete(null)
  }

  const cancelEdit = () => { setEditId(null); setEditValues({}); setConfirmDelete(null) }

  // ── Delete a spark — cycles balances back ────────────────────────────────
  const handleDelete = async (txn) => {
    setSaving(true)
    try {
      const amount = txn.amount || 0

      // 1. Remove sparks from recipient (vested first, then unvested)
      const { data: recipient } = await supabase.from('employees')
        .select('vested_sparks,unvested_sparks').eq('id', txn.to_employee_id).single()
      if (recipient) {
        const fromVested   = Math.min(amount, recipient.vested_sparks || 0)
        const fromUnvested = Math.min(amount - fromVested, recipient.unvested_sparks || 0)
        await supabase.from('employees').update({
          vested_sparks:   Math.max(0, (recipient.vested_sparks||0)  - fromVested),
          unvested_sparks: Math.max(0, (recipient.unvested_sparks||0) - fromUnvested),
        }).eq('id', txn.to_employee_id)
      }

      // 2. Return sparks to sender's giving allowance
      const { data: sender } = await supabase.from('employees')
        .select('daily_sparks_remaining,daily_accrual').eq('id', txn.from_employee_id).single()
      if (sender) {
        await supabase.from('employees').update({
          daily_sparks_remaining: Math.min(
            (sender.daily_accrual || 0),
            (sender.daily_sparks_remaining || 0) + amount
          ),
        }).eq('id', txn.from_employee_id)
      }

      // 3. Delete transaction and its likes
      await supabase.from('transaction_likes').delete().eq('transaction_id', txn.id)
      await supabase.from('spark_transactions').delete().eq('id', txn.id)

      // 4. Log the admin action
      await supabase.from('spark_transactions').insert({
        from_employee_id: null,
        to_employee_id:   null,
        amount:           -amount,
        transaction_type: 'admin_delete',
        note: `Admin deleted txn ${txn.id} (was ${txn.from_emp?.first_name} → ${txn.to_emp?.first_name}, ${amount} sparks)`,
        vested: false,
      }).catch(()=>{})

      showMsg('Spark deleted and balances restored.')
      cancelEdit()
      onRefresh()
    } catch(e) {
      showMsg('Delete failed: ' + e.message, 'error')
    }
    setSaving(false)
  }

  // ── Edit a spark — adjust balances for any changes ───────────────────────
  const handleSave = async (txn) => {
    setSaving(true)
    try {
      const oldAmount    = txn.amount || 0
      const newAmount    = parseInt(editValues.amount) || 0
      const oldRecipient = txn.to_employee_id
      const newRecipient = editValues.to_employee_id
      const oldSender    = txn.from_employee_id
      const newSender    = editValues.from_employee_id

      // ── Recipient changed ──────────────────────────────────────────────
      if (oldRecipient !== newRecipient) {
        // Remove sparks from old recipient
        const { data: oldRec } = await supabase.from('employees')
          .select('vested_sparks,unvested_sparks').eq('id',oldRecipient).single()
        if (oldRec) {
          const fromV = Math.min(oldAmount, oldRec.vested_sparks||0)
          const fromU = Math.min(oldAmount-fromV, oldRec.unvested_sparks||0)
          await supabase.from('employees').update({
            vested_sparks:   Math.max(0,(oldRec.vested_sparks||0)-fromV),
            unvested_sparks: Math.max(0,(oldRec.unvested_sparks||0)-fromU),
          }).eq('id',oldRecipient)
        }
        // Add new amount to new recipient as unvested
        const { data: newRec } = await supabase.from('employees')
          .select('unvested_sparks').eq('id',newRecipient).single()
        if (newRec) {
          await supabase.from('employees').update({
            unvested_sparks: (newRec.unvested_sparks||0) + newAmount,
          }).eq('id',newRecipient)
        }
      } else if (newAmount !== oldAmount) {
        // Same recipient, just amount changed — adjust unvested
        const diff = newAmount - oldAmount
        const { data: rec } = await supabase.from('employees')
          .select('vested_sparks,unvested_sparks').eq('id',oldRecipient).single()
        if (rec) {
          if (diff > 0) {
            // Adding more — goes in as unvested
            await supabase.from('employees').update({ unvested_sparks: (rec.unvested_sparks||0) + diff }).eq('id',oldRecipient)
          } else {
            // Removing — take from vested first then unvested
            const take = Math.abs(diff)
            const fromV = Math.min(take, rec.vested_sparks||0)
            const fromU = Math.min(take-fromV, rec.unvested_sparks||0)
            await supabase.from('employees').update({
              vested_sparks:   Math.max(0,(rec.vested_sparks||0)-fromV),
              unvested_sparks: Math.max(0,(rec.unvested_sparks||0)-fromU),
            }).eq('id',oldRecipient)
          }
        }
      }

      // ── Sender changed ─────────────────────────────────────────────────
      if (oldSender !== newSender) {
        // Restore allowance to old sender
        const { data: oldS } = await supabase.from('employees')
          .select('daily_sparks_remaining,daily_accrual').eq('id',oldSender).single()
        if (oldS) {
          await supabase.from('employees').update({
            daily_sparks_remaining: Math.min(oldS.daily_accrual||0, (oldS.daily_sparks_remaining||0)+oldAmount)
          }).eq('id',oldSender)
        }
        // Deduct from new sender's allowance
        const { data: newS } = await supabase.from('employees')
          .select('daily_sparks_remaining').eq('id',newSender).single()
        if (newS) {
          await supabase.from('employees').update({
            daily_sparks_remaining: Math.max(0,(newS.daily_sparks_remaining||0)-newAmount)
          }).eq('id',newSender)
        }
      } else if (newAmount !== oldAmount && oldRecipient === newRecipient) {
        // Same sender, amount changed — adjust their remaining allowance
        const diff = oldAmount - newAmount // positive = they get some back
        const { data: snd } = await supabase.from('employees')
          .select('daily_sparks_remaining,daily_accrual').eq('id',oldSender).single()
        if (snd) {
          await supabase.from('employees').update({
            daily_sparks_remaining: Math.min(snd.daily_accrual||0, Math.max(0,(snd.daily_sparks_remaining||0)+diff))
          }).eq('id',oldSender)
        }
      }

      // ── Update the transaction record ──────────────────────────────────
      await supabase.from('spark_transactions').update({
        from_employee_id: editValues.from_employee_id,
        to_employee_id:   editValues.to_employee_id,
        amount:           newAmount,
        reason:           editValues.reason || null,
      }).eq('id', txn.id)

      showMsg('Spark updated.')
      cancelEdit()
      onRefresh()
    } catch(e) {
      showMsg('Save failed: ' + e.message, 'error')
    }
    setSaving(false)
  }

  const empName = (id) => {
    const e = employees.find(x=>x.id===id)
    return e ? `${e.first_name} ${e.last_name}` : id
  }

  if (txnLoading) return <div style={{textAlign:'center',padding:'20px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
  if (txnLog.length === 0) return <div className="empty-state"><div className="icon">📋</div><p>No activity yet</p></div>

  return (
    <>
      {msg && (
        <div style={{marginBottom:12,padding:'9px 14px',borderRadius:7,fontSize:'0.83rem',
          background:msg.type==='error'?'rgba(224,85,85,0.12)':'rgba(94,232,138,0.1)',
          border:`1px solid ${msg.type==='error'?'rgba(224,85,85,0.4)':'rgba(94,232,138,0.3)'}`,
          color:msg.type==='error'?'#ff8a8a':'var(--green-bright)'}}>
          {msg.text}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>From</th><th>To</th><th>✨</th><th>Reason</th>
              {isAdmin ? <th style={{width:60}}>Edit</th> : <th>❤️</th>}
            </tr>
          </thead>
          <tbody>
            {txnLog.map(txn => {
              const likeCount = likes[txn.id] || 0
              const liked = myLikes.has(txn.id)
              const isSender    = txn.from_employee_id === currentUser?.id
              const isRecipient = txn.to_employee_id   === currentUser?.id
              const canLike = !isAdmin && !isSender && !isRecipient
              const isEditing = isAdmin && editId === txn.id

              return (
                <>
                  <tr key={txn.id} style={isEditing ? {background:'rgba(240,192,64,0.06)'} : {}}>
                    <td style={{fontSize:'0.78rem',color:'var(--white-dim)',whiteSpace:'nowrap'}}>
                      {new Date(txn.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                    </td>
                    <td style={{fontWeight:600,fontSize:'0.86rem'}}>
                      {txn.from_emp?`${txn.from_emp.first_name} ${txn.from_emp.last_name}`:'—'}
                    </td>
                    <td style={{fontWeight:600,fontSize:'0.86rem'}}>
                      {txn.to_emp?`${txn.to_emp.first_name} ${txn.to_emp.last_name}`:'—'}
                    </td>
                    <td><span className="spark-badge">✨ {txn.amount}</span></td>
                    <td style={{fontSize:'0.8rem',color:'var(--white-soft)',maxWidth:'200px'}}>
                      {txn.reason||<span style={{opacity:0.3}}>—</span>}
                    </td>
                    {isAdmin ? (
                      <td>
                        {!isEditing
                          ? <button className="btn btn-outline btn-sm" style={{padding:'3px 10px',fontSize:'0.75rem'}}
                              onClick={()=>openEdit(txn)}>Edit</button>
                          : <button className="btn btn-outline btn-sm" style={{padding:'3px 10px',fontSize:'0.75rem',opacity:0.5}}
                              onClick={cancelEdit}>Cancel</button>
                        }
                      </td>
                    ) : (
                      <td>
                        <button onClick={()=>canLike&&onLike(txn)}
                          title={isAdmin?'Admins cannot like':isSender?"Can't like your own":isRecipient?"Can't like yours":''}
                          style={{background:liked?'rgba(224,85,85,0.15)':'none',border:'none',cursor:canLike?'pointer':'default',
                            padding:'4px 6px',borderRadius:'6px',display:'inline-flex',alignItems:'center',gap:'4px',opacity:canLike?1:0.3}}>
                          <span style={{fontSize:'1rem'}}>{liked?'❤️':'🤍'}</span>
                          {likeCount>0&&<span style={{fontSize:'0.72rem',color:liked?'#ff8080':'var(--white-dim)',fontWeight:600}}>{likeCount}</span>}
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* ── Inline Edit Panel ── */}
                  {isEditing && (
                    <tr key={`edit-${txn.id}`}>
                      <td colSpan={6} style={{padding:0}}>
                        <div style={{background:'rgba(240,192,64,0.05)',border:'1px solid rgba(240,192,64,0.25)',
                          borderRadius:8,margin:'4px 8px 8px',padding:'16px',display:'flex',flexDirection:'column',gap:12}}>

                          <div style={{fontFamily:'var(--font-display)',fontSize:'0.72rem',color:'var(--gold)',letterSpacing:'0.1em'}}>
                            EDITING SPARK — CHANGES UPDATE BALANCES IMMEDIATELY
                          </div>

                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 80px',gap:10}}>
                            <div>
                              <div style={{fontSize:'0.72rem',color:'var(--white-dim)',marginBottom:3}}>From (Sender)</div>
                              <select className="form-input" style={{width:'100%',fontSize:'0.82rem'}}
                                value={editValues.from_employee_id}
                                onChange={e=>setEditValues(v=>({...v,from_employee_id:e.target.value}))}>
                                {employees.map(e=>(
                                  <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <div style={{fontSize:'0.72rem',color:'var(--white-dim)',marginBottom:3}}>To (Recipient)</div>
                              <select className="form-input" style={{width:'100%',fontSize:'0.82rem'}}
                                value={editValues.to_employee_id}
                                onChange={e=>setEditValues(v=>({...v,to_employee_id:e.target.value}))}>
                                {employees.map(e=>(
                                  <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <div style={{fontSize:'0.72rem',color:'var(--white-dim)',marginBottom:3}}>Sparks</div>
                              <input className="form-input" type="number" min="1" style={{width:'100%',fontSize:'0.82rem'}}
                                value={editValues.amount}
                                onChange={e=>setEditValues(v=>({...v,amount:e.target.value}))} />
                            </div>
                          </div>

                          <div>
                            <div style={{fontSize:'0.72rem',color:'var(--white-dim)',marginBottom:3}}>Reason</div>
                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                              <input className="form-input" style={{flex:1,fontSize:'0.82rem'}}
                                value={editValues.reason}
                                onChange={e=>setEditValues(v=>({...v,reason:e.target.value}))}
                                placeholder="Reason for recognition…" />
                              {reasons.length>0&&(
                                <select className="form-input" style={{fontSize:'0.78rem',maxWidth:160}}
                                  value=""
                                  onChange={e=>{ if(e.target.value) setEditValues(v=>({...v,reason:e.target.value})) }}>
                                  <option value="">Pick reason…</option>
                                  {reasons.map(r=><option key={r} value={r}>{r}</option>)}
                                </select>
                              )}
                            </div>
                          </div>

                          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                            <button className="btn btn-gold btn-sm" onClick={()=>handleSave(txn)} disabled={saving}>
                              {saving?'Saving…':'Save Changes'}
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </button>
                            <div style={{marginLeft:'auto'}}>
                              {confirmDelete !== txn.id ? (
                                <button className="btn btn-sm" onClick={()=>setConfirmDelete(txn.id)}
                                  style={{background:'rgba(224,85,85,0.12)',border:'1px solid rgba(224,85,85,0.4)',color:'#ff8a8a',padding:'5px 14px',borderRadius:6,cursor:'pointer',fontSize:'0.8rem'}}>
                                  🗑 Delete Spark
                                </button>
                              ) : (
                                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                  <span style={{fontSize:'0.78rem',color:'var(--white-dim)'}}>This will reverse the balances. Sure?</span>
                                  <button className="btn btn-sm" onClick={()=>handleDelete(txn)} disabled={saving}
                                    style={{background:'rgba(224,85,85,0.2)',border:'1px solid rgba(224,85,85,0.5)',color:'#ff6b6b',padding:'5px 14px',borderRadius:6,cursor:'pointer',fontSize:'0.8rem',fontWeight:700}}>
                                    {saving?'Deleting…':'Yes, Delete'}
                                  </button>
                                  <button className="btn btn-sm btn-outline" onClick={()=>setConfirmDelete(null)} disabled={saving}
                                    style={{fontSize:'0.8rem',padding:'5px 10px'}}>
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}



// ── Title hierarchy for "Title / Rank" sort ───────────────────────────────────
// Groups are in display order (top of leaderboard = index 0).
// Any title not listed here goes to the end, alphabetically within that bucket.
const TITLE_HIERARCHY = [
  'Pre-Apprentice',
  'Apprentice',
  'Journeyman',
  'Foreman',
  'Project Manager',
  'Owner',
]

function getTitleOrder(title) {
  const idx = TITLE_HIERARCHY.findIndex(t => t.toLowerCase() === (title||'').toLowerCase())
  return idx >= 0 ? idx : TITLE_HIERARCHY.length // unknown titles go last
}

const SORT_OPTIONS = [
  { value:'title',   label:'Title / Rank' },
  { value:'ranking', label:'🏆 Ranking' },
  { value:'name',    label:'A–Z Name' },
]

export default function LeaderboardPage() {
  const { currentUser } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('dde_lb_sort') || 'title')

  // Persist sort choice whenever it changes
  const handleSortChange = (mode) => {
    setSortMode(mode)
    localStorage.setItem('dde_lb_sort', mode)
  }
  const [titleFilter, setTitleFilter] = useState('')
  const [txnLog, setTxnLog] = useState([])
  const [txnLoading, setTxnLoading] = useState(true)
  const [likes, setLikes] = useState({})
  const [myLikes, setMyLikes] = useState(new Set())
  const [matchModal, setMatchModal] = useState(null)
  const [matchAmount, setMatchAmount] = useState(1)
  const [matchMsg, setMatchMsg] = useState(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [givenToday, setGivenToday] = useState({})
  const [ctToday, setCtToday] = useState(null)
  const [myData, setMyData] = useState(null)
  const [vestingDays, setVestingDays] = useState(30)
  const [lbRange, setLbRange] = useState('all_time')
  const [logRange, setLogRange] = useState('all_time')
  const [lbFrom, setLbFrom] = useState(null)
  const [lbTo, setLbTo] = useState(null)
  const [logDays, setLogDays] = useState(null)
  // spark totals from transactions (for range filtering)
  const [empTotalsInRange, setEmpTotalsInRange] = useState({}) // empId -> total

  useEffect(() => {
    fetchAll()
    const empCh = supabase.channel('lb-emp').on('postgres_changes',{event:'*',schema:'public',table:'employees'},fetchEmployees).subscribe()
    const txnCh = supabase.channel('lb-txn').on('postgres_changes',{event:'INSERT',schema:'public',table:'spark_transactions'},()=>fetchTxnLog(logRange,logDays)).subscribe()
    const likeCh = supabase.channel('lb-likes').on('postgres_changes',{event:'*',schema:'public',table:'transaction_likes'},fetchLikes).subscribe()
    return () => { supabase.removeChannel(empCh); supabase.removeChannel(txnCh); supabase.removeChannel(likeCh) }
  }, [])

  useEffect(() => { fetchTxnLog(logRange, logDays) }, [logRange, logDays])
  useEffect(() => { fetchRangeTotals(lbRange, lbFrom, lbTo) }, [lbRange, lbFrom, lbTo])

  const fetchAll = async () => {
    await fetchMyContext()
    await fetchEmployees()
    await fetchLikes()
    // Load range settings from DB
    const { data: sData } = await supabase.from('settings').select('*')
    if (sData) {
      const o = {}; sData.forEach(s => { o[s.key] = s.value })
      const lbR = o.leaderboard_range || 'all_time'
      const logR = o.log_range || 'all_time'
      const logD = parseInt(o.log_range_days || 14)
      setLbRange(lbR); setLogRange(logR); setLogDays(logD)
      setLbFrom(o.leaderboard_range_from || null); setLbTo(o.leaderboard_range_to || null)
      await fetchTxnLog(logR, logD)
      await fetchRangeTotals(lbR, o.leaderboard_range_from, o.leaderboard_range_to)
    }
  }

  const fetchEmployees = async () => {
    const { data } = await supabase.from('employees')
      .select('id, first_name, last_name, vested_sparks, unvested_sparks, redeemed_sparks, job_title, job_grade, is_optional')
      .eq('is_admin', false)
    if (data) setEmployees(data.filter(e => !e.is_optional))
    setLoading(false)
  }

  const fetchRangeTotals = async (range, customFrom, customTo) => {
    if (range === 'all_time') { setEmpTotalsInRange({}); return }
    const { from, to } = getRangeWindow(range, customFrom, customTo)
    if (!from) { setEmpTotalsInRange({}); return }
    let q = supabase.from('spark_transactions').select('to_employee_id, amount').eq('transaction_type','assign')
    if (from) q = q.gte('created_at', from + 'T00:00:00')
    if (to)   q = q.lte('created_at', to   + 'T23:59:59')
    const { data } = await q
    if (data) {
      const totals = {}
      data.forEach(t => { totals[t.to_employee_id] = (totals[t.to_employee_id]||0) + t.amount })
      setEmpTotalsInRange(totals)
    }
  }

  const fetchTxnLog = async (range, days) => {
    setTxnLoading(true)
    let q = supabase.from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name,last_name), to_emp:to_employee_id(first_name,last_name)')
      .eq('transaction_type','assign').order('created_at',{ascending:false}).limit(100)
    // Apply log range
    if (range && range !== 'all_time') {
      const now = new Date()
      const cutoffDays = days || { rolling_week:7, rolling_month:30, rolling_quarter:90, rolling_half:182, rolling_year:365 }[range] || 14
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - cutoffDays)
      q = q.gte('created_at', cutoff.toISOString())
    }
    const { data } = await q
    if (data) setTxnLog(data)
    setTxnLoading(false)
  }

  const fetchLikes = async () => {
    const { data } = await supabase.from('transaction_likes').select('transaction_id, from_employee_id')
    if (!data) return
    const counts = {}; const mine = new Set()
    data.forEach(l => { counts[l.transaction_id] = (counts[l.transaction_id]||0)+1; if(l.from_employee_id===currentUser?.id) mine.add(l.transaction_id) })
    setLikes(counts); setMyLikes(mine)
  }

  const fetchMyContext = async () => {
    if (!currentUser?.id) return
    const { data: sData } = await supabase.from('settings').select('*')
    if (sData) { const o={}; sData.forEach(s=>{o[s.key]=s.value}); setVestingDays(parseInt(o.vesting_period_days||30)) }
    const { data: todayData } = await supabase.rpc('get_ct_today')
    const today = todayData || new Date().toISOString().split('T')[0]
    setCtToday(today)
    if (!currentUser.is_admin) {
      const { data: me } = await supabase.from('employees').select('*').eq('id', currentUser.id).single()
      setMyData(me)
      const { data: givenRows } = await supabase.from('daily_given').select('to_employee_id, amount').eq('from_employee_id', currentUser.id).eq('given_date', today)
      if (givenRows) { const m={}; givenRows.forEach(r=>{m[r.to_employee_id]=r.amount}); setGivenToday(m) }
    }
  }

  const handleLike = async (txn) => {
    if (!currentUser || currentUser.is_admin) return
    // Can't like your own spark OR one assigned to you
    if (txn.from_employee_id === currentUser.id || txn.to_employee_id === currentUser.id) return
    const already = myLikes.has(txn.id)
    if (already) {
      await supabase.from('transaction_likes').delete().eq('transaction_id',txn.id).eq('from_employee_id',currentUser.id)
      setMyLikes(prev=>{const s=new Set(prev);s.delete(txn.id);return s})
      setLikes(prev=>({...prev,[txn.id]:Math.max(0,(prev[txn.id]||1)-1)}))
    } else {
      await supabase.from('transaction_likes').insert({transaction_id:txn.id, from_employee_id:currentUser.id})
      setMyLikes(prev=>new Set([...prev,txn.id]))
      setLikes(prev=>({...prev,[txn.id]:(prev[txn.id]||0)+1}))
      // Prompt match only if not admin and not the recipient
      setMatchModal({txn}); setMatchAmount(Math.min(txn.amount,1)); setMatchMsg(null)
    }
  }

  const handleMatch = async () => {
    const {txn} = matchModal
    const toId = txn.to_employee_id
    const alreadyGiven = givenToday[toId]||0
    const perPersonRem = 2 - alreadyGiven
    const totalRem = myData?.daily_sparks_remaining||0
    const maxMatch = Math.max(0, Math.min(perPersonRem, totalRem))
    if (maxMatch <= 0) { setMatchMsg(`Can't give sparks right now (limit reached or none remaining)`); return }
    const n = Math.max(1, Math.min(parseInt(matchAmount)||1, maxMatch))
    setMatchLoading(true)
    const result = await assignSparks({
      fromId: currentUser.id, toId, amount: n,
      reason: txn.reason ? `Matched: ${txn.reason}` : 'Matched spark',
      vestingDays, ctToday, alreadyGivenToRecipient: alreadyGiven, currentSenderRemaining: totalRem,
    })
    setMatchLoading(false)
    if (result.error) { setMatchMsg(`Error: ${result.error}`); return }
    setMatchModal(null); fetchMyContext()
  }

  // Compute display total per employee (range-aware)
  const getDisplayTotal = (emp) => {
    if (lbRange === 'all_time' || !empTotalsInRange) {
      return (emp.vested_sparks||0) + (emp.unvested_sparks||0) + (emp.redeemed_sparks||0)
    }
    return empTotalsInRange[emp.id] || 0
  }

  // ── Tie-breaking helper: reverse alphabetical by last name then first name ──
  // Used by both 'ranking' and 'title' sorts
  const tieBreak = (a, b) => b.last_name.localeCompare(a.last_name) || b.first_name.localeCompare(a.first_name)

  // ── Global rank (by total, ties broken reverse-alpha) ─────────────────────
  const rankByTotal = [...employees].sort((a,b) => {
    const diff = getDisplayTotal(b) - getDisplayTotal(a)
    return diff !== 0 ? diff : tieBreak(a, b)
  })
  const getRank = (emp) => rankByTotal.findIndex(e => e.id === emp.id) + 1

  let sorted = [...employees]
  if (titleFilter) sorted = sorted.filter(e => e.job_title === titleFilter)

  sorted.sort((a, b) => {
    if (sortMode === 'ranking') {
      const diff = getDisplayTotal(b) - getDisplayTotal(a)
      return diff !== 0 ? diff : tieBreak(a, b)
    }
    if (sortMode === 'title') {
      // 1. Title group order (Pre-Apprentice first … Owner last)
      const titleDiff = getTitleOrder(a.job_title) - getTitleOrder(b.job_title)
      if (titleDiff !== 0) return titleDiff
      // 2. Within group: highest sparks first
      const sparkDiff = getDisplayTotal(b) - getDisplayTotal(a)
      if (sparkDiff !== 0) return sparkDiff
      // 3. Tie: reverse alphabetical
      return tieBreak(a, b)
    }
    // 'name' sort: A–Z last then first
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
  })

  const allTotals = sorted.map(getDisplayTotal)
  const maxSparks = Math.max(...allTotals, 1)
  // Titles for filter buttons, ordered by hierarchy then alpha for unknowns
  const usedTitles = [...new Set(employees.map(e => e.job_title).filter(Boolean))]
    .sort((a, b) => getTitleOrder(a) - getTitleOrder(b) || a.localeCompare(b))
  const isAdmin = currentUser?.is_admin

  return (
    <div className="fade-in">
      <h1 className="page-title">✨ Sparks Leaderboard</h1>
      <p className="page-subtitle">Recognizing excellence across the DDE team</p>

      <div style={{display:'flex',gap:'12px',alignItems:'center',marginBottom:'20px',flexWrap:'wrap'}}>
        <div className="sort-control" style={{marginBottom:0}}>
          <span className="sort-label">Sort:</span>
          {SORT_OPTIONS.map(o => <button key={o.value} className={`sort-btn${sortMode===o.value?' active':''}`} onClick={()=>handleSortChange(o.value)}>{o.label}</button>)}
        </div>
        {usedTitles.length > 0 && (
          <div className="sort-control" style={{marginBottom:0}}>
            <span className="sort-label">Title:</span>
            <button className={`sort-btn${titleFilter===''?' active':''}`} onClick={()=>setTitleFilter('')}>All</button>
            {usedTitles.map(t => <button key={t} className={`sort-btn${titleFilter===t?' active':''}`} onClick={()=>setTitleFilter(t)}>{t}</button>)}
          </div>
        )}
      </div>

      <div className="card" style={{marginBottom:'28px',padding:'16px 20px'}}>
        {loading
          ? <div style={{textAlign:'center',padding:'30px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
          : sorted.length === 0
            ? <div className="empty-state"><div className="icon">✨</div><p>No employees{titleFilter?' with that title':''}</p></div>
            : sorted.map(emp => {
                const total = getDisplayTotal(emp)
                const rank = getRank(emp)
                const pct = Math.round((total / maxSparks) * 100)
                return (
                  <div key={emp.id} style={{display:'flex',alignItems:'center',gap:'12px',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                    <span className={`rank-badge rank-${rank<=3?rank:'other'}`} style={{flexShrink:0}}>
                      {rank<=3?['🥇','🥈','🥉'][rank-1]:rank}
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                        <span style={{fontWeight:700,fontSize:'0.95rem'}}>{emp.first_name} {emp.last_name}</span>
                        {emp.job_title && <span style={{fontSize:'0.68rem',color:'var(--gold-dark)',background:'rgba(240,192,64,0.1)',border:'1px solid rgba(240,192,64,0.2)',borderRadius:'10px',padding:'1px 6px'}}>{emp.job_title}</span>}
                        {isAdmin && emp.job_grade && <span style={{fontSize:'0.65rem',color:'var(--white-dim)'}}>{emp.job_grade}</span>}
                      </div>
                      <div style={{background:'rgba(0,0,0,0.4)',borderRadius:'10px',height:'4px',overflow:'hidden',marginTop:'4px'}}>
                        <div style={{height:'100%',background:'linear-gradient(90deg,var(--gold-dark),var(--gold))',borderRadius:'10px',width:`${pct}%`,transition:'width 0.5s ease'}}></div>
                      </div>
                    </div>
                    <div style={{fontFamily:'var(--font-display)',color:'var(--gold)',fontWeight:700,fontSize:'1.05rem',flexShrink:0}}>
                      ✨ {total}
                    </div>
                  </div>
                )
              })
        }
      </div>

      {/* Transaction Log */}
      <div className="card">
        <div className="card-title"><span className="icon">📋</span> Sparks Activity Log</div>
        <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:'16px'}}>
          {isAdmin ? 'Click Edit on any row to modify or delete a spark. Changes update balances immediately.' : 'Click ❤️ to like (and optionally match) a spark. You cannot like sparks you sent or received.'}
        </p>
        <SparkLogTable
          txnLog={txnLog}
          txnLoading={txnLoading}
          likes={likes}
          myLikes={myLikes}
          isAdmin={isAdmin}
          currentUser={currentUser}
          onLike={handleLike}
          onRefresh={() => fetchTxnLog(logRange, logDays)}
        />
      </div>

      {/* Match Modal */}
      {matchModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setMatchModal(null)}>
          <div className="modal">
            <div className="modal-title">❤️ You liked that spark! Want to match it?</div>
            <div style={{background:'rgba(0,0,0,0.2)',borderRadius:'8px',padding:'12px',marginBottom:'16px',fontSize:'0.85rem'}}>
              <div><strong style={{color:'var(--gold)'}}>Spark:</strong> {matchModal.txn.from_emp?.first_name} → {matchModal.txn.to_emp?.first_name} {matchModal.txn.to_emp?.last_name}</div>
              <div style={{marginTop:'4px'}}><strong style={{color:'var(--gold)'}}>Amount:</strong> ✨ {matchModal.txn.amount}</div>
              {matchModal.txn.reason && <div style={{marginTop:'4px',color:'var(--white-dim)'}}><strong style={{color:'var(--gold)'}}>Reason:</strong> {matchModal.txn.reason}</div>}
            </div>
            {matchMsg && <div className="alert alert-error" style={{marginBottom:'12px'}}>{matchMsg}</div>}
            <div className="form-group">
              <label className="form-label">Sparks to give (max {Math.min(2-(givenToday[matchModal.txn.to_employee_id]||0), myData?.daily_sparks_remaining||0)})</label>
              <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                {[...Array(Math.max(0,Math.min(2-(givenToday[matchModal.txn.to_employee_id]||0),myData?.daily_sparks_remaining||0,matchModal.txn.amount)))].map((_,i) => (
                  <button key={i+1} onClick={()=>setMatchAmount(i+1)} className={`btn btn-sm ${matchAmount===i+1?'btn-gold':'btn-outline'}`}>{i+1}</button>
                ))}
              </div>
            </div>
            <p style={{fontSize:'0.8rem',color:'var(--white-dim)',marginBottom:'16px'}}>You have {myData?.daily_sparks_remaining||0} sparks left. Vests in {vestingDays} days.</p>
            <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
              <button className="btn btn-gold" onClick={handleMatch} disabled={matchLoading}>{matchLoading?'Sending...':`✨ Match ${matchAmount} Spark${matchAmount!==1?'s':''}`}</button>
              <button className="btn btn-outline" onClick={()=>setMatchModal(null)}>Just Like, No Match</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
