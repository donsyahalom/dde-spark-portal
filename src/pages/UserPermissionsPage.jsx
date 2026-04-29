import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Screen + detail definitions with tooltips ─────────────────────────────────
const SCREENS = [
  {
    id: 'leaderboard',
    label: '🏆 Leaderboard',
    desc: 'Public spark leaderboard and activity log.',
    details: [
      {
        id: 'show_job_grade',
        label: 'Show job grade badges',
        tip: 'Show the grade badge (e.g. J3, F2) next to each employee\'s name on the leaderboard cards.',
      },
      {
        id: 'show_spark_log',
        label: 'Show activity log',
        tip: 'Show the full spark activity feed below the leaderboard — who sent sparks to whom, when, and why.',
      },
      {
        id: 'show_like_button',
        label: 'Allow liking sparks',
        tip: 'Allow this employee to click the ❤️ button on spark log entries to like (and optionally match) a recognition.',
      },
    ],
  },
  {
    id: 'my_sparks',
    label: '✨ My Sparks',
    desc: 'Spark sending, balance, and history for the employee.',
    details: [
      {
        id: 'show_balance',
        label: 'Show remaining spark balance',
        tip: 'Show how many sparks this employee has left to give in the current period.',
      },
      {
        id: 'show_history',
        label: 'Show sent/received history',
        tip: 'Show the list of sparks this employee has sent and received.',
      },
      {
        id: 'can_send_sparks',
        label: 'Allow sending sparks',
        tip: 'Allow this employee to send sparks to teammates. Turning this off removes the send controls from their My Sparks screen.',
      },
    ],
  },
  {
    id: 'compensation',
    label: '💵 My Pay',
    desc: 'Compensation, wage, range, and bonus information.',
    details: [
      {
        id: 'show_wage',
        label: 'Show own wage / salary',
        tip: 'Show the "My Compensation" section with this employee\'s hourly rate or salary, company vehicle value, and total estimated annual comp.',
      },
      {
        id: 'show_range',
        label: 'Show grade pay range',
        tip: 'Show the min/max pay range for their job grade, and show the position bar in the My Compensation section. Also shows min/max tiles in the grade comparison section.',
      },
      {
        id: 'show_target_bonus',
        label: 'Show target bonus %',
        tip: 'Show the target bonus percentage and estimated dollar amount in both My Compensation and the grade comparison section.',
      },
      {
        id: 'show_bonus_share',
        label: 'Show bonus share %',
        tip: 'Show the bonus share percentage, estimated payout from the bonus pool, and the Bonus Pool Breakdown card.',
      },
    ],
  },
  {
    id: 'performance',
    label: '📋 Evals',
    desc: 'Performance evaluations — trigger and view results.',
    details: [
      {
        id: 'can_trigger_eval',
        label: 'Can trigger evaluations',
        tip: 'Allow this employee to initiate a new performance evaluation cycle from the Evals screen. Typically reserved for foremen, managers, and above.',
      },
      {
        id: 'can_view_results',
        label: 'Can view evaluation results',
        tip: 'Allow this employee to view the completed results and ratings from evaluations they conducted.',
      },
    ],
  },
  {
    id: 'board',
    label: '📌 Message Board',
    desc: 'Company announcements and document library.',
    details: [
      {
        id: 'show_board',
        label: 'Show message board posts',
        tip: 'Show the company message board with announcements and posts from management.',
      },
      {
        id: 'show_docs',
        label: 'Show documents library',
        tip: 'Show the documents tab with uploaded company files (handbooks, forms, policies, etc.).',
      },
    ],
  },
  {
    id: 'dashboard',
    label: '📊 Dashboard',
    desc: 'Team spark analytics and utilization dashboard.',
    details: [
      {
        id: 'show_utilization',
        label: 'Show utilization %',
        tip: 'Show the overall and per-employee spark utilization rate (how much of each allowance is being used).',
      },
      {
        id: 'show_top_givers',
        label: 'Show top givers / receivers',
        tip: 'Show the top spark givers and receivers chart on the analytics dashboard.',
      },
      {
        id: 'show_charts',
        label: 'Show charts',
        tip: 'Show all chart visualizations on the dashboard (trend lines, distribution charts, etc.).',
      },
    ],
  },
]

