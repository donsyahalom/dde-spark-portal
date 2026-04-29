import { useState, useEffect, useCallback } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { supabase } from '../../lib/supabase'

const ALL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pnl',      label: 'Company P&L' },
  { id: 'jobs',     label: 'Jobs P&L' },
  { id: 'cashflow', label: 'Cashflow' },
  { id: 'ar',       label: 'A/R' },
  { id: 'ap',       label: 'A/P' },
  { id: 'payroll',  label: 'Payroll' },
  { id: 'kpis',     label: 'KPIs' },
  { id: 'perms',    label: 'Permissions' },
]

const ALL_FIELDS = [
  { id: 'revenue_dollar',     label: 'Revenue $' },
  { id: 'gp_dollar',          label: 'GP $' },
  { id: 'gp_percent',         label: 'GP %' },
  { id: 'direct_cost',        label: 'Direct Cost $' },
  { id: 'contract_amount',    label: 'Contract amount' },
  { id: 'bank_balance',       label: 'Bank balances' },
  { id: 'overhead_net',       label: 'Overhead + Net Profit' },
  { id: 'cost_buckets',       label: 'Cost bucket split' },
  { id: 'labor_hours',        label: 'Labor hours' },
  { id: 'productivity',       label: 'Productivity / earned-value' },
  { id: 'rev_per_field_hr',   label: 'Revenue per field hour' },
  { id: 'retainage_held',     label: 'Retainage held' },
  { id: 'retainage_due',      label: 'Retainage due schedule' },
  { id: 'aging_90',           label: '90+ aging' },
  { id: 'ar_email',           label: 'Weekly A/R email settings' },
  { id: 'po_list',            label: 'PO list' },
  { id: 'po_outstanding',     label: 'PO outstanding $' },
  { id: 'work_orders',        label: 'Service work-orders' },
  { id: 'payroll_detail',     label: 'Payroll register detail' },
  { id: 'payroll_rates',      label: 'Employee pay rates' },
  { id: 'kpi_values',         label: 'KPI values' },
]

