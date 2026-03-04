import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { addDays, format } from 'date-fns'

const PER_PERSON_DAILY_CAP = 2

const REASON_CATEGORIES = [
  'Going Above & Beyond',
  'Teamwork & Collaboration',
  'Customer Service Excellence',
  'Safety Leadership',
  'Problem Solving',
  'Mentoring & Training',
  'Reliability & Dependability',
  'Innovation & Initiative',
  'Positive Attitude',
  'Other',
]

export default function EmployeePage() {
  const { currentUser, refreshUser } = useAuth()
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({ vesting_period_days: 30 })
  const [selectedEmp, setSelectedEmp] = useState('')
  const [amount, setAmount] = useState(1)
  const [reasonCategory, setReasonCategory] = useState('')
  const [reasonText, setReasonText] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [historyGiven, setHistoryGiven] = useState([])
  const [historyReceived, setHistoryReceived] = useState([])
  const [me, setMe] = useState(currentUser)
  const [givenToday, setGivenToday] = useState({})
  const [ctToday, setCtToday] = useState(null)

  useEffect(() => {
    fetchData()
    const channel = supabase
      .channel('employee-self')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${currentUser.id}` }, async () => {
        const updated = await refreshUser()
        if (updated) setMe(updated)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const fetchData = async () => {
    await supabase.rpc('reset_daily_sparks')
    await supabase.rpc('process_vesting')

    const { data: todayData } = await supabase.rpc('get_ct_today')
    const today = todayData || new Date().toISOString().split('T')[0]
    setCtToday(today)

    const { data: settingsData } = await supabase.from('settings').select('*')
    if (settingsData) {
      const obj = {}
      settingsData.forEach(s => { obj[s.key] = s.value })
      setSettings({ vesting_period_days: parseInt(obj.vesting_period_days || 30) })
    }

    const { data: emps } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .eq('is_admin', false)
      .neq('id', currentUser.id)
      .order('last_name')
    if (emps) setEmployees(emps)

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

    // Sparks I gave
    const { data: given } = await supabase
      .from('spark_transactions')
      .select('*, to_employee:to_employee_id(first_name, last_name)')
      .eq('from_employee_id', currentUser.id)
      .in('transaction_type', ['assign'])
      .order('created_at', { ascending: false })
      .limit(30)
    if (given) setHistoryGiven(given)

    // Sparks I received
    const { data: received } = await supabase
      .from('spark_transactions')
      .select('*, from_employee:from_employee_id(first_name, last_name)')
      .eq('to_employee_id', currentUser.id)
      .in('transaction_type', ['assign'])
      .order('created_at', { ascending: false })
      .limit(30)
    if (received) setHistoryReceived(received)

    const updated = await refreshUser()
    if (updated) setMe(updated)
  }

  const alreadyGivenToSelected = selectedEmp ? (givenToday[selectedEmp] || 0) : 0
  const perPersonRemaining = PER_PERSON_DAILY_CAP - alreadyGivenToSelected
  const dailyRemaining = me?.daily_sparks_remaining || 0
  const maxCanGive = Math.max(0, Math.min(perPersonRemaining, dailyRemaining))

  const handleSelectEmp = (id) => {
    setSelectedEmp(id)
    setAmount(1)
    setMessage(null)
  }

  const handleAssign = async () => {
    if (!selectedEmp) { setMessage({ type: 'error', text: 'Please select an employee' }); return }
    const numAmount = parseInt(amount)
    if (numAmount < 1 || numAmount > maxCanGive) {
      setMessage({ type: 'error', text: `You can give at most ${maxCanGive} spark${maxCanGive !== 1 ? 's' : ''} to this person today` })
      return
    }

    setLoading(true)
    setMessage(null)

    const vestingDate = format(addDays(new Date(), settings.vesting_period_days), 'yyyy-MM-dd')
    const reasonFull = reasonCategory
      ? (reasonText.trim() ? `${reasonCategory}: ${reasonText.trim()}` : reasonCategory)
      : (reasonText.trim() || null)

    const { data: txn, error: txnError } = await supabase
      .from('spark_transactions')
      .insert({
        from_employee_id: currentUser.id,
        to_employee_id: selectedEmp,
        amount: numAmount,
        transaction_type: 'assign',
        vesting_date: vestingDate,
        vested: false,
        reason: reasonFull
      })
      .select()
      .single()

    if (txnError) { setLoading(false); setMessage({ type: 'error', text: 'Failed to assign sparks' }); return }

    await supabase.from('pending_vesting').insert({
      employee_id: selectedEmp,
      amount: numAmount,
      vests_on: vestingDate,
      transaction_id: txn.id
    })

    const { data: recipient } = await supabase.from('employees').select('unvested_sparks').eq('id', selectedEmp).single()
    await supabase.from('employees')
      .update({ unvested_sparks: (recipient?.unvested_sparks || 0) + numAmount, updated_at: new Date().toISOString() })
      .eq('id', selectedEmp)

    await supabase.from('employees')
      .update({ daily_sparks_remaining: Math.max(0, dailyRemaining - numAmount), updated_at: new Date().toISOString() })
      .eq('id', currentUser.id)

    await supabase.from('daily_given').upsert({
      from_employee_id: currentUser.id,
      to_employee_id: selectedEmp,
      given_date: ctToday,
      amount: alreadyGivenToSelected + numAmount
    }, { onConflict: 'from_employee_id,to_employee_id,given_date' })

    const empName = employees.find(e => e.id === selectedEmp)
    setMessage({
      type: 'success',
      text: `✨ ${numAmount} spark${numAmount > 1 ? 's' : ''} given to ${empName?.first_name}! Vests on ${vestingDate}.`
    })
    setLoading(false)
    setSelectedEmp('')
    setAmount(1)
    setReasonCategory('')
    setReasonText('')
    fetchData()
  }

  const totalSparks = (me?.vested_sparks || 0) + (me?.unvested_sparks || 0)
  const dailyAllowance = me?.daily_accrual || 0

  return (
    <div className="fade-in">
      <h1 className="page-title">My Sparks</h1>
      <p className="page-subtitle">Recognize your colleagues with sparks</p>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--gold-light)'}}>{totalSparks}</div>
          <div className="stat-label">Total Sparks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{me?.vested_sparks || 0}</div>
          <div className="stat-label">Vested Sparks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--white-dim)'}}>{me?.unvested_sparks || 0}</div>
          <div className="stat-label">Pending Vesting</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{color: dailyRemaining > 0 ? 'var(--green-bright)' : 'var(--red)'}}>
            {dailyRemaining}
            <span style={{fontSize:'1rem', color:'var(--white-dim)'}}> / {dailyAllowance}</span>
          </div>
          <div className="stat-label">Daily Sparks Left</div>
        </div>
      </div>

      {/* GIVE A SPARK */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div className="card-title"><span className="icon">✨</span> Give a Spark</div>
        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        {dailyRemaining === 0 ? (
          <div className="alert alert-warning">
            🌙 You've used all your daily sparks! They reset at midnight <strong>Connecticut time</strong>.
          </div>
        ) : (
          <>
            <div className="alert alert-warning" style={{marginBottom:'16px'}}>
              <strong>Daily rules:</strong> You have <strong>{dailyAllowance} sparks to give per day</strong> total,
              with a max of <strong>2 sparks to any one person per day</strong>.
              Sparks vest <strong>{settings.vesting_period_days} days</strong> after assignment.
              Resets at midnight <strong>Connecticut time</strong>.
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Give Sparks To</label>
                <select className="form-select" value={selectedEmp} onChange={e => handleSelectEmp(e.target.value)}>
                  <option value="">Select employee...</option>
                  {employees.map(e => {
                    const alreadyGiven = givenToday[e.id] || 0
                    const canStillGive = PER_PERSON_DAILY_CAP - alreadyGiven
                    const suffix = canStillGive <= 0
                      ? ' — limit reached today'
                      : alreadyGiven > 0 ? ` (${alreadyGiven} given today)` : ''
                    return (
                      <option key={e.id} value={e.id} disabled={canStillGive <= 0 || dailyRemaining <= 0}>
                        {e.first_name} {e.last_name}{suffix}
                      </option>
                    )
                  })}
                </select>
                {selectedEmp && alreadyGivenToSelected > 0 && perPersonRemaining > 0 && (
                  <p style={{fontSize:'0.78rem', color:'var(--gold)', marginTop:'6px'}}>
                    Already gave {alreadyGivenToSelected} spark{alreadyGivenToSelected > 1 ? 's' : ''} today — {perPersonRemaining} more allowed.
                  </p>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Amount{selectedEmp && maxCanGive > 0 && <span style={{color:'var(--white-dim)', fontWeight:400, textTransform:'none', letterSpacing:0}}> (max {maxCanGive})</span>}
                </label>
                <select className="form-select" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={!selectedEmp || maxCanGive <= 0}>
                  {maxCanGive > 0
                    ? [...Array(maxCanGive)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)
                    : <option value={0}>0 — limit reached</option>
                  }
                </select>
              </div>
            </div>

            {/* Reason section */}
            <div style={{borderTop:'1px solid var(--border)', paddingTop:'16px', marginTop:'4px'}}>
              <div style={{fontSize:'0.75rem', letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--white-dim)', marginBottom:'12px'}}>
                Recognition Reason <span style={{color:'var(--border-bright)', fontWeight:400}}>(optional)</span>
              </div>
              <div className="form-grid">
                <div className="form-group" style={{marginBottom:'12px'}}>
                  <label className="form-label">Category</label>
                  <select className="form-select" value={reasonCategory} onChange={e => setReasonCategory(e.target.value)}>
                    <option value="">Select a category...</option>
                    {REASON_CATEGORIES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:'12px'}}>
                  <label className="form-label">Additional Details</label>
                  <input className="form-input" value={reasonText}
                    onChange={e => setReasonText(e.target.value)}
                    placeholder="Describe what they did..." maxLength={200} />
                </div>
              </div>
            </div>

            <button className="btn btn-gold" onClick={handleAssign}
              disabled={loading || !selectedEmp || maxCanGive <= 0}>
              {loading ? 'Sending...' : '✨ Give Spark'}
            </button>
          </>
        )}
      </div>

      {/* SPARKS I GAVE */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div className="card-title"><span className="icon">📤</span> Sparks I've Given</div>
        {historyGiven.length === 0 ? (
          <div className="empty-state"><div className="icon">📤</div><p>No sparks given yet</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>To</th>
                  <th>✨</th>
                  <th>Reason</th>
                  <th>Vests On</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {historyGiven.map(txn => (
                  <tr key={txn.id}>
                    <td style={{fontWeight:600}}>{txn.to_employee?.first_name} {txn.to_employee?.last_name}</td>
                    <td><span className="spark-badge">✨ {txn.amount}</span></td>
                    <td style={{fontSize:'0.82rem', color:'var(--white-dim)', maxWidth:'200px'}}>
                      {txn.reason || <span style={{opacity:0.4}}>—</span>}
                    </td>
                    <td style={{fontSize:'0.8rem'}}>{txn.vesting_date || '—'}</td>
                    <td><span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>{txn.vested ? 'Vested' : 'Pending'}</span></td>
                    <td style={{fontSize:'0.8rem', color:'var(--white-dim)', whiteSpace:'nowrap'}}>
                      {new Date(txn.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SPARKS I RECEIVED */}
      <div className="card">
        <div className="card-title"><span className="icon">📥</span> Sparks I've Received</div>
        {historyReceived.length === 0 ? (
          <div className="empty-state"><div className="icon">📥</div><p>No sparks received yet</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>✨</th>
                  <th>Reason</th>
                  <th>Vests On</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {historyReceived.map(txn => (
                  <tr key={txn.id}>
                    <td style={{fontWeight:600}}>
                      {txn.from_employee
                        ? `${txn.from_employee.first_name} ${txn.from_employee.last_name}`
                        : <span style={{color:'var(--white-dim)'}}>Admin</span>}
                    </td>
                    <td><span className="spark-badge">✨ {txn.amount}</span></td>
                    <td style={{fontSize:'0.82rem', color:'var(--white-dim)', maxWidth:'200px'}}>
                      {txn.reason
                        ? <span style={{color:'var(--white-soft)'}}>{txn.reason}</span>
                        : <span style={{opacity:0.4}}>—</span>}
                    </td>
                    <td style={{fontSize:'0.8rem'}}>{txn.vesting_date || '—'}</td>
                    <td><span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>{txn.vested ? 'Vested' : 'Pending'}</span></td>
                    <td style={{fontSize:'0.8rem', color:'var(--white-dim)', whiteSpace:'nowrap'}}>
                      {new Date(txn.created_at).toLocaleDateString()}
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