// ── Grade detection helpers ───────────────────────────────────────────────────
const isForeman      = g => /^[FP]/i.test(g || '') || g === 'Owner'
const isPreForeman   = g => !isForeman(g)

// ── Grade-based default permissions ──────────────────────────────────────────
// Under foreman: leaderboard, my_sparks, board on; pay, evals, dashboard off.
// Foreman/PM:    same + evals on BUT can_trigger_eval and can_view_results off.
// Full access:   everything on.
function defaultPermsForGrade(grade) {
  const fm = isForeman(grade)
  const p = {
    screens: {
      leaderboard:   { visible: true,  details: { show_job_grade: true,  show_spark_log: true,  show_like_button: true  } },
      my_sparks:     { visible: true,  details: { show_balance: true,    show_history: true,    can_send_sparks: true   } },
      compensation:  { visible: false, details: { show_wage: false,      show_range: false,     show_target_bonus: false, show_bonus_share: false } },
      performance:   { visible: fm,    details: { can_trigger_eval: false, can_view_results: false } },
      board:         { visible: true,  details: { show_board: true,      show_docs: true        } },
      dashboard:     { visible: false, details: { show_utilization: false, show_top_givers: false, show_charts: false  } },
    },
  }
  return p
}

const FULL_ACCESS = () => {
  const p = { screens: {} }
  SCREENS.forEach(s => {
    p.screens[s.id] = { visible: true, details: {} }
    s.details.forEach(d => { p.screens[s.id].details[d.id] = true })
  })
  return p
}

// Names that always get full access (matched case-insensitively)
const FULL_ACCESS_NAMES = ['dan mulligan', 'don yahalom', 'don dubaldo']