export default function OpsPermissionsPage() {
  const [employees, setEmployees] = useState([])
  const [execUsers, setExecUsers] = useState([])
  const [permMap, setPermMap] = useState({})
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showAddPicker, setShowAddPicker] = useState(false)
  const [addSearch, setAddSearch] = useState('')

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: perms }] = await Promise.all([
      supabase.from('employees').select('id,first_name,last_name,email,job_grade,has_executive_dashboard').eq('is_admin', false).order('last_name'),
      supabase.from('ops_permissions').select('*').catch(() => ({ data: [] })),
    ])
    const allEmps = emps || []
    setEmployees(allEmps)
    const withDash = allEmps.filter(e => e.has_executive_dashboard)
    setExecUsers(withDash)

    const map = {}
    ;(perms || []).forEach(p => {
      map[p.employee_id] = {
        role: p.role || 'viewer',
        pcs: p.pcs || [],
        hiddenTabs: p.hidden_tabs || ALL_TABS.map(t => t.id),
        hiddenFields: p.hidden_fields || ALL_FIELDS.map(f => f.id),
        jobAccess: p.job_access || 'assigned',
        jobAccessList: p.job_access_list || [],
      }
    })
    setPermMap(map)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const currentPerms = permMap[selected] || {
    role: 'viewer', pcs: [],
    hiddenTabs: ALL_TABS.map(t => t.id),
    hiddenFields: ALL_FIELDS.map(f => f.id),
    jobAccess: 'assigned', jobAccessList: [],
  }

  const update = (patch) =>
    setPermMap(prev => ({ ...prev, [selected]: { ...(prev[selected] || {}), ...patch } }))

  const toggleTab = (tabId) => {
    const hidden = (currentPerms.hiddenTabs || []).includes(tabId)
    update({ hiddenTabs: hidden
      ? (currentPerms.hiddenTabs || []).filter(t => t !== tabId)
      : [...(currentPerms.hiddenTabs || []), tabId] })
  }
  const toggleField = (fid) => {
    const hidden = (currentPerms.hiddenFields || []).includes(fid)
    update({ hiddenFields: hidden
      ? (currentPerms.hiddenFields || []).filter(f => f !== fid)
      : [...(currentPerms.hiddenFields || []), fid] })
  }

  const savePerms = async () => {
    if (!selected) return
    setSaving(true)
    const { error } = await supabase.from('ops_permissions').upsert({
      employee_id: selected,
      role: currentPerms.role || 'viewer',
      pcs: currentPerms.pcs || [],
      hidden_tabs: currentPerms.hiddenTabs || [],
      hidden_fields: currentPerms.hiddenFields || [],
      job_access: currentPerms.jobAccess || 'assigned',
      job_access_list: currentPerms.jobAccessList || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' })
    setSaving(false)
    if (error) showMsg('Save failed: ' + error.message, 'error')
    else { showMsg('Permissions saved'); fetchAll() }
  }

  const addEmployee = async (empId) => {
    setSaving(true)
    await supabase.from('employees').update({ has_executive_dashboard: true }).eq('id', empId)
    await supabase.from('ops_permissions').upsert({
      employee_id: empId, role: 'viewer', pcs: [],
      hidden_tabs: ALL_TABS.map(t => t.id),
      hidden_fields: ALL_FIELDS.map(f => f.id),
      job_access: 'assigned', job_access_list: [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' }).catch(() => {})
    setSaving(false)
    setShowAddPicker(false); setAddSearch('')
    setSelected(empId)
    showMsg('Access granted. Set their permissions below.')
    fetchAll()
  }

  const removeEmployee = async (empId) => {
    const emp = execUsers.find(e => e.id === empId)
    if (!window.confirm(`Remove Executive Dashboard access for ${emp?.first_name} ${emp?.last_name}?`)) return
    await supabase.from('employees').update({ has_executive_dashboard: false }).eq('id', empId)
    await supabase.from('ops_permissions').delete().eq('employee_id', empId).catch(() => {})
    if (selected === empId) setSelected(execUsers.filter(e => e.id !== empId)[0]?.id || '')
    showMsg('Access removed'); fetchAll()
  }

  const eligibleToAdd = employees.filter(e =>
    !e.has_executive_dashboard &&
    `${e.first_name} ${e.last_name} ${e.job_grade || ''}`.toLowerCase().includes(addSearch.toLowerCase())
  )

  const selectedEmp = execUsers.find(e => e.id === selected)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
      {/* ── User list ── */}
      <div className="ops-userlist">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-bright)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)' }}>Exec Dashboard</div>
            <div className="ops-small ops-text-dim">{execUsers.length} user{execUsers.length !== 1 ? 's' : ''}</div>
          </div>
          <button className="ops-btn ghost" style={{ fontSize: '0.75rem' }} onClick={() => setShowAddPicker(v => !v)}>
            {showAddPicker ? '✕ Cancel' : '+ Add'}
          </button>
        </div>

        {showAddPicker && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-bright)', background: 'rgba(240,192,64,0.06)' }}>
            <input className="ops-input" style={{ width: '100%', marginBottom: 8 }}
              placeholder="Search employees…" value={addSearch}
              onChange={e => setAddSearch(e.target.value)} autoFocus />
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {eligibleToAdd.slice(0, 20).map(emp => (
                <button key={emp.id} className="ops-btn ghost" disabled={saving}
                  style={{ textAlign: 'left', padding: '6px 8px', fontSize: '0.8rem', justifyContent: 'flex-start' }}
                  onClick={() => addEmployee(emp.id)}>
                  <strong>{emp.first_name} {emp.last_name}</strong>
                  {emp.job_grade && <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: '0.72rem' }}>{emp.job_grade}</span>}
                </button>
              ))}
              {eligibleToAdd.length === 0 && <div className="ops-small ops-text-dim" style={{ padding: '6px 0' }}>No matches</div>}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: '0.82rem' }}>Loading…</div>
        ) : execUsers.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: '0.82rem' }}>No users yet. Click + Add.</div>
        ) : execUsers.map(u => (
          <button key={u.id} onClick={() => setSelected(u.id)} className={selected === u.id ? 'active' : ''}
            style={{ width: '100%', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="name">{u.first_name} {u.last_name}</div>
                <div className="meta ops-text-dim">{u.email}</div>
                <div className="meta" style={{ color: 'var(--gold-dark)', marginTop: 2 }}>{permMap[u.id]?.role || 'viewer'}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); removeEmployee(u.id) }}
                style={{ background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.2)',fontSize:'1.1rem',lineHeight:1,padding:'0 2px',marginTop:'-2px' }}
                onMouseEnter={e => e.target.style.color='#E05555'} onMouseLeave={e => e.target.style.color='rgba(255,255,255,0.2)'}>×</button>
            </div>
          </button>
        ))}
      </div>

      {/* ── Permissions panel ── */}
      <div>
        {msg && (
          <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem',
            background: msg.type === 'error' ? 'rgba(224,85,85,0.12)' : 'rgba(94,232,138,0.1)',
            border: `1px solid ${msg.type === 'error' ? 'rgba(224,85,85,0.4)' : 'rgba(94,232,138,0.3)'}`,
            color: msg.type === 'error' ? '#ff8a8a' : 'var(--green-bright)' }}>
            {msg.text}
          </div>
        )}

        {selectedEmp ? (
          <>
            <OpsSectionCard title={`${selectedEmp.first_name} ${selectedEmp.last_name}`}
              subtitle={`${selectedEmp.email}${selectedEmp.job_grade ? ` · ${selectedEmp.job_grade}` : ''}`}
              right={
                <select className="ops-select" value={currentPerms.role || 'viewer'} onChange={e => update({ role: e.target.value })}>
                  {['admin','owner','manager','pm','finance','accountant','payroll','foreman','viewer'].map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>
                  ))}
                </select>
              }>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(240,192,64,0.07)', border: '1px solid rgba(240,192,64,0.2)', fontSize: '0.8rem', color: 'var(--white-dim)', marginBottom: 12 }}>
                All permissions are <strong style={{ color: 'var(--white-soft)' }}>denied by default</strong>. Check boxes below to grant access.
              </div>
              <div className="ops-stat-lbl" style={{ marginBottom: 8 }}>Profit-center scoping</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['DDE','DCM','SILK'].map(pc => (
                  <label key={pc} className="ops-checkbox">
                    <input type="checkbox" checked={(currentPerms.pcs || []).includes(pc)}
                      onChange={() => { const on = (currentPerms.pcs||[]).includes(pc); update({ pcs: on?(currentPerms.pcs||[]).filter(p=>p!==pc):[...(currentPerms.pcs||[]),pc] }) }} />
                    {pc}
                  </label>
                ))}
              </div>
            </OpsSectionCard>

            <OpsSectionCard title="Tab access" subtitle="Check to GRANT access. All tabs are hidden by default.">
              <div className="ops-grid-4">
                {ALL_TABS.map(t => (
                  <label key={t.id} className="ops-checkbox">
                    <input type="checkbox" checked={!(currentPerms.hiddenTabs||ALL_TABS.map(x=>x.id)).includes(t.id)} onChange={() => toggleTab(t.id)} />
                    {t.label}
                  </label>
                ))}
              </div>
            </OpsSectionCard>

            <OpsSectionCard title="Field visibility" subtitle="Check to SHOW each data field. All are hidden by default.">
              <div className="ops-grid-2">
                {ALL_FIELDS.map(f => (
                  <label key={f.id} className="ops-checkbox">
                    <input type="checkbox" checked={!(currentPerms.hiddenFields||ALL_FIELDS.map(x=>x.id)).includes(f.id)} onChange={() => toggleField(f.id)} />
                    {f.label}
                  </label>
                ))}
              </div>
            </OpsSectionCard>

            <OpsSectionCard title="Job-level access">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'all',       label: 'All jobs in their profit centers' },
                  { id: 'assigned',  label: "Only jobs where they're listed as PM/lead" },
                  { id: 'whitelist', label: 'Whitelist specific jobs' },
                  { id: 'blacklist', label: 'All jobs except a blacklist' },
                ].map(o => (
                  <label key={o.id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                    <input type="radio" name="jobAccess" checked={(currentPerms.jobAccess||'assigned')===o.id} onChange={() => update({ jobAccess: o.id })} />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
              {(currentPerms.jobAccess==='whitelist'||currentPerms.jobAccess==='blacklist') && (
                <input className="ops-input" value={(currentPerms.jobAccessList||[]).join(', ')}
                  onChange={e => update({ jobAccessList: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) })}
                  placeholder="Job numbers, comma-separated" style={{ marginTop:12, width:'100%' }} />
              )}
            </OpsSectionCard>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => fetchAll()}>Discard</button>
              <button className="btn btn-gold btn-sm" onClick={savePerms} disabled={saving}>{saving?'Saving…':'Save changes'}</button>
            </div>
          </>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
            {execUsers.length === 0 ? 'Use + Add to grant an employee Executive Dashboard access.' : 'Select a user.'}
          </div>
        )}
      </div>
    </div>
  )
}
