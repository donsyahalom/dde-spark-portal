import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ── Multi-select pill picker ──────────────────────────────────────────────────
function MultiPicker({ label, options, selected, onChange, accentColor = 'var(--gold)' }) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)
  const selectedOptions = options.filter(o => selectedSet.has(o.id))

  const toggle = (id) => {
    if (selectedSet.has(id)) onChange(selected.filter(x => x !== id))
    else onChange([...selected, id])
  }

  return (
    <div>
      <label className="form-label">{label}</label>
      {selectedOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
          {selectedOptions.map(o => (
            <span key={o.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '0.75rem', padding: '3px 8px', borderRadius: '20px',
              background: 'rgba(240,192,64,0.12)', border: '1px solid rgba(240,192,64,0.35)',
              color: accentColor
            }}>
              {o.label}
              <button onClick={() => toggle(o.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--white-dim)', fontSize: '0.85rem', lineHeight: 1, padding: '0 1px'
              }}>x</button>
            </span>
          ))}
        </div>
      )}
      <button
        className="btn btn-outline btn-sm"
        style={{ fontSize: '0.78rem', width: '100%', textAlign: 'left', justifyContent: 'space-between', display: 'flex' }}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span>{selected.length === 0 ? '-- Select --' : selected.length + ' selected'}</span>
        <span style={{ opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          marginTop: '4px', border: '1px solid var(--border)', borderRadius: '8px',
          background: 'var(--bg-darker)', maxHeight: '200px', overflowY: 'auto', position: 'relative', zIndex: 10
        }}>
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '0.78rem', color: 'var(--white-dim)' }}>No eligible employees found.</div>
          )}
          {options.map(o => (
            <label key={o.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', cursor: 'pointer',
              background: selectedSet.has(o.id) ? 'rgba(240,192,64,0.08)' : 'transparent',
              borderBottom: '1px solid rgba(255,255,255,0.04)'
            }}>
              <input type="checkbox" checked={selectedSet.has(o.id)} onChange={() => toggle(o.id)}
                style={{ accentColor: 'var(--gold)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem' }}>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Grade/title matchers ──────────────────────────────────────────────────────
function isPM(emp) {
  const g = (emp.job_grade || '').toUpperCase()
  const t = (emp.job_title || '').toLowerCase()
  return /^P\d/.test(g) || g === 'OWNER' || t.includes('project manager') || t === 'owner'
}
function isForeman(emp) {
  const g = (emp.job_grade || '').toUpperCase()
  const t = (emp.job_title || '').toLowerCase()
  return /^F\d/.test(g) || t.includes('foreman')
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TeamsTab({ employees, showMsg }) {
  const [teams, setTeams] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [dashboardAccess, setDashboardAccess] = useState([])
  const [loading, setLoading] = useState(false)
  const [reordering, setReordering] = useState(false)

  const emptyTeam = { name: '', pm_ids: [], foreman_ids: [], team_lead_can_view_dashboard: false }
  const [teamForm, setTeamForm] = useState(emptyTeam)
  const [editTeamId, setEditTeamId] = useState(null)
  const [selectedTeamId, setSelectedTeamId] = useState(null)
  const [memberSearch, setMemberSearch] = useState('')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const [{ data: teamsData }, { data: membersData }, { data: accessData }] = await Promise.all([
      supabase.from('teams').select('*').order('sort_order').order('name'),
      supabase.from('team_members').select('*'),
      supabase.from('dashboard_access').select('*, employee:employee_id(id,first_name,last_name)'),
    ])
    setTeams(teamsData || [])
    setTeamMembers(membersData || [])
    setDashboardAccess(accessData || [])
  }

  const nonAdminEmps = (employees || []).filter(e => !e.is_admin)

  const pmOptions = useMemo(() =>
    nonAdminEmps.filter(isPM).map(e => ({
      id: e.id,
      label: e.first_name + ' ' + e.last_name + (e.job_grade ? ' · ' + e.job_grade : '') + (e.job_title ? ' (' + e.job_title + ')' : '')
    }))
  , [nonAdminEmps])

  const foremanOptions = useMemo(() =>
    nonAdminEmps.filter(isForeman).map(e => ({
      id: e.id,
      label: e.first_name + ' ' + e.last_name + (e.job_grade ? ' · ' + e.job_grade : '') + (e.job_title ? ' (' + e.job_title + ')' : '')
    }))
  , [nonAdminEmps])

  const empTeamCount = (empId) => teamMembers.filter(m => m.employee_id === empId).length

  // ── Move team up or down by swapping sort_orders with its neighbour ──────────
  const moveTeam = async (team, direction) => {
    const idx = teams.findIndex(t => t.id === team.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= teams.length) return
    const neighbour = teams[swapIdx]
    setReordering(true)
    // Swap sort_orders
    const aOrder = team.sort_order ?? idx + 1
    const bOrder = neighbour.sort_order ?? swapIdx + 1
    await Promise.all([
      supabase.from('teams').update({ sort_order: bOrder }).eq('id', team.id),
      supabase.from('teams').update({ sort_order: aOrder }).eq('id', neighbour.id),
    ])
    setReordering(false)
    fetchAll()
  }

  const saveTeam = async () => {
    if (!teamForm.name.trim()) { showMsg('error', 'Team name required'); return }
    setLoading(true)
    const payload = {
      name: teamForm.name.trim(),
      pm_ids: teamForm.pm_ids || [],
      foreman_ids: teamForm.foreman_ids || [],
      team_lead_can_view_dashboard: teamForm.team_lead_can_view_dashboard,
      updated_at: new Date().toISOString(),
    }
    if (editTeamId) {
      await supabase.from('teams').update(payload).eq('id', editTeamId)
      showMsg('success', 'Team "' + payload.name + '" updated')
    } else {
      // Assign sort_order at end of current list
      const maxOrder = teams.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0)
      payload.sort_order = maxOrder + 1
      const { error } = await supabase.from('teams').insert(payload)
      if (error) { showMsg('error', error.message); setLoading(false); return }
      showMsg('success', 'Team "' + payload.name + '" created')
    }
    setTeamForm(emptyTeam); setEditTeamId(null)
    setLoading(false); fetchAll()
  }

  const deleteTeam = async (team) => {
    if (!window.confirm('Delete team "' + team.name + '"? Members will be unassigned.')) return
    await supabase.from('teams').delete().eq('id', team.id)
    showMsg('success', 'Team "' + team.name + '" deleted')
    if (selectedTeamId === team.id) setSelectedTeamId(null)
    fetchAll()
  }

  const startEditTeam = (team) => {
    setEditTeamId(team.id)
    setTeamForm({
      name: team.name,
      pm_ids: team.pm_ids || [],
      foreman_ids: team.foreman_ids || [],
      team_lead_can_view_dashboard: !!team.team_lead_can_view_dashboard
    })
    setSelectedTeamId(team.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleMember = async (teamId, empId) => {
    const existing = teamMembers.find(m => m.team_id === teamId && m.employee_id === empId)
    if (existing) {
      await supabase.from('team_members').delete().eq('id', existing.id)
    } else {
      const count = empTeamCount(empId)
      if (count >= 1) {
        const ok = window.confirm('Warning: This employee is already on ' + count + ' team(s). Add to another?')
        if (!ok) return
      }
      await supabase.from('team_members').insert({ team_id: teamId, employee_id: empId })
    }
    fetchAll()
  }

  const grantAccess = async (empId, level) => {
    const existing = dashboardAccess.find(a => a.employee_id === empId)
    if (existing) {
      await supabase.from('dashboard_access').update({ access_level: level }).eq('employee_id', empId)
    } else {
      await supabase.from('dashboard_access').insert({ employee_id: empId, access_level: level })
    }
    showMsg('success', 'Dashboard access updated')
    fetchAll()
  }

  const revokeAccess = async (empId) => {
    await supabase.from('dashboard_access').delete().eq('employee_id', empId)
    showMsg('success', 'Dashboard access revoked')
    fetchAll()
  }

  const accessMap = Object.fromEntries(dashboardAccess.map(a => [a.employee_id, a.access_level]))
  const selectedTeamMemberIds = new Set(teamMembers.filter(m => m.team_id === selectedTeamId).map(m => m.employee_id))

  const filteredEmps = nonAdminEmps.filter(e =>
    !memberSearch.trim() ||
    (e.first_name + ' ' + e.last_name).toLowerCase().includes(memberSearch.toLowerCase()) ||
    (e.job_title || '').toLowerCase().includes(memberSearch.toLowerCase())
  )

  const leadNames = (ids) => {
    if (!ids || ids.length === 0) return null
    return ids.map(id => { const e = nonAdminEmps.find(x => x.id === id); return e ? e.first_name + ' ' + e.last_name : null })
      .filter(Boolean).join(', ')
  }

  return (
    <div>
      {/* ── Create / Edit Team ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-title">
          <span className="icon">&#x1F477;</span> {editTeamId ? 'Edit Team' : 'Create New Team'}
        </div>
        <div className="form-grid" style={{ marginBottom: '14px' }}>
          <div className="form-group">
            <label className="form-label">Team Name *</label>
            <input className="form-input" value={teamForm.name}
              onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Crew Alpha, Site B Team..." />
          </div>
          <div className="form-group">
            <MultiPicker label="PM(s) — Team Lead" options={pmOptions}
              selected={teamForm.pm_ids} onChange={ids => setTeamForm(f => ({ ...f, pm_ids: ids }))} />
            {pmOptions.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--white-dim)', marginTop: '4px' }}>
                Assign P-grade (P1–P4, Owner) or "Project Manager" job title to employees to see them here.
              </div>
            )}
          </div>
          <div className="form-group">
            <MultiPicker label="Foreman(s) — Team Lead" options={foremanOptions}
              selected={teamForm.foreman_ids} onChange={ids => setTeamForm(f => ({ ...f, foreman_ids: ids }))}
              accentColor="var(--green-bright)" />
            {foremanOptions.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--white-dim)', marginTop: '4px' }}>
                Assign F-grade (F1–F4) or "Foreman" job title to employees to see them here.
              </div>
            )}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '14px' }}>
          <input type="checkbox" checked={teamForm.team_lead_can_view_dashboard}
            onChange={e => setTeamForm(f => ({ ...f, team_lead_can_view_dashboard: e.target.checked }))}
            style={{ accentColor: 'var(--gold)' }} />
          Allow PM(s) + Foreman(s) to view this team's dashboard (spark counts only — no $ amounts)
        </label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-gold btn-sm" onClick={saveTeam} disabled={loading}>
            {loading ? 'Saving...' : editTeamId ? 'Save Changes' : 'Create Team'}
          </button>
          {editTeamId && (
            <button className="btn btn-outline btn-sm" onClick={() => { setEditTeamId(null); setTeamForm(emptyTeam) }}>Cancel</button>
          )}
        </div>
      </div>

      {/* ── Team List ── */}
      {teams.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--white-dim)', padding: '32px' }}>No teams yet. Create one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          {teams.map((team, idx) => {
            const memberIds = new Set(teamMembers.filter(m => m.team_id === team.id).map(m => m.employee_id))
            const members = nonAdminEmps.filter(e => memberIds.has(e.id))
            const isSelected = selectedTeamId === team.id
            const pmName = leadNames(team.pm_ids)
            const foremanName = leadNames(team.foreman_ids)
            return (
              <div key={team.id} className="card" style={{ border: isSelected ? '1px solid var(--gold)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                  {/* ── Move buttons + name ── */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0, paddingTop: '2px' }}>
                      <button
                        onClick={() => moveTeam(team, 'up')}
                        disabled={idx === 0 || reordering}
                        title="Move up"
                        style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'rgba(255,255,255,0.15)' : 'var(--white-dim)', fontSize: '0.7rem', padding: '0 3px', lineHeight: 1.2 }}
                      >▲</button>
                      <button
                        onClick={() => moveTeam(team, 'down')}
                        disabled={idx === teams.length - 1 || reordering}
                        title="Move down"
                        style={{ background: 'none', border: 'none', cursor: idx === teams.length - 1 ? 'default' : 'pointer', color: idx === teams.length - 1 ? 'rgba(255,255,255,0.15)' : 'var(--white-dim)', fontSize: '0.7rem', padding: '0 3px', lineHeight: 1.2 }}
                      >▼</button>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gold)' }}>{team.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--white-dim)', marginTop: '3px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {pmName && <span>PM: <strong style={{ color: 'var(--white-soft)' }}>{pmName}</strong></span>}
                        {foremanName && <span>Foreman: <strong style={{ color: 'var(--white-soft)' }}>{foremanName}</strong></span>}
                        <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                        {team.team_lead_can_view_dashboard && <span style={{ color: 'var(--green-bright)' }}>&#x1F4CA; Leads can view dashboard</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-xs" onClick={() => setSelectedTeamId(isSelected ? null : team.id)}>
                      {isSelected ? 'Hide Members' : 'Members (' + members.length + ')'}
                    </button>
                    <button className="btn btn-outline btn-xs" onClick={() => startEditTeam(team)}>Edit</button>
                    <button className="btn btn-danger btn-xs" onClick={() => deleteTeam(team)}>x</button>
                  </div>
                </div>

                {members.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: isSelected ? '12px' : 0 }}>
                    {members.map(e => (
                      <span key={e.id} style={{ fontSize: '0.7rem', background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.25)', borderRadius: '20px', padding: '2px 8px', color: 'var(--white-soft)' }}>
                        {e.first_name} {e.last_name} <span style={{ color: 'var(--white-dim)' }}>· {e.job_title || e.job_grade || '—'}</span>
                        {empTeamCount(e.id) > 1 && <span style={{ color: 'var(--gold)', marginLeft: '3px' }}>!</span>}
                      </span>
                    ))}
                  </div>
                )}

                {isSelected && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.08em', marginBottom: '8px' }}>ASSIGN / REMOVE MEMBERS</div>
                    <input className="form-input" placeholder="Search employees..." value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)} style={{ marginBottom: '10px', fontSize: '0.82rem' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
                      {filteredEmps.map(e => {
                        const isMember = selectedTeamMemberIds.has(e.id)
                        const multiTeam = empTeamCount(e.id) > (isMember ? 1 : 0)
                        return (
                          <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', background: isMember ? 'rgba(94,232,138,0.1)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (isMember ? 'rgba(94,232,138,0.3)' : 'var(--border)') }}>
                            <input type="checkbox" checked={isMember} onChange={() => toggleMember(selectedTeamId, e.id)} style={{ accentColor: 'var(--green-bright)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.first_name} {e.last_name}</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)' }}>{e.job_title || '—'} {e.job_grade ? '· ' + e.job_grade : ''}</div>
                            </div>
                            {multiTeam && <span title="On multiple teams" style={{ color: 'var(--gold)', fontSize: '0.8rem' }}>!</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Dashboard Access ── */}
      <div className="card">
        <div className="card-title"><span className="icon">&#x1F4CA;</span> Dashboard Access</div>
        <p style={{ color: 'var(--white-dim)', fontSize: '0.82rem', marginBottom: '14px' }}>
          Grant non-admin employees access to the analytics dashboard.{' '}
          <strong style={{ color: 'var(--gold)' }}>Full Dashboard</strong> includes $ amounts and the including/excluding optional breakdown.{' '}
          <strong style={{ color: 'var(--green-bright)' }}>Team Dashboard</strong> shows only their teams' spark counts — no $ amounts.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nonAdminEmps.map(e => {
            const level = accessMap[e.id]
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: level ? 'rgba(94,232,138,0.06)' : 'rgba(255,255,255,0.02)', border: '1px solid ' + (level ? 'rgba(94,232,138,0.2)' : 'var(--border)') }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{e.first_name} {e.last_name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--white-dim)' }}>{e.job_title || '—'} {e.job_grade ? '· ' + e.job_grade : ''}</div>
                </div>
                {level && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: level === 'full' ? 'rgba(240,192,64,0.15)' : 'rgba(94,232,138,0.15)', color: level === 'full' ? 'var(--gold)' : 'var(--green-bright)', border: '1px solid ' + (level === 'full' ? 'rgba(240,192,64,0.3)' : 'rgba(94,232,138,0.3)') }}>
                    {level === 'full' ? 'Full (incl $)' : 'Team (no $)'}
                  </span>
                )}
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button onClick={() => grantAccess(e.id, 'full')} className={'btn btn-xs ' + (level === 'full' ? 'btn-gold' : 'btn-outline')} style={{ fontSize: '0.68rem' }}>Full</button>
                  <button onClick={() => grantAccess(e.id, 'team')} className={'btn btn-xs ' + (level === 'team' ? '' : 'btn-outline')} style={level === 'team' ? { fontSize: '0.68rem', background: 'rgba(94,232,138,0.25)', color: 'var(--green-bright)', border: '1px solid rgba(94,232,138,0.4)' } : { fontSize: '0.68rem' }}>Team</button>
                  {level && <button onClick={() => revokeAccess(e.id)} className="btn btn-danger btn-xs" style={{ fontSize: '0.68rem' }}>x</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