function permsForEmployee(emp) {
  const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase()
  if (FULL_ACCESS_NAMES.includes(fullName)) return FULL_ACCESS()
  return defaultPermsForGrade(emp.job_grade)
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tip({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: '50%',
          background: 'rgba(240,192,64,0.2)', color: 'var(--gold)',
          fontSize: '0.58rem', fontWeight: 700, cursor: 'help', lineHeight: 1,
        }}
      >?</span>
      {open && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999, width: 220,
          background: '#1a3828', border: '1px solid rgba(240,192,64,0.4)',
          borderRadius: 8, padding: '8px 11px',
          fontSize: '0.73rem', color: 'var(--white-soft)', lineHeight: 1.5,
          boxShadow: '0 6px 20px rgba(0,0,0,0.6)', pointerEvents: 'none',
          whiteSpace: 'normal',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

// ── Determine job title group for filter ──────────────────────────────────────
function gradeGroup(grade) {
  if (!grade) return 'Other'
  if (/^Owner$/i.test(grade)) return 'Owner'
  if (/^P/i.test(grade)) return 'Project Manager'
  if (/^F/i.test(grade)) return 'Foreman'
  if (/^J/i.test(grade)) return 'Journeyman'
  if (/^A/i.test(grade)) return 'Apprentice'
  if (/^Pre/i.test(grade)) return 'Pre-Apprentice'
  return 'Other'
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserPermissionsPage() {
  const [employees, setEmployees] = useState([])
  const [permMap, setPermMap]     = useState({})
  const [selected, setSelected]   = useState('')
  const [search, setSearch]       = useState('')
  const [gradeFilter, setGradeFilter] = useState('All')
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
      supabase.from('employees')
        .select('id,first_name,last_name,email,job_grade,job_title,is_archived')
        .eq('is_admin', false).eq('is_archived', false).order('last_name'),
      supabase.from('user_permissions').select('*'),
    ])
    const allEmps = emps || []
    setEmployees(allEmps)

    // Build perm map — fall back to grade-based defaults for new employees
    const map = {}
    ;(rows || []).forEach(r => {
      try { map[r.employee_id] = JSON.parse(r.permissions) } catch {}
    })
    allEmps.forEach(e => { if (!map[e.id]) map[e.id] = permsForEmployee(e) })
    setPermMap(map)
    if (!selected && allEmps.length > 0) setSelected(allEmps[0].id)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const perms = permMap[selected] || FULL_ACCESS()

  const update = (patch) => {
    setPermMap(prev => ({ ...prev, [selected]: patch }))
    setDirty(true)
  }

  const toggleScreen = (screenId) => {
    const cur = JSON.parse(JSON.stringify(perms))
    cur.screens[screenId].visible = !cur.screens[screenId].visible
    update(cur)
  }

  // ── Key fix: use a direct function call, no label/onChange interaction ──────
  const toggleDetail = (screenId, detailId) => {
    const cur = JSON.parse(JSON.stringify(perms))
    const prev = cur.screens[screenId].details[detailId]
    cur.screens[screenId].details[detailId] = prev === false ? true : false
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

  const copyFromEmployee = (fromEmpId) => {
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

  const applyGradeDefaults = () => {
    const emp = employees.find(e => e.id === selected)
    if (!emp) return
    update(permsForEmployee(emp))
    showMsg('Grade defaults applied — remember to save.')
  }

  // Grade groups for filter
  const gradeGroups = ['All', ...Array.from(new Set(employees.map(e => gradeGroup(e.job_grade)))).sort()]

  const filteredEmps = employees.filter(e => {
    const nameMatch = `${e.first_name} ${e.last_name} ${e.job_grade || ''}`.toLowerCase().includes(search.toLowerCase())
    const groupMatch = gradeFilter === 'All' || gradeGroup(e.job_grade) === gradeFilter
    return nameMatch && groupMatch
  })

  const screenVisible = (sid) => perms.screens?.[sid]?.visible !== false
  const detailOn = (sid, did) => perms.screens?.[sid]?.details?.[did] !== false

  const selectedEmp = employees.find(e => e.id === selected)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, minHeight: '60vh' }}>

      {/* ── Employee list ── */}
      <div style={{
        background: 'var(--bg-darker)', borderRadius: 10,
        border: '1px solid var(--border)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)', marginBottom: 8 }}>
            Employee Permissions
          </div>
          <input className="form-input" style={{ width: '100%', fontSize: '0.82rem', marginBottom: 6 }}
            placeholder="Search by name or grade…" value={search}
            onChange={e => setSearch(e.target.value)} />
          {/* Grade group filter */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {gradeGroups.map(g => (
              <button key={g} onClick={() => setGradeFilter(g)}
                style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: '0.68rem', cursor: 'pointer', border: 'none',
                  background: gradeFilter === g ? 'var(--gold)' : 'rgba(255,255,255,0.08)',
                  color: gradeFilter === g ? '#112e1c' : 'var(--white-dim)',
                  fontWeight: gradeFilter === g ? 700 : 400,
                }}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--white-dim)', fontSize: '0.82rem' }}>Loading…</div>
          ) : filteredEmps.map(emp => (
            <button key={emp.id} onClick={() => { setSelected(emp.id); setDirty(false) }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none',
                border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                cursor: 'pointer',
                borderLeft: `3px solid ${selected === emp.id ? 'var(--gold)' : 'transparent'}`,
                background: selected === emp.id ? 'rgba(240,192,64,0.07)' : 'transparent',
              }}>
              <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--white-soft)' }}>
                {emp.first_name} {emp.last_name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)', marginTop: 2 }}>
                {emp.job_grade && (
                  <span style={{ color: 'var(--gold-dark)', marginRight: 6 }}>{emp.job_grade}</span>
                )}
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
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem',
            background: msg.type === 'error' ? 'rgba(224,85,85,0.12)' : 'rgba(94,232,138,0.1)',
            border: `1px solid ${msg.type === 'error' ? 'rgba(224,85,85,0.4)' : 'rgba(94,232,138,0.3)'}`,
            color: msg.type === 'error' ? '#ff8a8a' : 'var(--green-bright)',
          }}>
            {msg.text}
          </div>
        )}

        {selectedEmp ? (
          <>
            {/* Header */}
            <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--white-soft)' }}>
                    {selectedEmp.first_name} {selectedEmp.last_name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--white-dim)', marginTop: 3 }}>
                    {selectedEmp.email}
                    {selectedEmp.job_grade && (
                      <span style={{ marginLeft: 8, color: 'var(--gold)' }}>{selectedEmp.job_grade}</span>
                    )}
                    {selectedEmp.job_title && (
                      <span style={{ marginLeft: 6, color: 'var(--white-dim)' }}>· {selectedEmp.job_title}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select className="form-select"
                    style={{ fontSize: '0.78rem', padding: '5px 10px', maxWidth: 180 }}
                    value="" onChange={e => { if (e.target.value) copyFromEmployee(e.target.value) }}>
                    <option value="">Copy from…</option>
                    {employees.filter(e => e.id !== selected).map(e => (
                      <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                    ))}
                  </select>
                  <button className="btn btn-outline btn-sm" onClick={applyGradeDefaults}
                    title="Apply the defaults for this employee's job grade">Grade defaults</button>
                  <button className="btn btn-outline btn-sm"
                    onClick={() => setAllScreens(false)}
                    style={{ color: '#ff8a8a', borderColor: 'rgba(224,85,85,0.4)' }}>Revoke all</button>
                  <button className="btn btn-outline btn-sm"
                    onClick={() => setAllScreens(true)}>Grant all</button>
                  <button className="btn btn-gold btn-sm" onClick={savePerms} disabled={saving}>
                    {saving ? 'Saving…' : dirty ? '💾 Save*' : '💾 Saved'}
                  </button>
                </div>
              </div>
            </div>

            {/* Screen cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SCREENS.map(screen => {
                const on = screenVisible(screen.id)
                return (
                  <div key={screen.id} className="card" style={{
                    padding: '14px 18px',
                    borderLeft: `3px solid ${on ? 'var(--gold)' : 'rgba(224,85,85,0.5)'}`,
                  }}>
                    {/* Screen header row */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: on && screen.details.length ? 12 : 0,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Toggle switch */}
                        <button onClick={() => toggleScreen(screen.id)}
                          style={{
                            width: 44, height: 24, borderRadius: 12, border: 'none',
                            cursor: 'pointer', flexShrink: 0, transition: 'background 0.2s',
                            background: on ? 'var(--gold)' : 'rgba(255,255,255,0.15)',
                            position: 'relative',
                          }}>
                          <span style={{
                            position: 'absolute', top: 3,
                            left: on ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%',
                            background: on ? '#112e1c' : 'rgba(255,255,255,0.6)',
                            transition: 'left 0.2s',
                          }} />
                        </button>
                        <div>
                          <div style={{
                            fontWeight: 700, fontSize: '0.92rem',
                            color: on ? 'var(--white-soft)' : 'var(--white-dim)',
                          }}>
                            {screen.label}
                          </div>
                          <div style={{ fontSize: '0.73rem', color: 'var(--white-dim)', marginTop: 1 }}>
                            {screen.desc}
                          </div>
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                        background: on ? 'rgba(94,232,138,0.1)' : 'rgba(224,85,85,0.1)',
                        color: on ? 'var(--green-bright)' : '#ff8a8a',
                        border: `1px solid ${on ? 'rgba(94,232,138,0.3)' : 'rgba(224,85,85,0.3)'}`,
                      }}>{on ? 'Visible' : 'Hidden'}</span>
                    </div>

                    {/* Detail checkboxes — only shown when screen is on */}
                    {on && screen.details.length > 0 && (
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 8,
                        paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        {screen.details.map(detail => {
                          const active = detailOn(screen.id, detail.id)
                          return (
                            // ── Use a div+onClick, NOT label+onChange, to avoid double-fire ──
                            <div
                              key={detail.id}
                              onClick={() => toggleDetail(screen.id, detail.id)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                cursor: 'pointer', userSelect: 'none',
                                padding: '6px 11px', borderRadius: 6, fontSize: '0.78rem',
                                background: active ? 'rgba(240,192,64,0.12)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${active ? 'rgba(240,192,64,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                color: active ? 'var(--white-soft)' : 'var(--white-dim)',
                                transition: 'background 0.15s, border-color 0.15s',
                              }}
                            >
                              {/* Visual-only checkbox — no onChange needed */}
                              <span style={{
                                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                background: active ? 'var(--gold)' : 'rgba(255,255,255,0.1)',
                                border: `1.5px solid ${active ? 'var(--gold)' : 'rgba(255,255,255,0.25)'}`,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.6rem', color: '#112e1c', fontWeight: 900,
                              }}>
                                {active ? '✓' : ''}
                              </span>
                              {detail.label}
                              <Tip text={detail.tip} />
                            </div>
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
