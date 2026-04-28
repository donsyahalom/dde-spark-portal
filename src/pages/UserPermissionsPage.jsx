import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Screens and their controllable details ────────────────────────────────────
const SCREENS = [
  {
    id: 'leaderboard',
    label: '🏆 Leaderboard',
    desc: 'Public spark leaderboard and activity log.',
    details: [
      { id: 'show_dollar_value',  label: 'Show dollar value of sparks' },
      { id: 'show_job_grade',     label: 'Show job grade badges' },
      { id: 'show_spark_log',     label: 'Show activity log (feed)' },
      { id: 'show_like_button',   label: 'Allow liking sparks' },
    ],
  },
  {
    id: 'my_sparks',
    label: '✨ My Sparks',
    desc: 'Spark sending, balance, and history for the employee.',
    details: [
      { id: 'show_balance',       label: 'Show remaining spark balance' },
      { id: 'show_history',       label: 'Show sent/received history' },
      { id: 'can_send_sparks',    label: 'Allow sending sparks' },
    ],
  },
  {
    id: 'compensation',
    label: '💵 My Pay',
    desc: 'Compensation, wage, range, and bonus information.',
    details: [
      { id: 'show_wage',          label: 'Show own wage / salary' },
      { id: 'show_range',         label: 'Show grade pay range' },
      { id: 'show_target_bonus',  label: 'Show target bonus %' },
      { id: 'show_bonus_share',   label: 'Show bonus share %' },
    ],
  },
  {
    id: 'performance',
    label: '📋 Evals',
    desc: 'Performance evaluations — trigger and view results.',
    details: [
      { id: 'can_trigger_eval',   label: 'Can trigger evaluations' },
      { id: 'can_view_results',   label: 'Can view evaluation results' },
    ],
  },
  {
    id: 'board',
    label: '📌 Message Board',
    desc: 'Company announcements and document library.',
    details: [
      { id: 'show_board',         label: 'Show message board posts' },
      { id: 'show_docs',          label: 'Show documents library' },
    ],
  },
  {
    id: 'dashboard',
    label: '📊 Dashboard',
    desc: 'Team spark analytics dashboard.',
    details: [
      { id: 'show_utilization',   label: 'Show utilization %' },
      { id: 'show_top_givers',    label: 'Show top givers/receivers' },
      { id: 'show_charts',        label: 'Show charts' },
    ],
  },
]

const EMPTY_PERMS = () => {
  const p = { screens: {} }
  SCREENS.forEach(s => {
    p.screens[s.id] = { visible: true, details: {} }
    s.details.forEach(d => { p.screens[s.id].details[d.id] = true })
  })
  return p
}

