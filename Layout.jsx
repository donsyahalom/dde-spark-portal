import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function AdminPage() {
  const { currentUser } = useAuth()
  const [tab, setTab] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({ vesting_period_days: '30' })
  const [sortMode, setSortMode] = useState('name')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  // Add employee form
  const emptyForm = { first_name: '', last_name: '', email: '', phone: '', initial_sparks: 0, daily_accrual: 0 }
  const [form, setForm] = useState(emptyForm)
  const [batchText, setBatchText] = useState('')

  // Edit modal
  const [editEmp, setEditEmp] = useState(null)
  const [editValues, setEditValues] = useState({})

  // Report
  const [reportFrom, setReportFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0])
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
      const tA = (a.vested_sparks||0)+(a.unvested_sparks||0)
      const tB = (b.vested_sparks||0)+(b.unvested_sparks||0)
      return tB - tA
    }
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
  })

  const showMsg = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
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
      daily_sparks_remaining: 2
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
      const { error } = await supabase.from('employees').insert({
        first_name, last_name, phone: phone || '', email: email.toLowerCase(),
        password_hash: 'spark123', must_change_password: true,
        vested_sparks: 0, unvested_sparks: parseInt(initial_sparks)||0,
        daily_accrual: parseInt(daily_accrual)||0, daily_sparks_remaining: 2
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
      first_name: emp.first_name,
      last_name: emp.last_name,
      email: emp.email,
      phone: emp.phone || '',
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
      first_name: editValues.first_name,
      last_name: editValues.last_name,
      email: editValues.email.toLowerCase(),
      phone: editValues.phone,
      vested_sparks: newVested,
      unvested_sparks: newUnvested,
      daily_accrual: parseInt(editValues.daily_accrual)||0,
      updated_at: new Date().toISOString()
    }).eq('id', editEmp.id)

    // Log adjustment if sparks changed
    const vestedDiff = newVested - oldVested
    const unvestDiff = newUnvested - oldUnvested
    if (vestedDiff !== 0 || unvestDiff !== 0) {
      await supabase.from('spark_transactions').insert({
        from_employee_id: currentUser.id,
        to_employee_id: editEmp.id,
        amount: vestedDiff + unvestDiff,
        transaction_type: 'admin_adjust',
        note: `Admin adjustment: vested ${vestedDiff>=0?'+':''}${vestedDiff}, unvested ${unvestDiff>=0?'+':''}${unvestDiff}`,
        vested: vestedDiff !== 0
      })
    }

    setLoading(false)
    setEditEmp(null)
    showMsg('success', 'Employee updated!')
    fetchAll()
  }

  const runReport = async () => {
    setReportLoading(true)
    const { data: txns } = await supabase
      .from('spark_transactions')
      .select(`*, from_emp:from_employee_id(first_name,last_name), to_emp:to_employee_id(first_name,last_name)`)
      .gte('created_at', reportFrom + 'T00:00:00')
      .lte('created_at', reportTo + 'T23:59:59')
      .order('created_at', { ascending: false })

    const totalAssigned = txns?.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0) || 0
    const totalAdminAdj = txns?.filter(t => t.transaction_type === 'admin_adjust').reduce((s,t) => s+t.amount, 0) || 0
    const { data: allEmps } = await supabase.from('employees').select('vested_sparks, unvested_sparks').eq('is_admin', false)
    const totalInSystem = allEmps?.reduce((s, e) => s + (e.vested_sparks||0) + (e.unvested_sparks||0), 0) || 0

    setReportData({ txns: txns || [], totalAssigned, totalAdminAdj, totalInSystem })
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

      {/* EMPLOYEES TAB */}
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
                  <th>Unvested ✨</th>
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
                      <td>{emp.daily_sparks_remaining||0}/2</td>
                      <td>
                        <div style={{display:'flex',gap:'6px', flexWrap:'wrap'}}>
                          <button className="btn btn-outline btn-xs" onClick={() => openEdit(emp)}>Edit</button>
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

      {/* ADD EMPLOYEE TAB */}
      {tab === 'add' && (
        <div className="card">
          <div className="card-title"><span className="icon">➕</span> Add New Employee</div>
          <form onSubmit={addEmployee}>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">First Name *</label>
                <input className="form-input" value={form.first_name}
                  onChange={e => setForm(f=>({...f, first_name:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name *</label>
                <input className="form-input" value={form.last_name}
                  onChange={e => setForm(f=>({...f, last_name:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input className="form-input" type="email" value={form.email}
                  onChange={e => setForm(f=>({...f, email:e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone}
                  onChange={e => setForm(f=>({...f, phone:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Initial Sparks (unvested)</label>
                <input className="form-input" type="number" min="0" value={form.initial_sparks}
                  onChange={e => setForm(f=>({...f, initial_sparks:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Daily Accrual Rate</label>
                <input className="form-input" type="number" min="0" value={form.daily_accrual}
                  onChange={e => setForm(f=>({...f, daily_accrual:e.target.value}))} />
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

      {/* BATCH IMPORT TAB */}
      {tab === 'batch' && (
        <div className="card">
          <div className="card-title"><span className="icon">📋</span> Batch Import Employees</div>
          <div className="alert alert-warning">
            <strong>Format:</strong> One employee per line — <code>FirstName, LastName, Phone, Email, InitialSparks, DailyAccrual</code>
          </div>
          <div className="form-group" style={{marginTop:'16px'}}>
            <label className="form-label">Paste CSV Data</label>
            <textarea className="form-textarea" rows={10} value={batchText}
              onChange={e => setBatchText(e.target.value)}
              placeholder={`John,Smith,555-1234,john.smith@dde.com,10,0\nJane,Doe,555-5678,jane.doe@dde.com,5,1`} />
          </div>
          <button className="btn btn-gold" onClick={addBatch} disabled={loading || !batchText.trim()}>
            {loading ? 'Importing...' : '📋 Import Employees'}
          </button>
        </div>
      )}

      {/* SETTINGS TAB */}
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
                Sparks vest this many days after they are <em>assigned</em> to an employee.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Daily Spark Allowance per Employee</label>
              <input className="form-input" type="number" min="1" max="10"
                value={settings.daily_spark_allowance || 2}
                onChange={e => setSettings(s=>({...s, daily_spark_allowance:e.target.value}))} />
              <p style={{fontSize:'0.78rem', color:'var(--white-dim)', marginTop:'6px'}}>
                How many sparks each employee can give per day.
              </p>
            </div>
          </div>
          <button className="btn btn-gold" onClick={saveSettings} disabled={loading}>
            {loading ? 'Saving...' : '💾 Save Settings'}
          </button>
        </div>
      )}

      {/* REPORTS TAB */}
      {tab === 'reports' && (
        <div>
          <div className="card" style={{marginBottom:'20px'}}>
            <div className="card-title"><span className="icon">📊</span> Spark Activity Report</div>
            <div className="date-range" style={{marginBottom:'16px'}}>
              <label className="form-label" style={{marginBottom:0}}>From:</label>
              <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
              <label className="form-label" style={{marginBottom:0}}>To:</label>
              <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} />
              <button className="btn btn-gold btn-sm" onClick={runReport} disabled={reportLoading}>
                {reportLoading ? 'Loading...' : '📊 Run Report'}
              </button>
            </div>

            {reportData && (
              <>
                <div className="stat-grid" style={{marginBottom:'20px'}}>
                  <div className="stat-card">
                    <div className="stat-value">{reportData.totalAssigned}</div>
                    <div className="stat-label">Sparks Assigned</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{reportData.totalInSystem}</div>
                    <div className="stat-label">Total in System</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{reportData.txns.length}</div>
                    <div className="stat-label">Transactions</div>
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>From</th>
                        <th>To</th>
                        <th>Amount</th>
                        <th>Type</th>
                        <th>Note</th>
                        <th>Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.txns.map(txn => (
                        <tr key={txn.id}>
                          <td>{txn.from_emp ? `${txn.from_emp.first_name} ${txn.from_emp.last_name}` : '—'}</td>
                          <td>{txn.to_emp ? `${txn.to_emp.first_name} ${txn.to_emp.last_name}` : '—'}</td>
                          <td><span className="spark-badge">✨ {txn.amount}</span></td>
                          <td><span className={`chip chip-${txn.transaction_type==='assign'?'gold':txn.transaction_type==='admin_adjust'?'red':'green'}`}>{txn.transaction_type}</span></td>
                          <td style={{fontSize:'0.78rem', color:'var(--white-dim)'}}>{txn.note||'—'}</td>
                          <td style={{fontSize:'0.78rem'}}>{new Date(txn.created_at).toLocaleDateString()}</td>
                          <td><span className={`chip chip-${txn.vested?'green':'gold'}`}>{txn.vested?'Vested':'Pending'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editEmp && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setEditEmp(null)}>
          <div className="modal">
            <div className="modal-title">✏️ Edit: {editEmp.first_name} {editEmp.last_name}</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" value={editValues.first_name}
                  onChange={e => setEditValues(v=>({...v, first_name:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" value={editValues.last_name}
                  onChange={e => setEditValues(v=>({...v, last_name:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" value={editValues.email}
                  onChange={e => setEditValues(v=>({...v, email:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={editValues.phone}
                  onChange={e => setEditValues(v=>({...v, phone:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Vested Sparks ✨</label>
                <input className="form-input" type="number" min="0" value={editValues.vested_sparks}
                  onChange={e => setEditValues(v=>({...v, vested_sparks:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Unvested Sparks ⏳</label>
                <input className="form-input" type="number" min="0" value={editValues.unvested_sparks}
                  onChange={e => setEditValues(v=>({...v, unvested_sparks:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Daily Accrual</label>
                <input className="form-input" type="number" min="0" value={editValues.daily_accrual}
                  onChange={e => setEditValues(v=>({...v, daily_accrual:e.target.value}))} />
              </div>
            </div>
            <div style={{display:'flex', gap:'10px', marginTop:'16px'}}>
              <button className="btn btn-gold" onClick={saveEdit} disabled={loading}>
                {loading ? 'Saving...' : '💾 Save Changes'}
              </button>
              <button className="btn btn-outline" onClick={() => setEditEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
