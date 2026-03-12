import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { JOB_GRADES, JOB_TITLES, MANAGEMENT_GRADES, FREQUENCY_OPTIONS, CARRIERS, LEADERBOARD_RANGE_OPTIONS, getFrequencyLabel } from '../lib/constants'
import { sendTestNotification, isBeforeGoLive } from '../lib/notificationService'

// ── Dual-scrollbar wrapper ────────────────────────────────────────────────────
// Renders a phantom top scrollbar that mirrors the real bottom one.
function DualScrollTable({ children }) {
  const outerRef = useRef(null)   // real scroll container (bottom)
  const topRef   = useRef(null)   // phantom top bar
  const syncingOuter = useRef(false)
  const syncingTop   = useRef(false)

  // Keep phantom width in sync with table width
  const phantomRef = useRef(null)
  const syncWidth = useCallback(() => {
    if (!outerRef.current || !phantomRef.current) return
    phantomRef.current.style.width = outerRef.current.scrollWidth + 'px'
  }, [])

  useEffect(() => {
    syncWidth()
    const ro = new ResizeObserver(syncWidth)
    if (outerRef.current) ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [syncWidth])

  const onTopScroll = () => {
    if (syncingTop.current) { syncingTop.current = false; return }
    syncingOuter.current = true
    if (outerRef.current && topRef.current) outerRef.current.scrollLeft = topRef.current.scrollLeft
  }
  const onOuterScroll = () => {
    if (syncingOuter.current) { syncingOuter.current = false; return }
    syncingTop.current = true
    if (topRef.current && outerRef.current) topRef.current.scrollLeft = outerRef.current.scrollLeft
  }

  return (
    <div>
      {/* Top phantom scrollbar */}
      <div ref={topRef} onScroll={onTopScroll}
        style={{overflowX:'auto',overflowY:'hidden',height:'16px',marginBottom:'2px',background:'transparent'}}>
        <div ref={phantomRef} style={{height:'1px'}}></div>
      </div>
      {/* Real table */}
      <div ref={outerRef} onScroll={onOuterScroll} style={{overflowX:'auto',paddingBottom:'4px'}}>
        {children}
      </div>
    </div>
  )
}

const TYPE_LABELS = {
  assign:       { label:'Peer Spark',  color:'gold' },
  admin_adjust: { label:'Admin Adj.',  color:'red'  },
  cashout:      { label:'Cash Out',    color:'green' },
  initial:      { label:'Initial',     color:'gold' },
  daily_accrual:{ label:'Accrual',     color:'gold' },
}

const REMINDER_PRESETS = [24, 48, 72, 12, 6, 3, 1]

export default function AdminPage() {
  const { currentUser } = useAuth()
  const [tab, setTab] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({})
  const [sortMode, setSortMode] = useState('name')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [beforeGoLive, setBeforeGoLive] = useState(true)

  const emptyForm = { first_name:'', last_name:'', email:'', phone:'', carrier:'', initial_sparks:0, daily_accrual:0, job_grade:'', job_title:'', is_management:false, has_spark_list:false, notify_email:true, notify_sms:false }
  const [form, setForm] = useState(emptyForm)
  const [batchText, setBatchText] = useState('')
  const [editEmp, setEditEmp] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [cashoutEmp, setCashoutEmp] = useState(null)
  const [cashoutSparks, setCashoutSparks] = useState('')
  const [cashoutValue, setCashoutValue] = useState('')
  const [cashoutNote, setCashoutNote] = useState('')
  const [testEmpId, setTestEmpId] = useState('')
  const [testChannel, setTestChannel] = useState('email')
  const [testLoading, setTestLoading] = useState(false)
  const [reminderOffsets, setReminderOffsets] = useState(['48','24',''])
  // Reminder time warning
  const [reminderWarning, setReminderWarning] = useState(null)

  // Reports
  const [reportFrom, setReportFrom] = useState(()=>{const d=new Date();d.setDate(d.getDate()-30);return d.toISOString().split('T')[0]})
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
    if (sData) {
      const o = {}; sData.forEach(s => { o[s.key] = s.value }); setSettings(o)
      const parts = (o.reminder_offsets||'48,24').split(',').map(x=>x.trim())
      while (parts.length < 3) parts.push('')
      setReminderOffsets(parts.slice(0,3))
    }
    const before = await isBeforeGoLive()
    setBeforeGoLive(before)
  }

  const sortedEmployees = [...employees].sort((a,b) => {
    if (sortMode === 'ranking') return ((b.vested_sparks||0)+(b.unvested_sparks||0)) - ((a.vested_sparks||0)+(a.unvested_sparks||0))
    return a.last_name.localeCompare(b.last_name)||a.first_name.localeCompare(b.first_name)
  })

  const showMsg = (type, text) => { setMessage({type,text}); setTimeout(()=>setMessage(null), 5000) }

  const saveSettings = async () => {
    setLoading(true)
    const offsets = reminderOffsets.filter(x=>x.trim()).join(',')
    const allSettings = { ...settings, reminder_offsets: offsets }
    for (const [key, value] of Object.entries(allSettings)) {
      await supabase.from('settings').upsert({ key, value: String(value||'') }, { onConflict:'key' })
    }
    // Check reminder times if frequency != daily
    const freq = settings.spark_frequency || 'daily'
    if (freq !== 'daily') {
      checkReminderWarnings(reminderOffsets, freq)
    }
    setLoading(false); showMsg('success', 'Settings saved!')
    fetchAll()
  }

  const checkReminderWarnings = (offsets, freq) => {
    // Compute next reset and check if reminder would fire at odd hour
    const warnings = []
    offsets.filter(x=>x).forEach(hrs => {
      const hrsNum = parseFloat(hrs)
      // Estimate what time of day the reminder fires (very rough)
      // midnight CT - hrsNum hours = what hour of day?
      const reminderHour = (24 - (hrsNum % 24)) % 24
      if (reminderHour > 21 || reminderHour < 7) {
        warnings.push(`${hrs}h reminder would fire around ${reminderHour}:00 CT — are you sure?`)
      }
    })
    if (warnings.length) setReminderWarning(warnings)
  }

  // Go-live reset
  const handleGoLiveReset = async () => {
    const goLive = settings.go_live_date
    if (!goLive) { showMsg('error', 'Set a go-live date first'); return }
    const now = new Date()
    const glDate = new Date(goLive)
    if (now < glDate) { showMsg('warning', `Go-live date is ${goLive} — reset won't happen until then`); return }
    if (!window.confirm('⚠️ This will RESET all employee spark totals to 0. This cannot be undone. Are you sure?')) return
    setLoading(true)
    await supabase.rpc('apply_go_live_reset')
    setLoading(false); showMsg('success', 'Go-live reset applied! All spark totals are now 0.'); fetchAll()
  }

  const addEmployee = async (e) => {
    e.preventDefault(); setLoading(true)
    const accrual = parseInt(form.daily_accrual) || 0
    const { error } = await supabase.from('employees').insert({
      first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      email: form.email.toLowerCase().trim(), phone: form.phone.trim(), carrier: form.carrier,
      password_hash: 'spark123', must_change_password: true,
      vested_sparks: 0, unvested_sparks: parseInt(form.initial_sparks)||0,
      daily_accrual: accrual, daily_sparks_remaining: accrual,
      job_grade: form.job_grade, job_title: form.job_title,
      is_management: form.is_management || MANAGEMENT_GRADES.includes(form.job_grade),
      has_spark_list: form.has_spark_list,
      notify_email: form.notify_email, notify_sms: form.notify_sms,
    })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    showMsg('success', `${form.first_name} ${form.last_name} added!`)
    setForm(emptyForm); fetchAll()
  }

  const addBatch = async () => {
    const lines = batchText.trim().split('\n').filter(l=>l.trim())
    if (!lines.length) return
    setLoading(true)
    let added=0, updated=0, errors=0, errorDetails=[]

    for (const line of lines) {
      // Split by comma, trim each field
      const parts = line.split(',').map(s=>s?.trim())
      const [fn, ln, phone, email, init, accrual, grade, title, isMgmt, hasList, notifEmail, notifSms, carrier] = parts
      if (!fn || !ln || !email) { errors++; errorDetails.push(`Missing required fields: ${line.substring(0,60)}`); continue }

      const emailLower = email.toLowerCase()
      const a = parseInt(accrual) || 0
      const initSparks = parseInt(init) || 0
      const isManagementVal = isMgmt?.toLowerCase()==='true' || MANAGEMENT_GRADES.includes(grade||'')
      const hasSparkListVal = hasList?.toLowerCase()==='true'
      const notifyEmailVal = notifEmail?.toLowerCase()!=='false'  // default true
      const notifySmsVal = notifSms?.toLowerCase()==='true'       // default false
      const carrierVal = carrier || ''

      // Check if employee exists by email
      const { data: existing } = await supabase.from('employees').select('id, vested_sparks, unvested_sparks').eq('email', emailLower).single()

      if (existing) {
        // UPDATE existing employee — replace all provided fields
        const updatePayload = {
          first_name: fn, last_name: ln, phone: phone||'', email: emailLower,
          daily_accrual: a, daily_sparks_remaining: a,
          job_grade: grade||'', job_title: title||'',
          is_management: isManagementVal, has_spark_list: hasSparkListVal,
          notify_email: notifyEmailVal, notify_sms: notifySmsVal,
          carrier: carrierVal, updated_at: new Date().toISOString()
        }
        // Only update sparks if a non-zero initial value was provided
        if (initSparks > 0) {
          updatePayload.unvested_sparks = initSparks
        }
        const { error } = await supabase.from('employees').update(updatePayload).eq('id', existing.id)
        if (error) { errors++; errorDetails.push(`Update failed for ${emailLower}: ${error.message}`) }
        else updated++
      } else {
        // INSERT new employee
        const { error } = await supabase.from('employees').insert({
          first_name: fn, last_name: ln, phone: phone||'', email: emailLower,
          password_hash: 'spark123', must_change_password: true,
          vested_sparks: 0, unvested_sparks: initSparks,
          daily_accrual: a, daily_sparks_remaining: a,
          job_grade: grade||'', job_title: title||'',
          is_management: isManagementVal, has_spark_list: hasSparkListVal,
          notify_email: notifyEmailVal, notify_sms: notifySmsVal,
          carrier: carrierVal,
        })
        if (error) { errors++; errorDetails.push(`Insert failed for ${emailLower}: ${error.message}`) }
        else added++
      }
    }

    setLoading(false)
    const summary = [`✅ ${added} added`, `🔄 ${updated} updated`, errors ? `❌ ${errors} failed` : ''].filter(Boolean).join(' · ')
    showMsg(errors ? 'warning' : 'success', summary)
    if (errorDetails.length) console.error('Batch errors:', errorDetails)
    if (!errors) setBatchText('')
    fetchAll()
  }

  const removeEmployee = async (emp) => {
    if (!window.confirm(`Remove ${emp.first_name} ${emp.last_name}? Cannot be undone.`)) return
    await supabase.from('employees').delete().eq('id', emp.id)
    showMsg('success', `${emp.first_name} ${emp.last_name} removed`); fetchAll()
  }

  const openEdit = (emp) => {
    setEditEmp(emp)
    setEditValues({
      first_name:emp.first_name, last_name:emp.last_name, email:emp.email, phone:emp.phone||'', carrier:emp.carrier||'',
      vested_sparks:emp.vested_sparks||0, unvested_sparks:emp.unvested_sparks||0, redeemed_sparks:emp.redeemed_sparks||0,
      daily_accrual:emp.daily_accrual||0, job_grade:emp.job_grade||'', job_title:emp.job_title||'',
      is_management:emp.is_management||false, has_spark_list:emp.has_spark_list||false,
      notify_email:emp.notify_email!==false, notify_sms:emp.notify_sms||false,
    })
  }

  const saveEdit = async () => {
    setLoading(true)
    const oldV=editEmp.vested_sparks||0, oldU=editEmp.unvested_sparks||0
    const newV=parseInt(editValues.vested_sparks)||0, newU=parseInt(editValues.unvested_sparks)||0
    await supabase.from('employees').update({
      first_name:editValues.first_name, last_name:editValues.last_name,
      email:editValues.email.toLowerCase(), phone:editValues.phone, carrier:editValues.carrier||'',
      vested_sparks:newV, unvested_sparks:newU,
      daily_accrual:parseInt(editValues.daily_accrual)||0,
      job_grade:editValues.job_grade, job_title:editValues.job_title,
      is_management:editValues.is_management||MANAGEMENT_GRADES.includes(editValues.job_grade),
      has_spark_list:editValues.has_spark_list,
      notify_email:editValues.notify_email, notify_sms:editValues.notify_sms,
      updated_at:new Date().toISOString()
    }).eq('id', editEmp.id)
    const vd=newV-oldV, ud=newU-oldU
    if (vd!==0||ud!==0) {
      await supabase.from('spark_transactions').insert({
        from_employee_id:currentUser.id, to_employee_id:editEmp.id,
        amount:vd+ud, transaction_type:'admin_adjust',
        note:`Admin: vested ${vd>=0?'+':''}${vd}, unvested ${ud>=0?'+':''}${ud}`, vested:newV>0
      })
    }
    setLoading(false); setEditEmp(null); showMsg('success','Employee updated!'); fetchAll()
  }

  // Cashout
  const processCashout = async () => {
    const n = parseInt(cashoutSparks)
    if (!n||n<1) { showMsg('error','Enter valid spark amount'); return }
    const total=(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)
    if (n>total) { showMsg('error',`Only ${total} sparks available`); return }
    setLoading(true)
    const fromV=Math.min(n,cashoutEmp.vested_sparks||0), fromU=n-fromV
    await supabase.from('employees').update({
      vested_sparks:(cashoutEmp.vested_sparks||0)-fromV,
      unvested_sparks:Math.max(0,(cashoutEmp.unvested_sparks||0)-fromU),
      redeemed_sparks:(cashoutEmp.redeemed_sparks||0)+n,
      updated_at:new Date().toISOString()
    }).eq('id', cashoutEmp.id)
    await supabase.from('spark_transactions').insert({
      from_employee_id:cashoutEmp.id, to_employee_id:cashoutEmp.id,
      amount:-n, transaction_type:'cashout', note:cashoutNote||null, reason:cashoutValue||null, vested:true
    })
    await supabase.from('spark_cashouts').insert({
      employee_id:cashoutEmp.id, admin_id:currentUser.id,
      sparks_redeemed:n, redemption_value:cashoutValue||null, note:cashoutNote||null
    })
    setLoading(false); setCashoutEmp(null)
    showMsg('success',`✅ Cashed out ${n} sparks for ${cashoutEmp.first_name} ${cashoutEmp.last_name}`)
    fetchAll()
  }

  // Test notification
  const handleTestNotif = async () => {
    const emp = employees.find(e=>e.id===testEmpId)
    if (!emp) { showMsg('error','Select an employee'); return }
    setTestLoading(true)
    await sendTestNotification(emp, testChannel)
    setTestLoading(false)
    showMsg('success',`Test ${testChannel} sent to ${emp.first_name} ${emp.last_name}`)
  }

  // Reports
  const runReport = async () => {
    setReportLoading(true)
    let q = supabase.from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name,last_name), to_emp:to_employee_id(first_name,last_name)')
      .gte('created_at', reportFrom+'T00:00:00').lte('created_at', reportTo+'T23:59:59')
      .order('created_at',{ascending:false})
    if (reportTypeFilter!=='all') q = q.eq('transaction_type',reportTypeFilter)
    const { data: txns } = await q
    const { data: cashouts } = await supabase.from('spark_cashouts')
      .select('*, employee:employee_id(first_name,last_name), admin:admin_id(first_name,last_name)')
      .gte('cashed_out_at', reportFrom+'T00:00:00').lte('cashed_out_at', reportTo+'T23:59:59')
      .order('cashed_out_at',{ascending:false})
    const assignTxns=(txns||[]).filter(t=>t.transaction_type==='assign')
    const totalAssigned=assignTxns.reduce((s,t)=>s+t.amount,0)
    const totalCashedOut=(cashouts||[]).reduce((s,c)=>s+c.sparks_redeemed,0)
    const { data: allEmps } = await supabase.from('employees').select('vested_sparks,unvested_sparks').eq('is_admin',false)
    const totalInSystem=(allEmps||[]).reduce((s,e)=>s+(e.vested_sparks||0)+(e.unvested_sparks||0),0)
    setReportData({txns:txns||[],cashouts:cashouts||[],totalAssigned,totalCashedOut,totalInSystem})
    setReportLoading(false)
  }

  const runUnusedReport = async () => {
    setReportLoading(true)
    const { data: emps } = await supabase.from('employees')
      .select('id,first_name,last_name,job_title,job_grade,daily_sparks_remaining,daily_accrual,is_management')
      .eq('is_admin',false).eq('is_management',false)
    const withUnused=(emps||[]).filter(e=>(e.daily_sparks_remaining||0)>0)
    setUnusedData({employees:withUnused, totalUnused:withUnused.reduce((s,e)=>s+(e.daily_sparks_remaining||0),0), reportDate:new Date().toLocaleDateString()})
    setReportLoading(false)
  }

  const exportCSV = () => {
    if (!reportData && !unusedData) return
    let csv = ''
    if (unusedData) {
      csv = 'Employee,Job Title,Job Grade,Unused Sparks,Daily Accrual\n'
      unusedData.employees.forEach(e => { csv += `"${e.first_name} ${e.last_name}","${e.job_title||''}","${e.job_grade||''}",${e.daily_sparks_remaining||0},${e.daily_accrual||0}\n` })
      csv += `\nTotal Unused,${unusedData.totalUnused}\n`
    } else {
      csv = 'Date,From,To,Amount,Type,Reason/Note,Status\n'
      reportData.txns.forEach(t => {
        const from=t.from_emp?`${t.from_emp.first_name} ${t.from_emp.last_name}`:''
        const to=t.to_emp?`${t.to_emp.first_name} ${t.to_emp.last_name}`:''
        csv += `"${new Date(t.created_at).toLocaleDateString()}","${from}","${to}",${t.amount},"${t.transaction_type}","${t.reason||t.note||''}","${t.vested?'Vested':'Pending'}"\n`
      })
    }
    const blob = new Blob([csv],{type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`dde-sparks-${reportFrom}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = () => {
    const win = window.open('','_blank')
    const content = reportRef.current?.innerHTML||'<p>No report data</p>'
    win.document.write(`<!DOCTYPE html><html><head><title>DDE Spark Report</title>
<style>body{font-family:Arial,sans-serif;color:#222;padding:20px;font-size:12px;}
h1{color:#26643F;font-size:18px;}h2{color:#26643F;font-size:14px;margin-top:20px;}
table{width:100%;border-collapse:collapse;margin-top:10px;}
th{background:#26643F;color:#fff;padding:6px 8px;text-align:left;font-size:11px;}
td{padding:5px 8px;border-bottom:1px solid #ddd;font-size:11px;}
@media print{body{padding:0;}}
</style></head><body>
<h1>DDE Spark Portal — Report</h1><p style="color:#666">Generated: ${new Date().toLocaleString()}</p>
${content}<script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  const freqLabel = getFrequencyLabel(settings.spark_frequency||'daily')

  return (
    <div className="fade-in">
      <h1 className="page-title">⚙️ Admin Dashboard</h1>
      <p className="page-subtitle">Manage employees, sparks, and settings</p>
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
      {beforeGoLive && (
        <div style={{background:'rgba(224,85,85,0.15)',border:'1px solid rgba(224,85,85,0.4)',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'0.82rem',color:'#ff8080'}}>
          ⚠️ <strong>Pre-launch mode</strong> — System emails and reminders are suppressed until the go-live date.
          {settings.go_live_date && ` Go-live: ${settings.go_live_date}`}
        </div>
      )}

      <div className="tabs">
        {[['employees','👥 Employees'],['add','➕ Add'],['batch','📋 Batch'],['settings','⚙️ Settings'],['reports','📊 Reports']].map(([t,label])=>(
          <button key={t} className={`tab-btn${tab===t?' active':''}`} onClick={()=>setTab(t)}>{label}</button>
        ))}
      </div>

      {/* EMPLOYEES TAB */}
      {tab==='employees'&&(
        <div className="card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px',flexWrap:'wrap',gap:'12px'}}>
            <div className="card-title" style={{marginBottom:0}}><span className="icon">👥</span> All Employees ({employees.length})</div>
            <div className="sort-control" style={{marginBottom:0}}>
              <span className="sort-label">Sort:</span>
              <button className={`sort-btn${sortMode==='name'?' active':''}`} onClick={()=>setSortMode('name')}>A–Z</button>
              <button className={`sort-btn${sortMode==='ranking'?' active':''}`} onClick={()=>setSortMode('ranking')}>🏆 Ranking</button>
            </div>
          </div>
          {/* Dual scrollbar: top mirror + bottom native */}
          <DualScrollTable>
            <table style={{minWidth:'1300px'}}>
              <thead>
                <tr>
                  {/* Identity + spark numbers + actions — immediately visible */}
                  <th style={{position:'sticky',left:0,background:'var(--bg-darker)',zIndex:2}}>Name</th>
                  <th>Grade</th>
                  <th>Title</th>
                  <th>Vested</th><th>Unvested</th><th>Redeemed</th><th>Total</th>
                  <th>Left/{freqLabel}</th>
                  <th>Notify</th>
                  <th>Flags</th>
                  <th>Actions</th>
                  {/* Contact details — scrolled into view */}
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Carrier / SMS Address</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map(emp => {
                  const total=(emp.vested_sparks||0)+(emp.unvested_sparks||0)+(emp.redeemed_sparks||0)
                  const carrierLabel = CARRIERS.find(c=>c.value===emp.carrier)?.label||'—'
                  const smsAddr = emp.phone && emp.carrier ? emp.phone.replace(/\D/g,'').slice(-10)+emp.carrier : null
                  return (
                    <tr key={emp.id}>
                      <td style={{fontWeight:600,whiteSpace:'nowrap',position:'sticky',left:0,background:'rgba(17,46,28,0.97)',zIndex:1}}>{emp.first_name} {emp.last_name}</td>
                      <td><span style={{fontSize:'0.72rem',padding:'2px 6px',background:'rgba(240,192,64,0.1)',borderRadius:'4px',color:'var(--gold)',whiteSpace:'nowrap'}}>{emp.job_grade||'—'}</span></td>
                      <td style={{fontSize:'0.78rem',whiteSpace:'nowrap'}}>{emp.job_title||'—'}</td>
                      <td><span className="spark-badge">✨ {emp.vested_sparks||0}</span></td>
                      <td style={{color:'var(--white-dim)'}}>{emp.unvested_sparks||0}</td>
                      <td style={{color:'var(--green-bright)',fontWeight:600}}>{emp.redeemed_sparks||0}</td>
                      <td style={{fontWeight:700,color:'var(--gold)'}}>{total}</td>
                      <td style={{whiteSpace:'nowrap'}}>{emp.daily_sparks_remaining||0}/{emp.daily_accrual||0}</td>
                      <td>
                        <div style={{display:'flex',gap:'3px'}}>
                          {emp.notify_email&&<span className="chip chip-gold" style={{fontSize:'0.6rem',padding:'1px 5px'}}>📧</span>}
                          {emp.notify_sms&&<span className="chip chip-green" style={{fontSize:'0.6rem',padding:'1px 5px'}}>📱</span>}
                        </div>
                      </td>
                      <td>
                        <div style={{display:'flex',gap:'3px',flexWrap:'wrap'}}>
                          {emp.is_management&&<span className="chip chip-gold" style={{fontSize:'0.58rem',padding:'1px 4px'}}>Mgmt</span>}
                          {emp.has_spark_list&&<span className="chip chip-green" style={{fontSize:'0.58rem',padding:'1px 4px'}}>List</span>}
                        </div>
                      </td>
                      <td>
                        <div style={{display:'flex',gap:'3px',flexWrap:'nowrap'}}>
                          <button className="btn btn-outline btn-xs" onClick={()=>openEdit(emp)}>Edit</button>
                          <button className="btn btn-xs" style={{background:'rgba(94,232,138,0.2)',color:'var(--green-bright)',border:'1px solid rgba(94,232,138,0.3)'}} onClick={()=>{setCashoutEmp(emp);setCashoutSparks('');setCashoutValue('');setCashoutNote('')}}>💰</button>
                          <button className="btn btn-danger btn-xs" onClick={()=>removeEmployee(emp)}>✕</button>
                        </div>
                      </td>
                      {/* Contact details — at end */}
                      <td style={{fontSize:'0.72rem',maxWidth:'180px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{emp.email}</td>
                      <td style={{fontSize:'0.72rem',whiteSpace:'nowrap'}}>{emp.phone||'—'}</td>
                      <td style={{fontSize:'0.7rem'}}>
                        <div style={{color:'var(--white-dim)'}}>{carrierLabel}</div>
                        {smsAddr&&<div style={{color:'var(--gold-dark)',fontFamily:'monospace',fontSize:'0.65rem',marginTop:'2px'}}>{smsAddr}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DualScrollTable>
        </div>
      )}

      {/* ADD EMPLOYEE */}
      {tab==='add'&&(
        <div className="card">
          <div className="card-title"><span className="icon">➕</span> Add New Employee</div>
          <form onSubmit={addEmployee}>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={form.first_name} onChange={e=>setForm(f=>({...f,first_name:e.target.value}))} required /></div>
              <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={form.last_name} onChange={e=>setForm(f=>({...f,last_name:e.target.value}))} required /></div>
              <div className="form-group"><label className="form-label">Email *</label><input className="form-input" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required /></div>
              <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="10-digit number" /></div>
              <div className="form-group">
                <label className="form-label">Cell Carrier (for SMS)</label>
                <select className="form-select" value={form.carrier} onChange={e=>setForm(f=>({...f,carrier:e.target.value}))}>
                  {CARRIERS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Job Grade</label>
                <select className="form-select" value={form.job_grade} onChange={e=>setForm(f=>({...f,job_grade:e.target.value,is_management:MANAGEMENT_GRADES.includes(e.target.value)}))}>
                  {JOB_GRADES.map(g=><option key={g} value={g}>{g||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Job Title</label>
                <select className="form-select" value={form.job_title} onChange={e=>setForm(f=>({...f,job_title:e.target.value}))}>
                  {JOB_TITLES.map(t=><option key={t} value={t}>{t||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Initial Sparks</label><input className="form-input" type="number" min="0" value={form.initial_sparks} onChange={e=>setForm(f=>({...f,initial_sparks:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">{freqLabel} Accrual</label><input className="form-input" type="number" min="0" value={form.daily_accrual} onChange={e=>setForm(f=>({...f,daily_accrual:e.target.value}))} /></div>
            </div>
            <div style={{display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'12px'}}>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={form.is_management} onChange={e=>setForm(f=>({...f,is_management:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> Management</label>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={form.has_spark_list} onChange={e=>setForm(f=>({...f,has_spark_list:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> Spark List</label>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={form.notify_email} onChange={e=>setForm(f=>({...f,notify_email:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> 📧 Email Notifs</label>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={form.notify_sms} onChange={e=>setForm(f=>({...f,notify_sms:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> 📱 SMS Notifs</label>
            </div>
            <div className="alert alert-warning" style={{marginBottom:'12px'}}>Default password: <strong>spark123</strong></div>
            <button className="btn btn-gold" type="submit" disabled={loading}>{loading?'Adding...':'➕ Add Employee'}</button>
          </form>
        </div>
      )}

      {/* BATCH IMPORT */}
      {tab==='batch'&&(
        <div className="card">
          <div className="card-title"><span className="icon">📋</span> Batch Import / Update</div>

          {/* Format reference */}
          <div style={{background:'rgba(0,0,0,0.3)',border:'1px solid var(--border)',borderRadius:'8px',padding:'14px 16px',marginBottom:'16px'}}>
            <div style={{fontFamily:'var(--font-display)',fontSize:'0.72rem',color:'var(--gold)',letterSpacing:'0.08em',marginBottom:'8px'}}>CSV FORMAT — ONE EMPLOYEE PER LINE</div>
            <code style={{fontSize:'0.72rem',color:'var(--white-soft)',display:'block',lineHeight:1.7,wordBreak:'break-all'}}>
              FirstName, LastName, Phone, Email, InitialSparks, DailyAccrual, JobGrade, JobTitle, IsManagement, HasSparkList, NotifyEmail, NotifySMS, Carrier
            </code>
            <div style={{marginTop:'10px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'4px 16px'}}>
              {[
                ['FirstName','Required'],['LastName','Required'],['Phone','Optional, digits only'],
                ['Email','Required — used as unique key'],['InitialSparks','Number, default 0'],
                ['DailyAccrual','Number, default 0'],['JobGrade','e.g. J1, F2, P1, Owner'],
                ['JobTitle','e.g. Journeyman, Foreman'],['IsManagement','true or false'],
                ['HasSparkList','true or false'],['NotifyEmail','true or false, default true'],
                ['NotifySMS','true or false, default false'],
                ['Carrier','Gateway suffix: @tmomail.net, @vtext.com, etc.'],
              ].map(([field,desc])=>(
                <div key={field} style={{fontSize:'0.7rem'}}>
                  <span style={{color:'var(--gold-light)',fontWeight:600}}>{field}</span>
                  <span style={{color:'var(--white-dim)'}}> — {desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{background:'rgba(224,85,85,0.12)',border:'1px solid rgba(224,85,85,0.3)',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'0.82rem'}}>
            <strong style={{color:'var(--red)'}}>⚠️ Upsert behavior:</strong>
            <span style={{color:'var(--white-dim)',marginLeft:'4px'}}>
              <strong>Email is the unique key.</strong> If a row's email matches an existing employee, their details will be <strong>replaced</strong> with the new values from that row (name, phone, accrual, job info, flags, carrier, etc.). Spark balances are only updated if InitialSparks &gt; 0. Rows with a new email will create a new employee with default password <code style={{color:'var(--gold)'}}>spark123</code>.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">CSV Data</label>
            <textarea className="form-textarea" rows={12} value={batchText} onChange={e=>setBatchText(e.target.value)}
              placeholder={`John,Smith,5551234567,john@dde.com,0,2,J1,Journeyman,false,false,true,false,@tmomail.net\nJane,Doe,5559876543,jane@dde.com,0,5,P1,Project Manager,true,true,true,true,@vtext.com`}
              style={{fontFamily:'monospace',fontSize:'0.8rem'}} />
          </div>
          <button className="btn btn-gold" onClick={addBatch} disabled={loading||!batchText.trim()}>{loading?'Importing...':'📋 Import / Update'}</button>
        </div>
      )}

      {/* SETTINGS */}
      {tab==='settings'&&(
        <div>
          {/* Reminder time warnings */}
          {reminderWarning && (
            <div className="alert alert-warning" style={{marginBottom:'16px'}}>
              <strong>⚠️ Reminder Timing Warning</strong>
              {reminderWarning.map((w,i)=><div key={i} style={{marginTop:'4px',fontSize:'0.82rem'}}>{w}</div>)}
              <button className="btn btn-sm btn-outline" style={{marginTop:'8px'}} onClick={()=>setReminderWarning(null)}>OK, keep it</button>
            </div>
          )}
          <div className="card" style={{marginBottom:'16px'}}>
            <div className="card-title"><span className="icon">⚙️</span> Spark Settings</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Vesting Period (Days)</label>
                <input className="form-input" type="number" min="1" max="365" value={settings.vesting_period_days||30} onChange={e=>setSettings(s=>({...s,vesting_period_days:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Spark Frequency</label>
                <select className="form-select" value={settings.spark_frequency||'daily'} onChange={e=>setSettings(s=>({...s,spark_frequency:e.target.value}))}>
                  {FREQUENCY_OPTIONS.map(f=><option key={f.value} value={f.value}>{f.label} — resets {f.resetDesc}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Standard Daily Accrual</label>
                <input className="form-input" type="number" min="0" max="20" value={settings.daily_spark_allowance||2} onChange={e=>setSettings(s=>({...s,daily_spark_allowance:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Management Accrual (P1–P4, Owner)</label>
                <input className="form-input" type="number" min="0" max="50" value={settings.management_daily_accrual||5} onChange={e=>setSettings(s=>({...s,management_daily_accrual:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Minimum Redemption Amount</label>
                <input className="form-input" type="number" min="1" max="500" value={settings.min_redemption_amount||20} onChange={e=>setSettings(s=>({...s,min_redemption_amount:e.target.value}))} />
                <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginTop:'4px'}}>Employees are told they must redeem at least this many sparks at once.</div>
              </div>
              {settings.spark_frequency==='biweekly'&&(
                <div className="form-group">
                  <label className="form-label">Bi-Weekly Reference Date</label>
                  <input className="form-input" type="date" value={settings.biweekly_reference_date||''} onChange={e=>setSettings(s=>({...s,biweekly_reference_date:e.target.value}))} />
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{marginBottom:'16px'}}>
            <div className="card-title"><span className="icon">📅</span> Go-Live Date</div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:'12px'}}>
              Before this date: all system emails/SMS are suppressed. When this date is reached, you can apply a reset to zero all spark totals and begin fresh.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Go-Live Date</label>
                <input className="form-input" type="date" value={settings.go_live_date||''} onChange={e=>setSettings(s=>({...s,go_live_date:e.target.value}))} />
              </div>
            </div>
            <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'4px'}}>
              <button className="btn btn-gold" onClick={saveSettings} disabled={loading}>{loading?'Saving...':'💾 Save Settings'}</button>
              <button className="btn btn-danger btn-sm" onClick={handleGoLiveReset} disabled={loading}>⚡ Apply Go-Live Reset</button>
            </div>
          </div>

          <div className="card" style={{marginBottom:'16px'}}>
            <div className="card-title"><span className="icon">📋</span> Leaderboard & Log Display Range</div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:'14px'}}>Control what time period the leaderboard totals and activity log show.</p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Leaderboard Range</label>
                <select className="form-select" value={settings.leaderboard_range||'all_time'} onChange={e=>setSettings(s=>({...s,leaderboard_range:e.target.value}))}>
                  {LEADERBOARD_RANGE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {settings.leaderboard_range==='custom'&&(
                <>
                  <div className="form-group"><label className="form-label">From</label><input type="date" className="form-input" value={settings.leaderboard_range_from||''} onChange={e=>setSettings(s=>({...s,leaderboard_range_from:e.target.value}))} /></div>
                  <div className="form-group"><label className="form-label">To</label><input type="date" className="form-input" value={settings.leaderboard_range_to||''} onChange={e=>setSettings(s=>({...s,leaderboard_range_to:e.target.value}))} /></div>
                </>
              )}
              <div className="form-group">
                <label className="form-label">Activity Log Range</label>
                <select className="form-select" value={settings.log_range||'all_time'} onChange={e=>setSettings(s=>({...s,log_range:e.target.value}))}>
                  {LEADERBOARD_RANGE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {settings.log_range!=='all_time'&&settings.log_range!=='custom'&&(
                <div className="form-group">
                  <label className="form-label">Log Days (override)</label>
                  <input type="number" className="form-input" min="1" max="365" value={settings.log_range_days||14} onChange={e=>setSettings(s=>({...s,log_range_days:e.target.value}))} />
                </div>
              )}
            </div>
            <button className="btn btn-gold btn-sm" onClick={saveSettings} disabled={loading}>{loading?'Saving...':'💾 Save Range Settings'}</button>
          </div>

          <div className="card" style={{marginBottom:'16px'}}>
            <div className="card-title"><span className="icon">⏰</span> Reminder Settings</div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:'14px'}}>
              Up to 3 reminders sent before spark allowance expires (after go-live date). Note: daily frequency reminders under 24h are ignored.
            </p>
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'12px'}}>
              {reminderOffsets.map((val,i) => (
                <div key={i} className="form-group" style={{marginBottom:0,minWidth:'140px'}}>
                  <label className="form-label">Reminder {i+1} (hours before)</label>
                  <select className="form-select" value={val} onChange={e=>{const n=[...reminderOffsets];n[i]=e.target.value;setReminderOffsets(n)}}>
                    <option value="">Disabled</option>
                    {REMINDER_PRESETS.map(h=><option key={h} value={h}>{h}h before</option>)}
                  </select>
                </div>
              ))}
            </div>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'0.85rem',marginBottom:'12px'}}>
              <input type="checkbox" checked={settings.reminder_enabled==='true'} onChange={e=>setSettings(s=>({...s,reminder_enabled:e.target.checked?'true':'false'}))} style={{accentColor:'var(--gold)'}} />
              Enable Reminders (only active after go-live date)
            </label>
            <button className="btn btn-gold btn-sm" onClick={saveSettings} disabled={loading}>{loading?'Saving...':'💾 Save Reminder Settings'}</button>
          </div>

          <div className="card">
            <div className="card-title"><span className="icon">🧪</span> Test Notifications</div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:'14px'}}>Send a test email or SMS to any employee. Works even before go-live date.</p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Employee</label>
                <select className="form-select" value={testEmpId} onChange={e=>setTestEmpId(e.target.value)}>
                  <option value="">Select employee...</option>
                  {employees.map(e=><option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Channel</label>
                <select className="form-select" value={testChannel} onChange={e=>setTestChannel(e.target.value)}>
                  <option value="email">📧 Email only</option>
                  <option value="sms">📱 SMS only</option>
                  <option value="both">📧 + 📱 Both</option>
                </select>
              </div>
            </div>
            <button className="btn btn-gold btn-sm" onClick={handleTestNotif} disabled={testLoading||!testEmpId}>
              {testLoading?'Sending...':'🧪 Send Test'}
            </button>
          </div>
        </div>
      )}

      {/* REPORTS */}
      {tab==='reports'&&(
        <div>
          <div className="card" style={{marginBottom:'16px'}}>
            <div className="card-title"><span className="icon">📊</span> Report Filters</div>
            <div style={{display:'flex',gap:'12px',alignItems:'flex-end',flexWrap:'wrap'}}>
              <div className="form-group" style={{marginBottom:0}}><label className="form-label">From</label><input type="date" className="form-input" style={{width:'auto'}} value={reportFrom} onChange={e=>setReportFrom(e.target.value)} /></div>
              <div className="form-group" style={{marginBottom:0}}><label className="form-label">To</label><input type="date" className="form-input" style={{width:'auto'}} value={reportTo} onChange={e=>setReportTo(e.target.value)} /></div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">Type</label>
                <select className="form-select" style={{minWidth:'160px'}} value={reportTypeFilter} onChange={e=>setReportTypeFilter(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="assign">Peer Sparks</option>
                  <option value="admin_adjust">Admin Adjustments</option>
                  <option value="cashout">Cash Outs</option>
                </select>
              </div>
              <button className="btn btn-gold btn-sm" onClick={runReport} disabled={reportLoading}>📊 Run Report</button>
              <button className="btn btn-outline btn-sm" onClick={runUnusedReport} disabled={reportLoading}>🔍 Unused Sparks</button>
            </div>
          </div>
          {(reportData||unusedData)&&(
            <div style={{display:'flex',gap:'10px',marginBottom:'16px',flexWrap:'wrap'}}>
              <button className="btn btn-outline btn-sm" onClick={exportCSV}>⬇️ CSV</button>
              <button className="btn btn-outline btn-sm" onClick={exportPDF}>🖨️ PDF</button>
            </div>
          )}
          <div ref={reportRef}>
            {unusedData&&(
              <div className="card" style={{marginBottom:'16px'}}>
                <div className="card-title"><span className="icon">🔍</span> Unused Sparks — {unusedData.reportDate}</div>
                <p style={{fontSize:'0.82rem',color:'var(--white-dim)',marginBottom:'12px'}}>Non-management employees with unused giving allowance.</p>
                <div className="stat-grid" style={{marginBottom:'16px'}}>
                  <div className="stat-card"><div className="stat-value" style={{color:'var(--red)'}}>{unusedData.totalUnused}</div><div className="stat-label">Total Unused</div></div>
                  <div className="stat-card"><div className="stat-value">{unusedData.employees.length}</div><div className="stat-label">Employees w/ Unused</div></div>
                </div>
                {unusedData.employees.length>0?(
                  <div className="table-wrap">
                    <table><thead><tr><th>Employee</th><th>Title</th><th>Grade</th><th>Unused</th><th>Accrual</th></tr></thead>
                      <tbody>{unusedData.employees.map(e=>(
                        <tr key={e.id}><td style={{fontWeight:600}}>{e.first_name} {e.last_name}</td><td style={{fontSize:'0.82rem'}}>{e.job_title||'—'}</td>
                          <td><span style={{fontSize:'0.72rem',padding:'2px 5px',background:'rgba(240,192,64,0.1)',borderRadius:'4px',color:'var(--gold)'}}>{e.job_grade||'—'}</span></td>
                          <td><span style={{color:'var(--red)',fontWeight:700}}>🔥 {e.daily_sparks_remaining||0}</span></td>
                          <td style={{color:'var(--white-dim)'}}>{e.daily_accrual||0}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ):<div className="empty-state"><p>All employees have used their sparks! 🎉</p></div>}
              </div>
            )}
            {reportData&&(
              <div className="card">
                <div className="card-title"><span className="icon">📊</span> Activity — {reportFrom} to {reportTo}</div>
                <div className="stat-grid" style={{marginBottom:'16px'}}>
                  <div className="stat-card"><div className="stat-value">{reportData.totalAssigned}</div><div className="stat-label">Assigned</div></div>
                  <div className="stat-card"><div className="stat-value" style={{color:'var(--green-bright)'}}>{reportData.totalCashedOut}</div><div className="stat-label">Cashed Out</div></div>
                  <div className="stat-card"><div className="stat-value">{reportData.totalInSystem}</div><div className="stat-label">In System</div></div>
                  <div className="stat-card"><div className="stat-value">{reportData.txns.length+reportData.cashouts.length}</div><div className="stat-label">Transactions</div></div>
                </div>
                {reportData.cashouts.length>0&&(
                  <div style={{marginBottom:'16px'}}>
                    <div style={{fontFamily:'var(--font-display)',fontSize:'0.78rem',color:'var(--green-bright)',letterSpacing:'0.08em',marginBottom:'8px'}}>💰 CASH OUTS</div>
                    <div className="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Sparks</th><th>Value</th><th>Note</th><th>Admin</th></tr></thead>
                      <tbody>{reportData.cashouts.map(co=>(
                        <tr key={co.id}><td style={{fontSize:'0.78rem',whiteSpace:'nowrap'}}>{new Date(co.cashed_out_at).toLocaleDateString()}</td>
                          <td style={{fontWeight:600}}>{co.employee?.first_name} {co.employee?.last_name}</td>
                          <td><span className="spark-badge" style={{color:'var(--green-bright)',borderColor:'rgba(94,232,138,0.4)'}}>✨ {co.sparks_redeemed}</span></td>
                          <td style={{fontSize:'0.82rem'}}>{co.redemption_value||'—'}</td>
                          <td style={{fontSize:'0.78rem',color:'var(--white-dim)'}}>{co.note||'—'}</td>
                          <td style={{fontSize:'0.78rem',color:'var(--white-dim)'}}>{co.admin?.first_name} {co.admin?.last_name}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  </div>
                )}
                {reportData.txns.length>0&&(
                  <div className="table-wrap"><table><thead><tr><th>Date</th><th>From</th><th>To</th><th>Amt</th><th>Type</th><th>Reason</th><th>Status</th></tr></thead>
                    <tbody>{reportData.txns.map(txn=>{
                      const ti=TYPE_LABELS[txn.transaction_type]||{label:txn.transaction_type,color:'gold'}
                      return (<tr key={txn.id}>
                        <td style={{fontSize:'0.78rem',whiteSpace:'nowrap'}}>{new Date(txn.created_at).toLocaleDateString()}</td>
                        <td style={{fontSize:'0.8rem'}}>{txn.from_emp?`${txn.from_emp.first_name} ${txn.from_emp.last_name}`:'—'}</td>
                        <td style={{fontSize:'0.8rem'}}>{txn.to_emp?`${txn.to_emp.first_name} ${txn.to_emp.last_name}`:'—'}</td>
                        <td><span className="spark-badge" style={txn.amount<0?{color:'var(--red)',borderColor:'rgba(224,85,85,0.4)'}:{}}>{txn.amount>0?'✨':'💸'} {Math.abs(txn.amount)}</span></td>
                        <td><span className={`chip chip-${ti.color}`}>{ti.label}</span></td>
                        <td style={{fontSize:'0.75rem',color:'var(--white-dim)',maxWidth:'140px'}}>{txn.reason||txn.note||<span style={{opacity:0.3}}>—</span>}</td>
                        <td><span className={`chip chip-${txn.vested?'green':'gold'}`}>{txn.vested?'Vested':'Pending'}</span></td>
                      </tr>)
                    })}</tbody>
                  </table></div>
                )}
                {reportData.txns.length===0&&reportData.cashouts.length===0&&<div className="empty-state"><p>No transactions in this range</p></div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editEmp&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditEmp(null)}>
          <div className="modal" style={{maxWidth:'600px'}}>
            <div className="modal-title">✏️ Edit: {editEmp.first_name} {editEmp.last_name}</div>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">First Name</label><input className="form-input" value={editValues.first_name||''} onChange={e=>setEditValues(v=>({...v,first_name:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Last Name</label><input className="form-input" value={editValues.last_name||''} onChange={e=>setEditValues(v=>({...v,last_name:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={editValues.email||''} onChange={e=>setEditValues(v=>({...v,email:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={editValues.phone||''} onChange={e=>setEditValues(v=>({...v,phone:e.target.value}))} /></div>
              <div className="form-group">
                <label className="form-label">Cell Carrier</label>
                <select className="form-select" value={editValues.carrier||''} onChange={e=>setEditValues(v=>({...v,carrier:e.target.value}))}>
                  {CARRIERS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Job Grade</label>
                <select className="form-select" value={editValues.job_grade||''} onChange={e=>setEditValues(v=>({...v,job_grade:e.target.value,is_management:MANAGEMENT_GRADES.includes(e.target.value)}))}>
                  {JOB_GRADES.map(g=><option key={g} value={g}>{g||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Job Title</label>
                <select className="form-select" value={editValues.job_title||''} onChange={e=>setEditValues(v=>({...v,job_title:e.target.value}))}>
                  {JOB_TITLES.map(t=><option key={t} value={t}>{t||'— Select —'}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Vested ✨</label><input className="form-input" type="number" min="0" value={editValues.vested_sparks||0} onChange={e=>setEditValues(v=>({...v,vested_sparks:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Unvested ⏳</label><input className="form-input" type="number" min="0" value={editValues.unvested_sparks||0} onChange={e=>setEditValues(v=>({...v,unvested_sparks:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">{freqLabel} Accrual</label><input className="form-input" type="number" min="0" value={editValues.daily_accrual||0} onChange={e=>setEditValues(v=>({...v,daily_accrual:e.target.value}))} /></div>
            </div>
            <div style={{display:'flex',gap:'14px',flexWrap:'wrap',marginBottom:'14px'}}>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={editValues.is_management||false} onChange={e=>setEditValues(v=>({...v,is_management:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> Management</label>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={editValues.has_spark_list||false} onChange={e=>setEditValues(v=>({...v,has_spark_list:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> Spark List</label>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={editValues.notify_email!==false} onChange={e=>setEditValues(v=>({...v,notify_email:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> 📧 Email</label>
              <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.85rem'}}><input type="checkbox" checked={editValues.notify_sms||false} onChange={e=>setEditValues(v=>({...v,notify_sms:e.target.checked}))} style={{accentColor:'var(--gold)'}} /> 📱 SMS</label>
            </div>
            <div style={{display:'flex',gap:'10px'}}>
              <button className="btn btn-gold" onClick={saveEdit} disabled={loading}>{loading?'Saving...':'💾 Save'}</button>
              <button className="btn btn-outline" onClick={()=>setEditEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* CASHOUT MODAL */}
      {cashoutEmp&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setCashoutEmp(null)}>
          <div className="modal">
            <div className="modal-title">💰 Cash Out — {cashoutEmp.first_name} {cashoutEmp.last_name}</div>
            <div className="stat-grid" style={{marginBottom:'16px',gridTemplateColumns:'repeat(4,1fr)'}}>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.3rem'}}>{cashoutEmp.vested_sparks||0}</div><div className="stat-label">Vested</div></div>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.3rem',color:'var(--white-dim)'}}>{cashoutEmp.unvested_sparks||0}</div><div className="stat-label">Unvested</div></div>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.3rem',color:'var(--green-bright)'}}>{cashoutEmp.redeemed_sparks||0}</div><div className="stat-label">Redeemed</div></div>
              <div className="stat-card"><div className="stat-value" style={{fontSize:'1.3rem',color:'var(--gold)'}}>{(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)+(cashoutEmp.redeemed_sparks||0)}</div><div className="stat-label">Total Ever</div></div>
            </div>
            <div className="alert alert-warning" style={{marginBottom:'12px'}}>Deducts from vested first, then unvested. Redeemed total counts toward leaderboard.</div>
            <div className="form-group"><label className="form-label">Sparks to Redeem *</label><input className="form-input" type="number" min="1" max={(cashoutEmp.vested_sparks||0)+(cashoutEmp.unvested_sparks||0)} value={cashoutSparks} onChange={e=>setCashoutSparks(e.target.value)} placeholder="Number of sparks..." /></div>
            <div className="form-group"><label className="form-label">Redemption Value / Gift</label><input className="form-input" value={cashoutValue} onChange={e=>setCashoutValue(e.target.value)} placeholder='"$50 gift card", "Cash $25"' /></div>
            <div className="form-group"><label className="form-label">Note</label><input className="form-input" value={cashoutNote} onChange={e=>setCashoutNote(e.target.value)} /></div>
            <div style={{display:'flex',gap:'10px'}}>
              <button className="btn btn-sm" style={{background:'var(--green-bright)',color:'#000',fontFamily:'var(--font-display)',fontSize:'0.72rem',letterSpacing:'0.1em'}} onClick={processCashout} disabled={loading||!cashoutSparks}>{loading?'Processing...':'💰 Process Cash Out'}</button>
              <button className="btn btn-outline" onClick={()=>setCashoutEmp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
