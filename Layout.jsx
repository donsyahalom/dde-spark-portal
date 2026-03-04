import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { addDays, format } from 'date-fns'

export default function EmployeePage() {
  const { currentUser, refreshUser } = useAuth()
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({ vesting_period_days: 30 })
  const [selectedEmp, setSelectedEmp] = useState('')
  const [amount, setAmount] = useState(1)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [me, setMe] = useState(currentUser)

  useEffect(() => {
    fetchData()
    // Realtime subscription for own data
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
    // Get settings
    const { data: settingsData } = await supabase.from('settings').select('*')
    if (settingsData) {
      const obj = {}
      settingsData.forEach(s => { obj[s.key] = s.value })
      setSettings({ vesting_period_days: parseInt(obj.vesting_period_days || 30) })
    }

    // Get other employees
    const { data: emps } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .eq('is_admin', false)
      .neq('id', currentUser.id)
      .order('last_name')
    if (emps) setEmployees(emps)

    // Get my history (sparks I gave)
    const { data: txns } = await supabase
      .from('spark_transactions')
      .select(`*, to_employee:to_employee_id(first_name, last_name)`)
      .eq('from_employee_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (txns) setHistory(txns)

    // Refresh own data
    const updated = await refreshUser()
    if (updated) setMe(updated)
  }

  const handleAssign = async () => {
    if (!selectedEmp) { setMessage({ type: 'error', text: 'Please select an employee' }); return }
    const numAmount = parseInt(amount)
    if (numAmount < 1) { setMessage({ type: 'error', text: 'Amount must be at least 1' }); return }

    const freshMe = me
    if ((freshMe.daily_sparks_remaining || 0) < numAmount) {
      setMessage({ type: 'error', text: `You only have ${freshMe.daily_sparks_remaining || 0} sparks remaining today` })
      return
    }

    setLoading(true)
    setMessage(null)

    const vestingDate = format(addDays(new Date(), settings.vesting_period_days), 'yyyy-MM-dd')

    // Insert transaction
    const { data: txn, error: txnError } = await supabase
      .from('spark_transactions')
      .insert({
        from_employee_id: currentUser.id,
        to_employee_id: selectedEmp,
        amount: numAmount,
        transaction_type: 'assign',
        vesting_date: vestingDate,
        vested: false
      })
      .select()
      .single()

    if (txnError) { setLoading(false); setMessage({ type: 'error', text: 'Failed to assign sparks' }); return }

    // Add to pending vesting
    await supabase.from('pending_vesting').insert({
      employee_id: selectedEmp,
      amount: numAmount,
      vests_on: vestingDate,
      transaction_id: txn.id
    })

    // Update recipient unvested sparks
    const { data: recipient } = await supabase.from('employees').select('unvested_sparks').eq('id', selectedEmp).single()
    await supabase.from('employees')
      .update({ unvested_sparks: (recipient?.unvested_sparks || 0) + numAmount, updated_at: new Date().toISOString() })
      .eq('id', selectedEmp)

    // Deduct from my daily allowance
    await supabase.from('employees')
      .update({ daily_sparks_remaining: Math.max(0, (freshMe.daily_sparks_remaining||0) - numAmount), updated_at: new Date().toISOString() })
      .eq('id', currentUser.id)

    const empName = employees.find(e => e.id === selectedEmp)
    setMessage({ type: 'success', text: `✨ ${numAmount} spark${numAmount>1?'s':''} assigned to ${empName?.first_name}! Vests on ${vestingDate}.` })
    setLoading(false)
    setSelectedEmp('')
    setAmount(1)
    fetchData()
  }

  const totalSparks = (me?.vested_sparks || 0) + (me?.unvested_sparks || 0)

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
          <div className="stat-value" style={{color:me?.daily_sparks_remaining > 0 ? 'var(--green-bright)' : 'var(--red)'}}>
            {me?.daily_sparks_remaining || 0}
          </div>
          <div className="stat-label">Daily Sparks Left</div>
        </div>
      </div>

      <div className="card" style={{marginBottom:'20px'}}>
        <div className="card-title"><span className="icon">✨</span> Give a Spark</div>
        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
        {(me?.daily_sparks_remaining || 0) === 0 ? (
          <div className="alert alert-warning">You've used all your daily sparks! They reset tomorrow.</div>
        ) : (
          <>
            <p style={{color:'var(--white-dim)', fontSize:'0.85rem', marginBottom:'20px'}}>
              You can give up to <strong style={{color:'var(--gold)'}}>2 sparks per day</strong> total.
              Sparks vest after <strong style={{color:'var(--gold)'}}>{settings.vesting_period_days} days</strong> from assignment.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Give Sparks To</label>
                <select className="form-select" value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}>
                  <option value="">Select employee...</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Amount (max {me?.daily_sparks_remaining || 0})</label>
                <select className="form-select" value={amount} onChange={e => setAmount(e.target.value)}>
                  {[...Array(Math.min(me?.daily_sparks_remaining || 0, 2))].map((_, i) => (
                    <option key={i+1} value={i+1}>{i+1}</option>
                  ))}
                </select>
              </div>
            </div>
            <button className="btn btn-gold" onClick={handleAssign} disabled={loading || !selectedEmp}>
              {loading ? 'Sending...' : '✨ Give Spark'}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title"><span className="icon">📋</span> Sparks I've Given</div>
        {history.length === 0 ? (
          <div className="empty-state"><div className="icon">📋</div><p>No sparks given yet</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Amount</th>
                  <th>Vests On</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map(txn => (
                  <tr key={txn.id}>
                    <td>{txn.to_employee?.first_name} {txn.to_employee?.last_name}</td>
                    <td><span className="spark-badge">✨ {txn.amount}</span></td>
                    <td style={{fontSize:'0.8rem'}}>{txn.vesting_date || '—'}</td>
                    <td><span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>{txn.vested ? 'Vested' : 'Pending'}</span></td>
                    <td style={{fontSize:'0.8rem', color:'var(--white-dim)'}}>
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
