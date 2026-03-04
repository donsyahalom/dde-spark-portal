import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TYPE_LABELS = {
  assign: { label: 'Peer Spark', color: 'gold' },
  admin_adjust: { label: 'Admin Adj.', color: 'red' },
  cashout: { label: 'Cash Out', color: 'green' },
  initial: { label: 'Initial', color: 'gold' },
  daily_accrual: { label: 'Accrual', color: 'gold' },
}

export default function AdminPage() {
  const { currentUser } = useAuth()
  const [tab, setTab] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({ vesting_period_days: '30' })
  const [sortMode, setSortMode] = useState('name')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  const emptyForm = { first_name: '', last_name: '', email: '', phone: '', initial_sparks: 0, daily_accrual: 0 }
  const [form, setForm] = useState(emptyForm)
  const [batchText, setBatchText] = useState('')

  const [editEmp, setEditEmp] = useState(null)
  const [editValues, setEditValues] = useState({})

  // Cashout modal
  const [cashoutEmp, setCashoutEmp] = useState(null)
  const [cashoutSparks, setCashoutSparks] = useState('')
  const [cashoutValue, setCashoutValue] = useState('')
  const [cashoutNote, setCashoutNote] = useState('')

  // Report state
  const [reportFrom, setReportFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0])
  const [reportTypeFilter, setReportTypeFilter] = useState('all')
  const [reportData, setReportData] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const [{ data: emps }, { data: settingsData }] = await Promise.all([
      supabase.from('employees').select('*').eq('is_admin', false).order('last_name'),
      supabase.from('settings').select('*')
    ])
    if (emps) setEmployees(emps)
    if (settingsData) {
      const obj = {}
      settingsData.forEach(s => { obj[s.key] = s.value })
      setSettings(obj)
    }
  }

  const sortedEmployees = [...employees].sort((a, b) => {
    if (sortMode === 'ranking') {
      return ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))
    }
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
  })

  const showMsg = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const saveSettings = async () => {
    setLoading(true)
    for (const [key, value] of Object.entries(settings)) {
      await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' })
    }
    setLoading(false)
    showMsg('success', 'Settings saved!')
  }

  const addEmployee = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.from('employees').insert({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.toLowerCase().trim(),
      phone: form.phone.trim(),
      password_hash: 'spark123',
      must_change_password: true,
      vested_sparks: 0,
      unvested_sparks: parseInt(form.initial_sparks) || 0,
      daily_accrual: parseInt(form.daily_accrual) || 0,
      daily_sparks_remaining: parseInt(form.daily_accrual) || 0
    })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    showMsg('success', `${form.first_name} ${form.last_name} added!`)
    setForm(emptyForm)
    fetchAll()
  }

  const addBatch = async () => {
    const lines = batchText.trim().split('\n').filter(l => l.trim())
    if (!lines.length) return
    setLoading(true)
    let added = 0, errors = 0
    for (const line of lines) {
      const [first_name, last_name, phone, email, initial_sparks, daily_accrual] = line.split(',').map(s => s?.trim())
      if (!first_name || !last_name || !email) { errors++; continue }
      const accrual = parseInt(daily_accrual) || 0
      const { error } = await supabase.from('employees').insert({
        first_name, last_name, phone: phone || '', email: email.toLowerCase(),
        password_hash: 'spark123', must_change_password: true,
        vested_sparks: 0, unvested_sparks: parseInt(initial_sparks)||0,
        daily_accrual: accrual, daily_sparks_remaining: accrual
      })
      if (error) errors++; else added++
    }
    setLoading(false)
    showMsg(errors ? 'warning' : 'success', `Added ${added} employee(s). ${errors ? `${errors} failed (check emails).` : ''}`)
    setBatchText('')
    fetchAll()
  }

  const removeEmployee = async (emp) => {
    if (!window.confirm(`Remove ${emp.first_name} ${emp.last_name}? This cannot be undone.`)) return
    await supabase.from('employees').delete().eq('id', emp.id)
    showMsg('success', `${emp.first_name} ${emp.last_name} removed`)
    fetchAll()
  }

  const openEdit = (emp) => {
    setEditEmp(emp)
    setEditValues({
      first_name: emp.first_name, last_name: emp.last_name,
      email: emp.email, phone: emp.phone || '',
      vested_sparks: emp.vested_sparks || 0,
      unvested_sparks: emp.unvested_sparks || 0,
      daily_accrual: emp.daily_accrual || 0
    })
  }

  const saveEdit = async () => {
    setLoading(true)
    const oldVested = editEmp.vested_sparks || 0
    const oldUnvested = editEmp.unvested_sparks || 0
    const newVested = parseInt(editValues.vested_sparks) || 0
    const newUnvested = parseInt(editValues.unvested_sparks) || 0

    await supabase.from('employees').update({
      first_name: editValues.first_name, last_name: editValues.last_name,
      email: editValues.email.toLowerCase(), phone: editValues.phone,
      vested_sparks: newVested, unvested_sparks: newUnvested,
      daily_accrual: parseInt(editValues.daily_accrual)||0,
      updated_at: new Date().toISOString()
    }).eq('id', editEmp.id)

    const vestedDiff = newVested - oldVested
    const unvestDiff = newUnvested - oldUnvested
    if (vestedDiff !== 0 || unvestDiff !== 0) {
      await supabase.from('spark_transactions').insert({
        from_employee_id: currentUser.id,
        to_employee_id: editEmp.id,
        amount: vestedDiff + unvestDiff,
        transaction_type: 'admin_adjust',
        note: `Admin adjustment: vested ${vestedDiff>=0?'+':''}${vestedDiff}, unvested ${unvestDiff>=0?'+':''}${unvestDiff}`,
        vested: newVested > 0
      })
    }

    setLoading(false)
    setEditEmp(null)
    showMsg('success', 'Employee updated!')
    fetchAll()
  }

  // ── CASHOUT ──────────────────────────────────────────────
  const openCashout = (emp) => {
    setCashoutEmp(emp)
    setCashoutSparks('')
    setCashoutValue('')
    setCashoutNote('')
  }

  const processCashout = async () => {
    const sparksNum = parseInt(cashoutSparks)
    if (!sparksNum || sparksNum < 1) { showMsg('error', 'Enter a valid spark amount'); return }
    const totalAvailable = (cashoutEmp.vested_sparks||0) + (cashoutEmp.unvested_sparks||0)
    if (sparksNum > totalAvailable) {
      showMsg('error', `${cashoutEmp.first_name} only has ${totalAvailable} sparks available`)
      return
    }

    setLoading(true)

    // Deduct sparks (take from vested first, then unvested)
    let fromVested = Math.min(sparksNum, cashoutEmp.vested_sparks || 0)
    let fromUnvested = sparksNum - fromVested

    await supabase.from('employees').update({
      vested_sparks: (cashoutEmp.vested_sparks || 0) - fromVested,
      unvested_sparks: Math.max(0, (cashoutEmp.unvested_sparks || 0) - fromUnvested),
      updated_at: new Date().toISOString()
    }).eq('id', cashoutEmp.id)

    // Log in spark_transactions
    await supabase.from('spark_transactions').insert({
      from_employee_id: cashoutEmp.id,
      to_employee_id: cashoutEmp.id,
      amount: -sparksNum,
      transaction_type: 'cashout',
      note: cashoutNote || null,
      reason: cashoutValue || null,
      vested: true
    })

    // Log in spark_cashouts
    await supabase.from('spark_cashouts').insert({
      employee_id: cashoutEmp.id,
      admin_id: currentUser.id,
      sparks_redeemed: sparksNum,
      redemption_value: cashoutValue || null,
      note: cashoutNote || null
    })

    setLoading(false)
    setCashoutEmp(null)
    showMsg('success', `✅ Cashed out ${sparksNum} sparks for ${cashoutEmp.first_name} ${cashoutEmp.last_name}`)
    fetchAll()
  }

  // ── REPORT ───────────────────────────────────────────────
  const runReport = async () => {
    setReportLoading(true)

    let txnQuery = supabase
      .from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name,last_name), to_emp:to_employee_id(first_name,last_name)')
      .gte('created_at', reportFrom + 'T00:00:00')
      .lte('created_at', reportTo + 'T23:59:59')
      .order('created_at', { ascending: false })

    if (reportTypeFilter !== 'all') {
      txnQuery = txnQuery.eq('transaction_type', reportTypeFilter)
    }

    const { data: txns } = await txnQuery

    // Cashouts in range
    const { data: cashouts } = await supabase
      .from('spark_cashouts')
      .select('*, employee:employee_id(first_name,last_name), admin:admin_id(first_name,last_name)')
      .gte('cashed_out_at', reportFrom + 'T00:00:00')
      .lte('cashed_out_at', reportTo + 'T23:59:59')
      .order('cashed_out_at', { ascending: false })

    const assignTxns = txns?.filter(t => t.transaction_type === 'assign') || []
    const totalAssigned = assignTxns.reduce((s, t) => s + t.amount, 0)
    const totalCashedOut = cashouts?.reduce((s, c) => s + c.sparks_redeemed, 0) || 0

    const { data: allEmps } = await supabase.from('employees').select('vested_sparks, unvested_sparks').eq('is_admin', false)
    const totalInSystem = allEmps?.reduce((s, e) => s + (e.vested_sparks||0) + (e.unvested_sparks||0), 0) || 0

    setReportData({ txns: txns || [], cashouts: cashouts || [], totalAssigned, totalCashedOut, totalInSystem })
    setReportLoading(false)
  }

  return (
    <div className="fade-in">
      <h1 className="page-title">⚙️ Admin Dashboard</h1>
      <p className="page-subtitle">Manage employees, sparks, and settings</p>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <div className="tabs">
        {['employees','add','batch','settings','reports'].map(t => (
          <button key={t} className={`tab-btn${tab===t?' active':''}`} onClick={() => setTab(t)}>
            {t === 'employees' && '👥 Employees'}
            {t === 'add' && '➕ Add Employee'}
            {t === 'batch' && '📋 Batch Import'}
            {t === 'settings' && '⚙️ Settings'}
            {t === 'reports' && '📊 Reports'}
          </button>
        ))}
      </div>

      {/* ── EMPLOYEES TAB ── */}
      {tab === 'employees' && (
        <div className="card">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px', flexWrap:'wrap', gap:'12px'}}>
            <div className="card-title" style={{marginBottom:0}}><span className="icon">👥</span> All Employees ({employees.length})</div>
            <div className="sort-control" style={{marginBottom:0}}>
              <span className="sort-label">Sort:</span>
              <button className={`sort-btn${sortMode==='name'?' active':''}`} onClick={() => setSortMode('name')}>A–Z</button>
              <button className={`sort-btn${sortMode==='ranking'?' active':''}`} onClick={() => setSortMode('ranking')}>🏆 Ranking</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Vested ✨</th>
                  <th>Unvested ⏳</th>
                  <th>Total</th>
                  <th>Daily Left</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map(emp => {
                  const total = (emp.vested_sparks||0)+(emp.unvested_sparks||0)
                  return (
                    <tr key={emp.id}>
                      <td style={{fontWeight:600}}>{emp.first_name} {emp.last_name}</td>
                      <td style={{fontSize:'0.82rem'}}>{emp.email}</td>
                      <td style={{fontSize:'0.82rem'}}>{emp.phone||'—'}</td>
                      <td><span className="spark-badge">✨ {emp.vested_sparks||0}</span></td>
                      <td style={{color:'var(--white-dim)'}}>⏳ {emp.unvested_sparks||0}</td>
                      <td style={{fontWeight:700, color:'var(--gold)'}}>{total}</td>
                      <td>{emp.daily_sparks_remaining||0}/{emp.daily_accrual||0}</td>
                      <td>
                        <div style={{display:'flex', gap:'5px', flexWrap:'wrap'}}>
                          <button className="btn btn-outline btn-xs" onClick={() => openEdit(emp)}>Edit</button>
                          <button className="btn btn-xs" style={{background:'rgba(94,232,138,0.2)',color:'var(--green-bright)',border:'1px solid rgba(94,232,138,0.3)'}} onClick={() => openCashout(emp)}>💰 Cash Out</button>
                          <button className="btn btn-danger btn-xs" onClick={() => removeEmployee(emp)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ADD EMPLOYEE TAB ── */}
      {tab === 'add' && (
        <div className="card">
          <div className="card-title"><span className="icon">➕</span> Add New Employee</div>
          <form onSubmit={addEmployee}>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">First Name *</label>
                <input className="form-input" value={form.first_name} onChange={e => setForm(f=>({...f, first_name:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name *</label>
                <input className="form-input" value={form.last_name} onChange={e => setForm(f=>({...f, last_name:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input className="form-input" type="email" value={form.email} onChange={e => setForm(f=>({...f, email:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone} onChange={e => setForm(f=>({...f, phone:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Initial Sparks (unvested)</label>
                <input className="form-input" type="number" min="0" value={form.initial_sparks} onChange={e => setForm(f=>({...f, initial_sparks:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Daily Accrual (sparks/day to give)</label>
                <input className="form-input" type="number" min="0" value={form.daily_accrual} onChange={e => setForm(f=>({...f, daily_accrual:e.target.value}))} />
              </div>
            </div>
            <div className="alert alert-warning" style={{marginTop:'8px'}}>
              Default password: <strong>spark123</strong> · Employee will be prompted to change on first login.
            </div>
            <button className="btn btn-gold" type="submit" disabled={loading} style={{marginTop:'12px'}}>
              {loading ? 'Adding...' : '➕ Add Employee'}
            </button>
          </form>
        </div>
      )}

      {/* ── BATCH IMPORT TAB ── */}
      {tab === 'batch' && (
        <div className="card">
          <div className="card-title"><span className="icon">📋</span> Batch Import Employees</div>
          <div className="alert alert-warning">
            <strong>Format:</strong> One employee per line — <code>FirstName, LastName, Phone, Email, InitialSparks, DailyAccrual</code>
          </div>
          <div className="form-group" style={{marginTop:'16px'}}>
            <label className="form-label">Paste CSV Data</label>
            <textarea className="form-textarea" rows={10} value={batchText} onChange={e => setBatchText(e.target.value)}
              placeholder={`John,Smith,555-1234,john.smith@dde.com,10,2\nJane,Doe,555-5678,jane.doe@dde.com,5,2`} />
          </div>
          <button className="btn btn-gold" onClick={addBatch} disabled={loading || !batchText.trim()}>
            {loading ? 'Importing...' : '📋 Import Employees'}
          </button>
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'settings' && (
        <div className="card">
          <div className="card-title"><span className="icon">⚙️</span> Global Settings</div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Vesting Period (Days)</label>
              <input className="form-input" type="number" min="1" max="365"
                value={settings.vesting_period_days || 30}
                onChange={e => setSettings(s=>({...s, vesting_period_days:e.target.value}))} />
              <p style={{fontSize:'0.78rem', color:'var(--white-dim)', marginTop:'6px'}}>
                Sparks vest this many days after they are <em>assigned</em> to an employee (not from hire date).
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Default Daily Allowance</label>
              <input className="form-input" type="number" min="0" max="20"
                value={settings.daily_spark_allowance || 2}
                onChange={e => setSettings(s=>({...s, daily_spark_allowance:e.target.value}))} />
              <p style={{fontSize:'0.78rem', color:'var(--white-dim)', marginTop:'6px'}}>
                Reference value — each employee's actual allowance is set per-employee via Daily Accrual.
              </p>
            </div>
          </div>
          <button className="btn btn-gold" onClick={saveSettings} disabled={loading}>
            {loading ? 'Saving...' : '💾 Save Settings'}
          </button>
        </div>
      )}

      {/* ── REPORTS TAB ── */}
      {tab === 'reports' && (
        <div>
          <div className="card" style={{marginBottom:'20px'}}>
            <div className="card-title"><span className="icon">📊</span> Spark Activity Report</div>

            <div style={{display:'flex', gap:'12px', alignItems:'flex-end', flexWrap:'wrap', marginBottom:'20px'}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">From</label>
                <input type="date" style={{background:'rgba(0,0,0,0.4)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--white)',padding:'8px 12px',fontFamily:'var(--font-body)',outline:'none'}}
                  value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">To</label>
                <input type="date" style={{background:'rgba(0,0,0,0.4)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--white)',padding:'8px 12px',fontFamily:'var(--font-body)',outline:'none'}}
                  value={reportTo} onChange={e => setReportTo(e.target.value)} />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">Type Filter</label>
                <select className="form-select" style={{minWidth:'160px'}} value={reportTypeFilter} onChange={e => setReportTypeFilter(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="assign">Peer Sparks Only</option>
                  <option value="admin_adjust">Admin Adjustments Only</option>
                  <option value="cashout">Cash Outs Only</option>
                </select>
              </div>
              <button className="btn btn-gold btn-sm" onClick={runReport} disabled={reportLoading} style={{alignSelf:'flex-end', marginBottom:'0'}}>
                {reportLoading ? 'Loading...' : '📊 Run Report'}
              </button>
            </div>

            {reportData && (
              <>
                <div className="stat-grid" style={{marginBottom:'24px'}}>
                  <div className="stat-card">
                    <div className="stat-value">{reportData.totalAssigned}</div>
                    <div className="stat-label">Sparks Assigned</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{color:'var(--green-bright)'}}>{reportData.totalCashedOut}</div>
                    <div className="stat-label">Sparks Cashed Out</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{reportData.totalInSystem}</div>
                    <div className="stat-label">Total in System Now</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{reportData.txns.length + reportData.cashouts.length}</div>
                    <div className="stat-label">Total Transactions</div>
                  </div>
                </div>

                {/* Cashout sub-report */}
                {(reportTypeFilter === 'all' || reportTypeFilter === 'cashout') && reportData.cashouts.length > 0 && (
                  <div style={{marginBottom:'24px'}}>
                    <div style={{fontFamily:'var(--font-display)', fontSize:'0.85rem', color:'var(--green-bright)', letterSpacing:'0.08em', marginBottom:'12px'}}>
                      💰 CASH OUT TRANSACTIONS
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Employee</th>
                            <th>Sparks Redeemed</th>
                            <th>Value / Gift</th>
                            <th>Note</th>
                            <th>Processed By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.cashouts.map(co => (
                            <tr key={co.id}>
                              <td style={{fontSize:'0.8rem', whiteSpace:'nowrap'}}>{new Date(co.cashed_out_at).toLocaleDateString()}</td>
                              <td style={{fontWeight:600}}>{co.employee?.first_name} {co.employee?.last_name}</td>
                              <td><span className="spark-badge" style={{color:'var(--green-bright)', borderColor:'rgba(94,232,138,0.4)'}}>✨ {co.sparks_redeemed}</span></td>
                              <td style={{fontSize:'0.85rem'}}>{co.redemption_value || '—'}</td>
                              <td style={{fontSize:'0.82rem', color:'var(--white-dim)'}}>{co.note || '—'}</td>
                              <td style={{fontSize:'0.82rem', color:'var(--white-dim)'}}>{co.admin?.first_name} {co.admin?.last_name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Main transaction log */}
                {reportData.txns.length > 0 && (
                  <>
                    <div style={{fontFamily:'var(--font-display)', fontSize:'0.85rem', color:'var(--gold)', letterSpacing:'0.08em', marginBottom:'12px'}}>
                      ✨ SPARK TRANSACTIONS
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>From</th>
                            <th>To</th>
                            <th>Amount</th>
                            <th>Type</th>
                            <th>Reason / Note</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.txns.map(txn => {
                            const typeInfo = TYPE_LABELS[txn.transaction_type] || { label: txn.transaction_type, color: 'gold' }
                            return (
                              <tr key={txn.id}>
                                <td style={{fontSize:'0.8rem', whiteSpace:'nowrap'}}>{new Date(txn.created_at).toLocaleDateString()}</td>
                                <td style={{fontSize:'0.85rem'}}>{txn.from_emp ? `${txn.from_emp.first_name} ${txn.from_emp.last_name}` : '—'}</td>
                                <td style={{fontSize:'0.85rem'}}>{txn.to_emp ? `${txn.to_emp.first_name} ${txn.to_emp.last_name}` : '—'}</td>
                                <td>
                                  <span className="spark-badge" style={txn.amount < 0 ? {color:'var(--red)', borderColor:'rgba(224,85,85,0.4)'} : {}}>
                                    {txn.amount > 0 ? '✨' : '💸'} {Math.abs(txn.amount)}
                                  </span>
                                </td>
                                <td><span className={`chip chip-${typeInfo.color}`}>{typeInfo.label}</span></td>
                                <td style={{fontSize:'0.8rem', color:'var(--white-dim)', maxWidth:'180px'}}>
                                  {txn.reason || txn.note || <span style={{opacity:0.4}}>—</span>}
                                </td>
                                <td><span className={`chip chip-${txn.vested ? 'green' : 'gold'}`}>{txn.vested ? 'Vested' : 'Pending'}</span></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {reportData.txns.length === 0 && reportData.cashouts.length === 0 && (
                  <div className="empty-state"><div className="icon">📊</div><p>No transactions in this date range</p></div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editEmp && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setEditEmp(null)}>
          <div className="modal">
            <div className="modal-title">✏️ Edit: {editEmp.first_name} {editEmp.last_name}</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" value={editValues.first_name} onChange={e => setEditValues(v=>({...v, first_name:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" value={editValues.last_name} onChange={e => setEditValues(v=>({...v, last_name:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" value={editValues.email} onChange={e => setEditValues(v=>({...v, email:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={editValues.phone} onChange={e => setEditValues(v=>({...v, phone:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Vested Sparks ✨</label>
                <input className="form-input" type="number" min="0" value={editValues.vested_sparks} onChange={e => setEditValues(v=>({...v, vested_sparks:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Unvested Sparks ⏳</label>
                <input className="form-input" type="number" min="0" value={editValues.unvested_sparks} onChange={e => setEditValues(v=>({...v, unvested_sparks:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Daily Accrual (sparks/day)</label>
                <input className="form-input" type="number" min="0" value={editValues.daily_accrual} onChange={e => setEditValues(v=>({...v, daily_accrual:e.target.value}))} />
              </div>
            </div>
            <div style={{display:'flex', gap:'10px', marginTop:'16px', flexWrap:'wrap'}}>
              <button className="btn btn-gold" onClick={saveEdit} disabled={loading}>{loading ? 'Saving...' : '💾 Save Changes'}</button>
              <button className="btn btn-outline" onClick={() => setEditEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CASHOUT MODAL ── */}
      {cashoutEmp && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setCashoutEmp(null)}>
          <div className="modal">
            <div className="modal-title">💰 Cash Out Sparks — {cashoutEmp.first_name} {cashoutEmp.last_name}</div>

            <div className="stat-grid" style={{marginBottom:'20px', gridTemplateColumns:'repeat(3,1fr)'}}>
              <div className="stat-card">
                <div className="stat-value" style={{fontSize:'1.4rem'}}>{cashoutEmp.vested_sparks||0}</div>
                <div className="stat-label">Vested</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{fontSize:'1.4rem', color:'var(--white-dim)'}}>{cashoutEmp.unvested_sparks||0}</div>
                <div className="stat-label">Unvested</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{fontSize:'1.4rem', color:'var(--gold)'}}>
                  {(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)}
                </div>
                <div className="stat-label">Total</div>
              </div>
            </div>

            <div className="alert alert-warning" style={{marginBottom:'16px'}}>
              Sparks will be deducted from vested balance first, then unvested. This action cannot be undone.
            </div>

            <div className="form-group">
              <label className="form-label">Sparks to Redeem *</label>
              <input className="form-input" type="number" min="1"
                max={(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)}
                value={cashoutSparks} onChange={e => setCashoutSparks(e.target.value)}
                placeholder="Enter number of sparks..." />
            </div>
            <div className="form-group">
              <label className="form-label">Redemption Value / Gift Description</label>
              <input className="form-input" value={cashoutValue} onChange={e => setCashoutValue(e.target.value)}
                placeholder='e.g. "$50 gift card", "Cash $25", "Extra PTO day"' />
            </div>
            <div className="form-group">
              <label className="form-label">Note (optional)</label>
              <input className="form-input" value={cashoutNote} onChange={e => setCashoutNote(e.target.value)}
                placeholder="Any additional notes..." />
            </div>

            <div style={{display:'flex', gap:'10px', marginTop:'16px', flexWrap:'wrap'}}>
              <button className="btn btn-sm" style={{background:'var(--green-bright)', color:'#000', fontFamily:'var(--font-display)', fontSize:'0.75rem', letterSpacing:'0.1em'}}
                onClick={processCashout} disabled={loading || !cashoutSparks}>
                {loading ? 'Processing...' : '💰 Process Cash Out'}
              </button>
              <button className="btn btn-outline" onClick={() => setCashoutEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