export default function UserPermissionsPage() {
  const [employees, setEmployees] = useState([])
  const [permMap, setPermMap]     = useState({})   // { empId: perms }
  const [selected, setSelected]   = useState('')
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null)
  const [dirty, setDirty]         = useState(false)

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: rows }] = await Promise.all([
      supabase.from('employees').select('id,first_name,last_name,email,job_grade,job_title,is_archived')
        .eq('is_admin', false).eq('is_archived', false).order('last_name'),
      supabase.from('user_permissions').select('*'),
    ])
    setEmployees(emps || [])
    const map = {}
    ;(rows || []).forEach(r => {
      try { map[r.employee_id] = JSON.parse(r.permissions) } catch { map[r.employee_id] = EMPTY_PERMS() }
    })
    if (!map[(emps||[])[0]?.id]) {
      // seed defaults for any missing employees on first load
      ;(emps || []).forEach(e => { if (!map[e.id]) map[e.id] = EMPTY_PERMS() })
    }
    setPermMap(map)
    if (!selected && (emps || []).length > 0) setSelected(emps[0].id)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const perms = permMap[selected] || EMPTY_PERMS()

  const update = (patch) => {
    setPermMap(prev => ({ ...prev, [selected]: patch }))
    setDirty(true)
  }

  const toggleScreen = (screenId) => {
    const cur = { ...perms }
    cur.screens = { ...cur.screens }
    cur.screens[screenId] = { ...cur.screens[screenId], visible: !cur.screens[screenId]?.visible }
    update(cur)
  }

  const toggleDetail = (screenId, detailId) => {
    const cur = JSON.parse(JSON.stringify(perms))
    cur.screens[screenId].details[detailId] = !cur.screens[screenId].details[detailId]
    update(cur)
  }

  const setAllScreens = (value) => {
    const cur = JSON.parse(JSON.stringify(perms))
    SCREENS.forEach(s => {
      cur.screens[s.id].visible = value
      s.details.forEach(d => { cur.screens[s.id].details[d.id] = value })
    })
    update(cur)
  }

  const copyFromEmployee = async (fromEmpId) => {
    const src = permMap[fromEmpId]
    if (!src) return
    update(JSON.parse(JSON.stringify(src)))
    showMsg('Permissions copied — remember to save.')
  }

  const savePerms = async () => {
    if (!selected) return
    setSaving(true)
    const { error } = await supabase.from('user_permissions').upsert({
      employee_id: selected,
      permissions: JSON.stringify(perms),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' })
    setSaving(false)
    if (error) showMsg('Save failed: ' + error.message, 'error')
    else { showMsg('Permissions saved'); setDirty(false) }
  }

  const resetToDefaults = () => {
    update(EMPTY_PERMS())
    showMsg('Reset to defaults — remember to save.')
  }

  const selectedEmp = employees.find(e => e.id === selected)
  const filteredEmps = employees.filter(e =>
    `${e.first_name} ${e.last_name} ${e.job_grade || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const screenVisible = (sid) => perms.screens?.[sid]?.visible !== false
  const detailOn = (sid, did) => perms.screens?.[sid]?.details?.[did] !== false

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, minHeight: '60vh' }}>

      {/* ── Employee list ── */}
      <div style={{ background: 'var(--bg-darker)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)', marginBottom: 8 }}>Employee Permissions</div>
          <input className="form-input" style={{ width: '100%', fontSize: '0.82rem' }}
            placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--white-dim)', fontSize: '0.82rem' }}>Loading…</div>
          ) : filteredEmps.map(emp => (
            <button key={emp.id} onClick={() => { setSelected(emp.id); setDirty(false) }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none',
                border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                borderLeft: `3px solid ${selected === emp.id ? 'var(--gold)' : 'transparent'}`,
                background: selected === emp.id ? 'rgba(240,192,64,0.07)' : 'transparent',
              }}>
              <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--white-soft)' }}>
                {emp.first_name} {emp.last_name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)', marginTop: 2 }}>
                {emp.job_grade && <span style={{ color: 'var(--gold-dark)', marginRight: 6 }}>{emp.job_grade}</span>}
                {emp.job_title || emp.email}
              </div>
            </button>
          ))}
          {filteredEmps.length === 0 && !loading && (
            <div style={{ padding: 20, color: 'var(--white-dim)', fontSize: '0.82rem' }}>No employees found.</div>
          )}
        </div>
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
            {/* ── Header ── */}
            <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--white-soft)' }}>
                    {selectedEmp.first_name} {selectedEmp.last_name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--white-dim)', marginTop: 3 }}>
                    {selectedEmp.email}
                    {selectedEmp.job_grade && <span style={{ marginLeft: 8, color: 'var(--gold)' }}>{selectedEmp.job_grade}</span>}
                    {selectedEmp.job_title && <span style={{ marginLeft: 6, color: 'var(--white-dim)' }}>· {selectedEmp.job_title}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Copy from another employee */}
                  <select className="form-select" style={{ fontSize: '0.78rem', padding: '5px 10px', maxWidth: 180 }}
                    value="" onChange={e => { if (e.target.value) copyFromEmployee(e.target.value) }}>
                    <option value="">Copy from…</option>
                    {employees.filter(e => e.id !== selected).map(e => (
                      <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                    ))}
                  </select>
                  <button className="btn btn-outline btn-sm" onClick={resetToDefaults}>Reset to defaults</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setAllScreens(false)}
                    style={{ color: '#ff8a8a', borderColor: 'rgba(224,85,85,0.4)' }}>Revoke all</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setAllScreens(true)}>Grant all</button>
                  <button className="btn btn-gold btn-sm" onClick={savePerms} disabled={saving}>
                    {saving ? 'Saving…' : dirty ? '💾 Save*' : '💾 Saved'}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Screen permissions ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SCREENS.map(screen => {
                const on = screenVisible(screen.id)
                return (
                  <div key={screen.id} className="card" style={{
                    padding: '14px 18px',
                    borderLeft: `3px solid ${on ? 'var(--gold)' : 'rgba(224,85,85,0.5)'}`,
                    opacity: on ? 1 : 0.7,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: on && screen.details.length ? 12 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Toggle */}
                        <button onClick={() => toggleScreen(screen.id)}
                          style={{
                            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                            background: on ? 'var(--gold)' : 'rgba(255,255,255,0.15)',
                            position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                          }}>
                          <span style={{
                            position: 'absolute', top: 3, left: on ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%',
                            background: on ? '#112e1c' : 'rgba(255,255,255,0.6)',
                            transition: 'left 0.2s',
                          }} />
                        </button>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.92rem', color: on ? 'var(--white-soft)' : 'var(--white-dim)' }}>
                            {screen.label}
                          </div>
                          <div style={{ fontSize: '0.73rem', color: 'var(--white-dim)', marginTop: 1 }}>{screen.desc}</div>
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
                        background: on ? 'rgba(94,232,138,0.1)' : 'rgba(224,85,85,0.1)',
                        color: on ? 'var(--green-bright)' : '#ff8a8a',
                        border: `1px solid ${on ? 'rgba(94,232,138,0.3)' : 'rgba(224,85,85,0.3)'}`,
                        fontWeight: 600,
                      }}>{on ? 'Visible' : 'Hidden'}</span>
                    </div>

                    {/* Detail toggles — only shown when screen is on */}
                    {on && screen.details.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {screen.details.map(detail => {
                          const active = detailOn(screen.id, detail.id)
                          return (
                            <label key={detail.id} onClick={() => toggleDetail(screen.id, detail.id)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                padding: '5px 10px', borderRadius: 6, fontSize: '0.78rem',
                                background: active ? 'rgba(240,192,64,0.1)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${active ? 'rgba(240,192,64,0.35)' : 'rgba(255,255,255,0.1)'}`,
                                color: active ? 'var(--white-soft)' : 'var(--white-dim)',
                                userSelect: 'none',
                              }}>
                              <input type="checkbox" checked={active} onChange={() => {}}
                                style={{ accentColor: 'var(--gold)', pointerEvents: 'none' }} />
                              {detail.label}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-gold" onClick={savePerms} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save permissions'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--white-dim)' }}>
            Select an employee to manage their permissions.
          </div>
        )}
      </div>
    </div>
  )
}
