import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { JOB_GRADES, JOB_TITLES, MANAGEMENT_GRADES, FREQUENCY_OPTIONS, getFrequencyLabel } from '../lib/constants'
import { sendAllSummaryEmails } from '../lib/emailService'

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
  const [settings, setSettings] = useState({})
  const [sortMode, setSortMode] = useState('name')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  const emptyForm = { first_name:'', last_name:'', email:'', phone:'', initial_sparks:0, daily_accrual:0, job_grade:'', job_title:'', is_management:false, has_spark_list:false }
  const [form, setForm] = useState(emptyForm)
  const [batchText, setBatchText] = useState('')
  const [editEmp, setEditEmp] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [cashoutEmp, setCashoutEmp] = useState(null)
  const [cashoutSparks, setCashoutSparks] = useState('')
  const [cashoutValue, setCashoutValue] = useState('')
  const [cashoutNote, setCashoutNote] = useState('')

  // Reports
  const [reportFrom, setReportFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().split('T')[0] })
  const [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0])
  const [reportTypeFilter, setReportTypeFilter] = useState('all')
  const [reportData, setReportData] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [unusedData, setUnusedData] = useState(null)
  const reportRef = useRef(null)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const [{ data: emps }, { data: sData }] = await Promise.all([
      supabase.from('employees').select('*').eq('is_admin', false).order('last_name'),
      supabase.from('settings').select('*')
    ])
    if (emps) setEmployees(emps)
    if (sData) { const o = {}; sData.forEach(s => { o[s.key] = s.value }); setSettings(o) }
  }

  const sortedEmployees = [...employees].sort((a, b) => {
    if (sortMode === 'ranking') return ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
  })

  const showMsg = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage(null), 5000) }

  const saveSettings = async () => {
    setLoading(true)
    for (const [key, value] of Object.entries(settings)) {
      await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' })
    }
    setLoading(false)
    showMsg('success', 'Settings saved!')
  }

  const addEmployee = async (e) => {
    e.preventDefault(); setLoading(true)
    const accrual = parseInt(form.daily_accrual) || 0
    const { error } = await supabase.from('employees').insert({
      first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      email: form.email.toLowerCase().trim(), phone: form.phone.trim(),
      password_hash: 'spark123', must_change_password: true,
      vested_sparks: 0, unvested_sparks: parseInt(form.initial_sparks)||0,
      daily_accrual: accrual, daily_sparks_remaining: accrual,
      job_grade: form.job_grade, job_title: form.job_title,
      is_management: form.is_management || MANAGEMENT_GRADES.includes(form.job_grade),
      has_spark_list: form.has_spark_list,
    })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    showMsg('success', `${form.first_name} ${form.last_name} added!`)
    setForm(emptyForm); fetchAll()
  }

  const addBatch = async () => {
    const lines = batchText.trim().split('\n').filter(l => l.trim())
    if (!lines.length) return
    setLoading(true); let added = 0, errors = 0
    for (const line of lines) {
      const [fn, ln, phone, email, init, accrual, grade, title] = line.split(',').map(s => s?.trim())
      if (!fn || !ln || !email) { errors++; continue }
      const a = parseInt(accrual) || 0
      const { error } = await supabase.from('employees').insert({
        first_name: fn, last_name: ln, phone: phone||'', email: email.toLowerCase(),
        password_hash: 'spark123', must_change_password: true,
        vested_sparks: 0, unvested_sparks: parseInt(init)||0,
        daily_accrual: a, daily_sparks_remaining: a,
        job_grade: grade||'', job_title: title||'',
        is_management: MANAGEMENT_GRADES.includes(grade||''),
      })
      if (error) errors++; else added++
    }
    setLoading(false)
    showMsg(errors ? 'warning' : 'success', `Added ${added}. ${errors ? `${errors} failed.` : ''}`)
    setBatchText(''); fetchAll()
  }

  const removeEmployee = async (emp) => {
    if (!window.confirm(`Remove ${emp.first_name} ${emp.last_name}? Cannot be undone.`)) return
    await supabase.from('employees').delete().eq('id', emp.id)
    showMsg('success', `${emp.first_name} ${emp.last_name} removed`); fetchAll()
  }

  const openEdit = (emp) => {
    setEditEmp(emp)
    setEditValues({
      first_name: emp.first_name, last_name: emp.last_name, email: emp.email, phone: emp.phone||'',
      vested_sparks: emp.vested_sparks||0, unvested_sparks: emp.unvested_sparks||0,
      daily_accrual: emp.daily_accrual||0, job_grade: emp.job_grade||'', job_title: emp.job_title||'',
      is_management: emp.is_management||false, has_spark_list: emp.has_spark_list||false,
    })
  }

  const saveEdit = async () => {
    setLoading(true)
    const oldV = editEmp.vested_sparks||0, oldU = editEmp.unvested_sparks||0
    const newV = parseInt(editValues.vested_sparks)||0, newU = parseInt(editValues.unvested_sparks)||0
    await supabase.from('employees').update({
      first_name: editValues.first_name, last_name: editValues.last_name,
      email: editValues.email.toLowerCase(), phone: editValues.phone,
      vested_sparks: newV, unvested_sparks: newU,
      daily_accrual: parseInt(editValues.daily_accrual)||0,
      job_grade: editValues.job_grade, job_title: editValues.job_title,
      is_management: editValues.is_management || MANAGEMENT_GRADES.includes(editValues.job_grade),
      has_spark_list: editValues.has_spark_list,
      updated_at: new Date().toISOString()
    }).eq('id', editEmp.id)
    const vd = newV - oldV, ud = newU - oldU
    if (vd !== 0 || ud !== 0) {
      await supabase.from('spark_transactions').insert({
        from_employee_id: currentUser.id, to_employee_id: editEmp.id,
        amount: vd + ud, transaction_type: 'admin_adjust',
        note: `Admin: vested ${vd>=0?'+':''}${vd}, unvested ${ud>=0?'+':''}${ud}`, vested: newV > 0
      })
    }
    setLoading(false); setEditEmp(null); showMsg('success', 'Employee updated!'); fetchAll()
  }

  // ── CASHOUT ──────────────────────────────────────────
  const processCashout = async () => {
    const n = parseInt(cashoutSparks)
    if (!n || n < 1) { showMsg('error', 'Enter valid spark amount'); return }
    const total = (cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)
    if (n > total) { showMsg('error', `Only ${total} sparks available`); return }
    setLoading(true)
    const fromV = Math.min(n, cashoutEmp.vested_sparks||0), fromU = n - fromV
    await supabase.from('employees').update({
      vested_sparks: (cashoutEmp.vested_sparks||0)-fromV,
      unvested_sparks: Math.max(0,(cashoutEmp.unvested_sparks||0)-fromU),
      updated_at: new Date().toISOString()
    }).eq('id', cashoutEmp.id)
    await supabase.from('spark_transactions').insert({
      from_employee_id: cashoutEmp.id, to_employee_id: cashoutEmp.id,
      amount: -n, transaction_type: 'cashout', note: cashoutNote||null, reason: cashoutValue||null, vested: true
    })
    await supabase.from('spark_cashouts').insert({
      employee_id: cashoutEmp.id, admin_id: currentUser.id,
      sparks_redeemed: n, redemption_value: cashoutValue||null, note: cashoutNote||null
    })
    setLoading(false); setCashoutEmp(null)
    showMsg('success', `✅ Cashed out ${n} sparks for ${cashoutEmp.first_name} ${cashoutEmp.last_name}`)
    fetchAll()
  }

  // ── REPORTS ──────────────────────────────────────────
  const runReport = async () => {
    setReportLoading(true)
    let q = supabase.from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name,last_name), to_emp:to_employee_id(first_name,last_name)')
      .gte('created_at', reportFrom+'T00:00:00').lte('created_at', reportTo+'T23:59:59')
      .order('created_at', { ascending: false })
    if (reportTypeFilter !== 'all') q = q.eq('transaction_type', reportTypeFilter)
    const { data: txns } = await q
    const { data: cashouts } = await supabase.from('spark_cashouts')
      .select('*, employee:employee_id(first_name,last_name), admin:admin_id(first_name,last_name)')
      .gte('cashed_out_at', reportFrom+'T00:00:00').lte('cashed_out_at', reportTo+'T23:59:59')
      .order('cashed_out_at', { ascending: false })
    const assignTxns = (txns||[]).filter(t => t.transaction_type==='assign')
    const totalAssigned = assignTxns.reduce((s,t) => s+t.amount, 0)
    const totalCashedOut = (cashouts||[]).reduce((s,c) => s+c.sparks_redeemed, 0)
    const { data: allEmps } = await supabase.from('employees').select('vested_sparks,unvested_sparks').eq('is_admin',false)
    const totalInSystem = (allEmps||[]).reduce((s,e) => s+(e.vested_sparks||0)+(e.unvested_sparks||0), 0)
    setReportData({ txns: txns||[], cashouts: cashouts||[], totalAssigned, totalCashedOut, totalInSystem })
    setReportLoading(false)
  }

  const runUnusedReport = async () => {
    setReportLoading(true)
    // Get non-management employees with remaining sparks
    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, job_title, job_grade, daily_sparks_remaining, daily_accrual, is_management')
      .eq('is_admin', false)
      .eq('is_management', false)
    const withUnused = (emps||[]).filter(e => (e.daily_sparks_remaining||0) > 0)
    const totalUnused = withUnused.reduce((s,e) => s+(e.daily_sparks_remaining||0), 0)
    setUnusedData({ employees: withUnused, totalUnused, reportDate: new Date().toLocaleDateString() })
    setReportLoading(false)
  }

  // ── EXPORT ──────────────────────────────────────────
  const exportCSV = () => {
    if (!reportData && !unusedData) return
    let csv = ''
    if (unusedData) {
      csv = 'Employee,Job Title,Job Grade,Unused Sparks,Daily Accrual\n'
      unusedData.employees.forEach(e => {
        csv += `"${e.first_name} ${e.last_name}","${e.job_title||''}","${e.job_grade||''}",${e.daily_sparks_remaining||0},${e.daily_accrual||0}\n`
      })
      csv += `\nTotal Unused,${unusedData.totalUnused}\n`
    } else {
      csv = 'Date,From,To,Amount,Type,Reason/Note,Status\n'
      reportData.txns.forEach(t => {
        const from = t.from_emp ? `${t.from_emp.first_name} ${t.from_emp.last_name}` : ''
        const to = t.to_emp ? `${t.to_emp.first_name} ${t.to_emp.last_name}` : ''
        csv += `"${new Date(t.created_at).toLocaleDateString()}","${from}","${to}",${t.amount},"${t.transaction_type}","${t.reason||t.note||''}","${t.vested?'Vested':'Pending'}"\n`
      })
      if (reportData.cashouts.length > 0) {
        csv += '\nCASH OUT TRANSACTIONS\nDate,Employee,Sparks Redeemed,Value,Note,Admin\n'
        reportData.cashouts.forEach(c => {
          csv += `"${new Date(c.cashed_out_at).toLocaleDateString()}","${c.employee?.first_name} ${c.employee?.last_name}",${c.sparks_redeemed},"${c.redemption_value||''}","${c.note||''}","${c.admin?.first_name} ${c.admin?.last_name}"\n`
        })
      }
    }
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `dde-sparks-report-${reportFrom||'unused'}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = () => {
    const win = window.open('', '_blank')
    const content = reportRef.current?.innerHTML || '<p>No report data</p>'
    win.document.write(`<!DOCTYPE html><html><head><title>DDE Spark Report</title>
<style>
body{font-family:Arial,sans-serif;color:#222;padding:20px;font-size:12px;}
h1{color:#26643F;font-size:18px;}h2{color:#26643F;font-size:14px;margin-top:20px;}
table{width:100%;border-collapse:collapse;margin-top:10px;}
th{background:#26643F;color:#fff;padding:6px 8px;text-align:left;font-size:11px;}
td{padding:5px 8px;border-bottom:1px solid #ddd;font-size:11px;}
.stat-box{display:inline-block;margin:8px;padding:12px 20px;background:#f5f5f5;border-radius:6px;text-align:center;}
.stat-val{font-size:20px;font-weight:bold;color:#26643F;}
.stat-lbl{font-size:10px;color:#666;text-transform:uppercase;}
@media print{body{padding:0;}}
</style></head><body>
<h1>DDE Spark Portal — Report</h1>
<p style="color:#666">Generated: ${new Date().toLocaleString()}</p>
${content}
<script>window.onload=()=>window.print()</script>
</body></html>`)
    win.document.close()
  }

  const triggerEmails = async () => {
    if (!window.confirm('Send period summary emails to all employees now?')) return
    setLoading(true)
    await sendAllSummaryEmails(reportFrom, reportTo)
    setLoading(false)
    showMsg('success', 'Summary emails sent!')
  }

  const freqLabel = getFrequencyLabel(settings.spark_frequency || 'daily')

  return (
    <div className="fade-in">
      <h1 className="page-title">⚙️ Admin Dashboard</h1>
      <p className="page-subtitle">Manage employees, sparks, and settings</p>
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <div className="tabs">
        {[['employees','👥 Employees'],['add','➕ Add'],['batch','📋 Batch'],['settings','⚙️ Settings'],['reports','📊 Reports']].map(([t,label]) => (
          <button key={t} className={`tab-btn${tab===t?' active':''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {/* ── EMPLOYEES TAB ── */}
      {tab === 'employees' && (
        <div className="card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px',flexWrap:'wrap',gap:'12px'}}>
            <div className="card-title" style={{marginBottom:0}}><span className="icon">👥</span> All Employees ({employees.length})</div>
            <div className="sort-control" style={{marginBottom:0}}>
              <span className="sort-label">Sort:</span>
              <button className={`sort-btn${sortMode==='name'?' active':''}`} onClick={() => setSortMode('name')}>A–Z</button>
              <button className={`sort-btn${sortMode==='ranking'?' active':''}`} onClick={() => setSortMode('ranking')}>🏆 Ranking</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Grade</th><th>Title</th><th>Email</th><th>Vested</th><th>Unvested</th><th>Total</th><th>Left/{freqLabel}</th><th>Flags</th><th>Actions</th></tr></thead>
              <tbody>
                {sortedEmployees.map(emp => {
                  const total = (emp.vested_sparks||0)+(emp.unvested_sparks||0)
                  return (
                    <tr key={emp.id}>
                      <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{emp.first_name} {emp.last_name}</td>
                      <td><span style={{fontSize:'0.78rem',padding:'2px 6px',background:'rgba(240,192,64,0.1)',borderRadius:'4px',color:'var(--gold)'}}>{emp.job_grade||'—'}</span></td>
                      <td style={{fontSize:'0.82rem'}}>{emp.job_title||'—'}</td>
                      <td style={{fontSize:'0.78rem'}}>{emp.email}</td>
                      <td><span className="spark-badge">✨ {emp.vested_sparks||0}</span></td>
                      <td style={{color:'var(--white-dim)'}}>⏳ {emp.unvested_sparks||0}</td>
                      <td style={{fontWeight:700,color:'var(--gold)'}}>{total}</td>
                      <td>{emp.daily_sparks_remaining||0}/{emp.daily_accrual||0}</td>
                      <td>
                        <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                          {emp.is_management && <span className="chip chip-gold">Mgmt</span>}
                          {emp.has_spark_list && <span className="chip chip-green">List</span>}
                        </div>
                      </td>
                      <td>
                        <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                          <button className="btn btn-outline btn-xs" onClick={() => openEdit(emp)}>Edit</button>
                          <button className="btn btn-xs" style={{background:'rgba(94,232,138,0.2)',color:'var(--green-bright)',border:'1px solid rgba(94,232,138,0.3)'}} onClick={() => { setCashoutEmp(emp); setCashoutSparks(''); setCashoutValue(''); setCashoutNote('') }}>💰</button>
                          <button className="btn btn-danger btn-xs" onClick={() => removeEmployee(emp)}>✕</button>
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

      {/* ── ADD EMPLOYEE ── */}
      {tab === 'add' && (
        <div className="card">
          <div className="card-title"><span className="icon">➕</span> Add New Employee</div>
          <form onSubmit={addEmployee}>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={form.first_name} onChange={e=>setForm(f=>({...f,first_name:e.target.value}))} required /></div>
              <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={form.last_name} onChange={e=>setForm(f=>({...f,last_name:e.target.value}))} required /></div>
              <div className="form-group"><label className="form-label">Email *</label><input className="form-input" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required /></div>
              <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} /></div>
              <div className="form-group">
                <label className="form-label">Job Grade</label>
                <select className="form-select" value={form.job_grade} onChange={e=>setForm(f=>({...f,job_grade:e.target.value,is_management:MANAGEMENT_GRADES.includes(e.target.value)}))}>
                  {JOB_GRADES.map(g => <option key={g} value={g}>{g||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Job Title</label>
                <select className="form-select" value={form.job_title} onChange={e=>setForm(f=>({...f,job_title:e.target.value}))}>
                  {JOB_TITLES.map(t => <option key={t} value={t}>{t||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Initial Sparks (unvested)</label><input className="form-input" type="number" min="0" value={form.initial_sparks} onChange={e=>setForm(f=>({...f,initial_sparks:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">{freqLabel} Accrual</label><input className="form-input" type="number" min="0" value={form.daily_accrual} onChange={e=>setForm(f=>({...f,daily_accrual:e.target.value}))} /></div>
            </div>
            <div style={{display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'12px'}}>
              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'0.85rem'}}>
                <input type="checkbox" checked={form.is_management} onChange={e=>setForm(f=>({...f,is_management:e.target.checked}))} style={{accentColor:'var(--gold)'}} />
                Is Management
              </label>
              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'0.85rem'}}>
                <input type="checkbox" checked={form.has_spark_list} onChange={e=>setForm(f=>({...f,has_spark_list:e.target.checked}))} style={{accentColor:'var(--gold)'}} />
                Has Spark Distribution List
              </label>
            </div>
            <div className="alert alert-warning" style={{marginBottom:'12px'}}>Default password: <strong>spark123</strong></div>
            <button className="btn btn-gold" type="submit" disabled={loading}>{loading ? 'Adding...' : '➕ Add Employee'}</button>
          </form>
        </div>
      )}

      {/* ── BATCH IMPORT ── */}
      {tab === 'batch' && (
        <div className="card">
          <div className="card-title"><span className="icon">📋</span> Batch Import</div>
          <div className="alert alert-warning"><strong>Format:</strong> <code>FirstName, LastName, Phone, Email, InitialSparks, DailyAccrual, JobGrade, JobTitle</code></div>
          <div className="form-group" style={{marginTop:'14px'}}>
            <label className="form-label">CSV Data</label>
            <textarea className="form-textarea" rows={10} value={batchText} onChange={e=>setBatchText(e.target.value)}
              placeholder="John,Smith,555-1234,john@dde.com,0,2,J1,Journeyman" />
          </div>
          <button className="btn btn-gold" onClick={addBatch} disabled={loading||!batchText.trim()}>{loading?'Importing...':'📋 Import'}</button>
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'settings' && (
        <div className="card">
          <div className="card-title"><span className="icon">⚙️</span> Global Settings</div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Vesting Period (Days)</label>
              <input className="form-input" type="number" min="1" max="365" value={settings.vesting_period_days||30} onChange={e=>setSettings(s=>({...s,vesting_period_days:e.target.value}))} />
              <p style={{fontSize:'0.75rem',color:'var(--white-dim)',marginTop:'5px'}}>Days after assignment before sparks vest.</p>
            </div>
            <div className="form-group">
              <label className="form-label">Spark Frequency</label>
              <select className="form-select" value={settings.spark_frequency||'daily'} onChange={e=>setSettings(s=>({...s,spark_frequency:e.target.value}))}>
                {FREQUENCY_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label} — resets {f.resetDesc}</option>)}
              </select>
              <p style={{fontSize:'0.75rem',color:'var(--white-dim)',marginTop:'5px'}}>When each employee's giving allowance resets.</p>
            </div>
            <div className="form-group">
              <label className="form-label">Standard Daily Accrual (non-management)</label>
              <input className="form-input" type="number" min="0" max="20" value={settings.daily_spark_allowance||2} onChange={e=>setSettings(s=>({...s,daily_spark_allowance:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Management Max Allowance (P1–P4 & Owner)</label>
              <input className="form-input" type="number" min="0" max="50" value={settings.management_daily_accrual||5} onChange={e=>setSettings(s=>({...s,management_daily_accrual:e.target.value}))} />
              <p style={{fontSize:'0.75rem',color:'var(--white-dim)',marginTop:'5px'}}>Separate allowance for management-grade employees.</p>
            </div>
            {(settings.spark_frequency === 'biweekly') && (
              <div className="form-group">
                <label className="form-label">Bi-Weekly Reference Date</label>
                <input className="form-input" type="date" value={settings.biweekly_reference_date||''} onChange={e=>setSettings(s=>({...s,biweekly_reference_date:e.target.value}))} />
                <p style={{fontSize:'0.75rem',color:'var(--white-dim)',marginTop:'5px'}}>Start date for the 14-day cycle.</p>
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'8px'}}>
            <button className="btn btn-gold" onClick={saveSettings} disabled={loading}>{loading?'Saving...':'💾 Save Settings'}</button>
            <button className="btn btn-outline" onClick={triggerEmails} disabled={loading}>📧 Send Period Summary Emails</button>
          </div>
        </div>
      )}

      {/* ── REPORTS ── */}
      {tab === 'reports' && (
        <div>
          <div className="card" style={{marginBottom:'16px'}}>
            <div className="card-title"><span className="icon">📊</span> Report Filters</div>
            <div style={{display:'flex',gap:'12px',alignItems:'flex-end',flexWrap:'wrap'}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">From</label>
                <input type="date" className="form-input" style={{width:'auto'}} value={reportFrom} onChange={e=>setReportFrom(e.target.value)} />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">To</label>
                <input type="date" className="form-input" style={{width:'auto'}} value={reportTo} onChange={e=>setReportTo(e.target.value)} />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">Type</label>
                <select className="form-select" style={{minWidth:'160px'}} value={reportTypeFilter} onChange={e=>setReportTypeFilter(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="assign">Peer Sparks</option>
                  <option value="admin_adjust">Admin Adjustments</option>
                  <option value="cashout">Cash Outs</option>
                </select>
              </div>
              <button className="btn btn-gold btn-sm" onClick={runReport} disabled={reportLoading}>📊 Run Spark Report</button>
              <button className="btn btn-outline btn-sm" onClick={runUnusedReport} disabled={reportLoading}>🔍 Unused Sparks</button>
            </div>
          </div>

          {/* Export buttons */}
          {(reportData || unusedData) && (
            <div style={{display:'flex',gap:'10px',marginBottom:'16px',flexWrap:'wrap'}}>
              <button className="btn btn-outline btn-sm" onClick={exportCSV}>⬇️ Export CSV</button>
              <button className="btn btn-outline btn-sm" onClick={exportPDF}>🖨️ Export PDF</button>
            </div>
          )}

          <div ref={reportRef}>
            {/* ── UNUSED SPARKS REPORT ── */}
            {unusedData && (
              <div className="card" style={{marginBottom:'16px'}}>
                <div className="card-title"><span className="icon">🔍</span> Unused Sparks Report — {unusedData.reportDate}</div>
                <p style={{fontSize:'0.82rem',color:'var(--white-dim)',marginBottom:'16px'}}>Non-management employees with unused giving allowance. Management (P1–P4, Owner) excluded.</p>
                <div className="stat-grid" style={{marginBottom:'16px'}}>
                  <div className="stat-card"><div className="stat-value" style={{color:'var(--red)'}}>{unusedData.totalUnused}</div><div className="stat-label">Total Unused</div></div>
                  <div className="stat-card"><div className="stat-value">{unusedData.employees.length}</div><div className="stat-label">Employees w/ Unused</div></div>
                </div>
                {unusedData.employees.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Employee</th><th>Title</th><th>Grade</th><th>Unused Sparks</th><th>Allowance</th></tr></thead>
                      <tbody>
                        {unusedData.employees.map(e => (
                          <tr key={e.id}>
                            <td style={{fontWeight:600}}>{e.first_name} {e.last_name}</td>
                            <td style={{fontSize:'0.82rem'}}>{e.job_title||'—'}</td>
                            <td><span style={{fontSize:'0.78rem',padding:'2px 6px',background:'rgba(240,192,64,0.1)',borderRadius:'4px',color:'var(--gold)'}}>{e.job_grade||'—'}</span></td>
                            <td><span style={{color:'var(--red)',fontWeight:700}}>🔥 {e.daily_sparks_remaining||0}</span></td>
                            <td style={{color:'var(--white-dim)'}}>{e.daily_accrual||0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="empty-state"><p>All employees have used their sparks! 🎉</p></div>}
              </div>
            )}

            {/* ── MAIN SPARK REPORT ── */}
            {reportData && (
              <div className="card">
                <div className="card-title"><span className="icon">📊</span> Spark Activity — {reportFrom} to {reportTo}</div>
                <div className="stat-grid" style={{marginBottom:'20px'}}>
                  <div className="stat-card"><div className="stat-value">{reportData.totalAssigned}</div><div className="stat-label">Sparks Assigned</div></div>
                  <div className="stat-card"><div className="stat-value" style={{color:'var(--green-bright)'}}>{reportData.totalCashedOut}</div><div className="stat-label">Cashed Out</div></div>
                  <div className="stat-card"><div className="stat-value">{reportData.totalInSystem}</div><div className="stat-label">Total in System</div></div>
                  <div className="stat-card"><div className="stat-value">{reportData.txns.length + reportData.cashouts.length}</div><div className="stat-label">Transactions</div></div>
                </div>

                {/* Cashouts */}
                {(reportTypeFilter==='all'||reportTypeFilter==='cashout') && reportData.cashouts.length > 0 && (
                  <div style={{marginBottom:'20px'}}>
                    <div style={{fontFamily:'var(--font-display)',fontSize:'0.82rem',color:'var(--green-bright)',letterSpacing:'0.08em',marginBottom:'10px'}}>💰 CASH OUT TRANSACTIONS</div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Date</th><th>Employee</th><th>Sparks</th><th>Value</th><th>Note</th><th>Admin</th></tr></thead>
                        <tbody>
                          {reportData.cashouts.map(co => (
                            <tr key={co.id}>
                              <td style={{fontSize:'0.8rem',whiteSpace:'nowrap'}}>{new Date(co.cashed_out_at).toLocaleDateString()}</td>
                              <td style={{fontWeight:600}}>{co.employee?.first_name} {co.employee?.last_name}</td>
                              <td><span className="spark-badge" style={{color:'var(--green-bright)',borderColor:'rgba(94,232,138,0.4)'}}>✨ {co.sparks_redeemed}</span></td>
                              <td style={{fontSize:'0.85rem'}}>{co.redemption_value||'—'}</td>
                              <td style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>{co.note||'—'}</td>
                              <td style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>{co.admin?.first_name} {co.admin?.last_name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Transactions */}
                {reportData.txns.length > 0 && (
                  <>
                    <div style={{fontFamily:'var(--font-display)',fontSize:'0.82rem',color:'var(--gold)',letterSpacing:'0.08em',marginBottom:'10px'}}>✨ TRANSACTIONS</div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Date</th><th>From</th><th>To</th><th>Amt</th><th>Type</th><th>Reason</th><th>Status</th></tr></thead>
                        <tbody>
                          {reportData.txns.map(txn => {
                            const ti = TYPE_LABELS[txn.transaction_type]||{label:txn.transaction_type,color:'gold'}
                            return (
                              <tr key={txn.id}>
                                <td style={{fontSize:'0.8rem',whiteSpace:'nowrap'}}>{new Date(txn.created_at).toLocaleDateString()}</td>
                                <td style={{fontSize:'0.82rem'}}>{txn.from_emp?`${txn.from_emp.first_name} ${txn.from_emp.last_name}`:'—'}</td>
                                <td style={{fontSize:'0.82rem'}}>{txn.to_emp?`${txn.to_emp.first_name} ${txn.to_emp.last_name}`:'—'}</td>
                                <td><span className="spark-badge" style={txn.amount<0?{color:'var(--red)',borderColor:'rgba(224,85,85,0.4)'}:{}}>{txn.amount>0?'✨':'💸'} {Math.abs(txn.amount)}</span></td>
                                <td><span className={`chip chip-${ti.color}`}>{ti.label}</span></td>
                                <td style={{fontSize:'0.78rem',color:'var(--white-dim)',maxWidth:'160px'}}>{txn.reason||txn.note||<span style={{opacity:0.35}}>—</span>}</td>
                                <td><span className={`chip chip-${txn.vested?'green':'gold'}`}>{txn.vested?'Vested':'Pending'}</span></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {reportData.txns.length === 0 && reportData.cashouts.length === 0 && (
                  <div className="empty-state"><p>No transactions in this range</p></div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editEmp && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditEmp(null)}>
          <div className="modal">
            <div className="modal-title">✏️ Edit: {editEmp.first_name} {editEmp.last_name}</div>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">First Name</label><input className="form-input" value={editValues.first_name} onChange={e=>setEditValues(v=>({...v,first_name:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Last Name</label><input className="form-input" value={editValues.last_name} onChange={e=>setEditValues(v=>({...v,last_name:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={editValues.email} onChange={e=>setEditValues(v=>({...v,email:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={editValues.phone} onChange={e=>setEditValues(v=>({...v,phone:e.target.value}))} /></div>
              <div className="form-group">
                <label className="form-label">Job Grade</label>
                <select className="form-select" value={editValues.job_grade} onChange={e=>setEditValues(v=>({...v,job_grade:e.target.value,is_management:MANAGEMENT_GRADES.includes(e.target.value)}))}>
                  {JOB_GRADES.map(g=><option key={g} value={g}>{g||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Job Title</label>
                <select className="form-select" value={editValues.job_title} onChange={e=>setEditValues(v=>({...v,job_title:e.target.value}))}>
                  {JOB_TITLES.map(t=><option key={t} value={t}>{t||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Vested ✨</label><input className="form-input" type="number" min="0" value={editValues.vested_sparks} onChange={e=>setEditValues(v=>({...v,vested_sparks:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Unvested ⏳</label><input className="form-input" type="number" min="0" value={editValues.unvested_sparks} onChange={e=>setEditValues(v=>({...v,unvested_sparks:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">{freqLabel} Accrual</label><input className="form-input" type="number" min="0" value={editValues.daily_accrual} onChange={e=>setEditValues(v=>({...v,daily_accrual:e.target.value}))} /></div>
            </div>
            <div style={{display:'flex',gap:'16px',marginBottom:'16px',flexWrap:'wrap'}}>
              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'0.85rem'}}>
                <input type="checkbox" checked={editValues.is_management} onChange={e=>setEditValues(v=>({...v,is_management:e.target.checked}))} style={{accentColor:'var(--gold)'}} />
                Is Management
              </label>
              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'0.85rem'}}>
                <input type="checkbox" checked={editValues.has_spark_list} onChange={e=>setEditValues(v=>({...v,has_spark_list:e.target.checked}))} style={{accentColor:'var(--gold)'}} />
                Has Spark Distribution List
              </label>
            </div>
            <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
              <button className="btn btn-gold" onClick={saveEdit} disabled={loading}>{loading?'Saving...':'💾 Save'}</button>
              <button className="btn btn-outline" onClick={()=>setEditEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CASHOUT MODAL ── */}
      {cashoutEmp && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setCashoutEmp(null)}>
          <div className="modal">
            <div className="modal-title">💰 Cash Out — {cashoutEmp.first_name} {cashoutEmp.last_name}</div>
            <div className="stat-grid" style={{marginBottom:'16px',gridTemplateColumns:'repeat(3,1fr)'}}>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.4rem'}}>{cashoutEmp.vested_sparks||0}</div><div className="stat-label">Vested</div></div>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.4rem',color:'var(--white-dim)'}}>{cashoutEmp.unvested_sparks||0}</div><div className="stat-label">Unvested</div></div>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.4rem',color:'var(--gold)'}}>{(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)}</div><div className="stat-label">Total</div></div>
            </div>
            <div className="alert alert-warning" style={{marginBottom:'14px'}}>Deducts from vested first, then unvested. Cannot be undone.</div>
            <div className="form-group"><label className="form-label">Sparks to Redeem *</label><input className="form-input" type="number" min="1" max={(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)} value={cashoutSparks} onChange={e=>setCashoutSparks(e.target.value)} placeholder="Number of sparks..." /></div>
            <div className="form-group"><label className="form-label">Redemption Value / Gift</label><input className="form-input" value={cashoutValue} onChange={e=>setCashoutValue(e.target.value)} placeholder='"$50 gift card", "Cash $25", "Extra PTO"' /></div>
            <div className="form-group"><label className="form-label">Note</label><input className="form-input" value={cashoutNote} onChange={e=>setCashoutNote(e.target.value)} placeholder="Optional notes..." /></div>
            <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
              <button className="btn btn-sm" style={{background:'var(--green-bright)',color:'#000',fontFamily:'var(--font-display)',fontSize:'0.75rem',letterSpacing:'0.1em'}} onClick={processCashout} disabled={loading||!cashoutSparks}>{loading?'Processing...':'💰 Process Cash Out'}</button>
              <button className="btn btn-outline" onClick={()=>setCashoutEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
