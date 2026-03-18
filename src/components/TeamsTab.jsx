import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function TeamsTab({ employees, showMsg }) {
  const [teams, setTeams] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [dashboardAccess, setDashboardAccess] = useState([])
  const [loading, setLoading] = useState(false)

  // Team form
  const emptyTeam = { name: '', pm_id: '', foreman_id: '', team_lead_can_view_dashboard: false }
  const [teamForm, setTeamForm] = useState(emptyTeam)
  const [editTeamId, setEditTeamId] = useState(null)

  // Member assignment
  const [selectedTeamId, setSelectedTeamId] = useState(null)
  const [memberSearch, setMemberSearch] = useState('')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const [{ data: teamsData }, { data: membersData }, { data: accessData }] = await Promise.all([
      supabase.from('teams').select('*, pm:pm_id(first_name,last_name), foreman:foreman_id(first_name,last_name)').order('name'),
      supabase.from('team_members').select('*'),
      supabase.from('dashboard_access').select('*, employee:employee_id(id,first_name,last_name)'),
    ])
    setTeams(teamsData || [])
    setTeamMembers(membersData || [])
    setDashboardAccess(accessData || [])
  }

  const nonAdminEmps = employees.filter(e => !e.is_admin)

  // Count how many teams an employee is in
  const empTeamCount = (empId) => teamMembers.filter(m => m.employee_id === empId).length

  const saveTeam = async () => {
    if (!teamForm.name.trim()) { showMsg('error', 'Team name required'); return }
    setLoading(true)
    const payload = {
      name: teamForm.name.trim(),
      pm_id: teamForm.pm_id || null,
      foreman_id: teamForm.foreman_id || null,
      team_lead_can_view_dashboard: teamForm.team_lead_can_view_dashboard,
      updated_at: new Date().toISOString(),
    }
    if (editTeamId) {
      await supabase.from('teams').update(payload).eq('id', editTeamId)
      showMsg('success', `Team "${payload.name}" updated`)
    } else {
      const { error } = await supabase.from('teams').insert(payload)
      if (error) { showMsg('error', error.message); setLoading(false); return }
      showMsg('success', `Team "${payload.name}" created`)
    }
    setTeamForm(emptyTeam); setEditTeamId(null)
    setLoading(false); fetchAll()
  }

  const deleteTeam = async (team) => {
    if (!window.confirm(`Delete team "${team.name}"? Members will be unassigned.`)) return
    await supabase.from('teams').delete().eq('id', team.id)
    showMsg('success', `Team "${team.name}" deleted`)
    if (selectedTeamId === team.id) setSelectedTeamId(null)
    fetchAll()
  }

  const editTeam = (team) => {
    setEditTeamId(team.id)
    setTeamForm({ name: team.name, pm_id: team.pm_id || '', foreman_id: team.foreman_id || '', team_lead_can_view_dashboard: !!team.team_lead_can_view_dashboard })
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
        const ok = window.confirm(`⚠️ This employee is already on ${count} team${count > 1 ? 's' : ''}. Add to another?`)
        if (!ok) return
      }
      await supabase.from('team_members').insert({ team_id: teamId, employee_id: empId })
    }
    fetchAll()
  }

  // Dashboard access management
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

  const selectedTeam = teams.find(t => t.id === selectedTeamId)
  const selectedTeamMemberIds = new Set(teamMembers.filter(m => m.team_id === selectedTeamId).map(m => m.employee_id))

  const filteredEmps = nonAdminEmps.filter(e =>
    !memberSearch.trim() ||
    `${e.first_name} ${e.last_name}`.toLowerCase().includes(memberSearch.toLowerCase()) ||
    (e.job_title || '').toLowerCase().includes(memberSearch.toLowerCase())
  )

  return (
    <div>
      {/* ── Create / Edit Team ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-title"><span className="icon">👷</span> {editTeamId ? 'Edit Team' : 'Create New Team'}</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Team Name *</label>
            <input className="form-input" value={teamForm.name} onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Crew Alpha, Site B Team…" />
          </div>
          <div className="form-group">
            <label className="form-label">PM (Team Lead)</label>
            <select className="form-select" value={teamForm.pm_id} onChange={e => setTeamForm(f => ({ ...f, pm_id: e.target.value }))}>
              <option value="">— None —</option>
              {nonAdminEmps.filter(e => e.is_management || ['P1','P2','P3','P4','Owner'].includes(e.job_grade)).map(e => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.job_grade || e.job_title})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Foreman (Team Lead)</label>
            <select className="form-select" value={teamForm.foreman_id} onChange={e => setTeamForm(f => ({ ...f, foreman_id: e.target.value }))}>
              <option value="">— None —</option>
              {nonAdminEmps.filter(e => ['Foreman','F1','F2','F3','F4'].includes(e.job_grade) || e.job_title === 'Foreman').map(e => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.job_grade || e.job_title})</option>
              ))}
            </select>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '14px' }}>
          <input type="checkbox" checked={teamForm.team_lead_can_view_dashboard} onChange={e => setTeamForm(f => ({ ...f, team_lead_can_view_dashboard: e.target.checked }))} style={{ accentColor: 'var(--gold)' }} />
          Allow team leads (PM + Foreman) to view this team's dashboard (no $ amounts)
        </label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-gold btn-sm" onClick={saveTeam} disabled={loading}>{loading ? 'Saving…' : editTeamId ? '💾 Save Changes' : '➕ Create Team'}</button>
          {editTeamId && <button className="btn btn-outline btn-sm" onClick={() => { setEditTeamId(null); setTeamForm(emptyTeam) }}>Cancel</button>}
        </div>
      </div>

      {/* ── Team List ── */}
      {teams.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--white-dim)', padding: '32px' }}>No teams yet. Create one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          {teams.map(team => {
            const memberIds = new Set(teamMembers.filter(m => m.team_id === team.id).map(m => m.employee_id))
            const members = nonAdminEmps.filter(e => memberIds.has(e.id))
            const isSelected = selectedTeamId === team.id
            return (
              <div key={team.id} className="card" style={{ border: isSelected ? '1px solid var(--gold)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gold)' }}>{team.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--white-dim)', marginTop: '3px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {team.pm && <span>PM: <strong style={{ color: 'var(--white-soft)' }}>{team.pm.first_name} {team.pm.last_name}</strong></span>}
                      {team.foreman && <span>Foreman: <strong style={{ color: 'var(--white-soft)' }}>{team.foreman.first_name} {team.foreman.last_name}</strong></span>}
                      <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                      {team.team_lead_can_view_dashboard && <span style={{ color: 'var(--green-bright)' }}>📊 Leads can view dashboard</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-xs" onClick={() => setSelectedTeamId(isSelected ? null : team.id)}>
                      {isSelected ? '▲ Hide Members' : `👥 Members (${members.length})`}
                    </button>
                    <button className="btn btn-outline btn-xs" onClick={() => editTeam(team)}>✏️ Edit</button>
                    <button className="btn btn-danger btn-xs" onClick={() => deleteTeam(team)}>✕</button>
                  </div>
                </div>

                {/* Member chips */}
                {members.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: isSelected ? '12px' : 0 }}>
                    {members.map(e => (
                      <span key={e.id} style={{ fontSize: '0.7rem', background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.25)', borderRadius: '20px', padding: '2px 8px', color: 'var(--white-soft)' }}>
                        {e.first_name} {e.last_name} <span style={{ color: 'var(--white-dim)' }}>· {e.job_title || e.job_grade || '—'}</span>
                        {empTeamCount(e.id) > 1 && <span style={{ color: 'var(--gold)', marginLeft: '3px' }}>⚠</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Member assignment panel */}
                {isSelected && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.08em', marginBottom: '8px' }}>ASSIGN / REMOVE MEMBERS</div>
                    <input className="form-input" placeholder="Search employees…" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} style={{ marginBottom: '10px', fontSize: '0.82rem' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
                      {filteredEmps.map(e => {
                        const isMember = selectedTeamMemberIds.has(e.id)
                        const multiTeam = empTeamCount(e.id) > (isMember ? 1 : 0)
                        return (
                          <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', background: isMember ? 'rgba(94,232,138,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isMember ? 'rgba(94,232,138,0.3)' : 'var(--border)'}` }}>
                            <input type="checkbox" checked={isMember} onChange={() => toggleMember(selectedTeamId, e.id)} style={{ accentColor: 'var(--green-bright)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.first_name} {e.last_name}</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)' }}>{e.job_title || '—'} {e.job_grade ? `· ${e.job_grade}` : ''}</div>
                            </div>
                            {multiTeam && <span title="On multiple teams" style={{ color: 'var(--gold)', fontSize: '0.8rem' }}>⚠</span>}
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
        <div className="card-title"><span className="icon">📊</span> Dashboard Access</div>
        <p style={{ color: 'var(--white-dim)', fontSize: '0.82rem', marginBottom: '14px' }}>
          Grant non-admin employees access to the analytics dashboard. <strong style={{ color: 'var(--gold)' }}>Full Dashboard</strong> includes $ amounts. <strong style={{ color: 'var(--green-bright)' }}>Team Dashboard</strong> shows only their teams' data, no $ amounts.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nonAdminEmps.map(e => {
            const level = accessMap[e.id]
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: level ? 'rgba(94,232,138,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${level ? 'rgba(94,232,138,0.2)' : 'var(--border)'}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{e.first_name} {e.last_name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--white-dim)' }}>{e.job_title || '—'} {e.job_grade ? `· ${e.job_grade}` : ''}</div>
                </div>
                {level && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: level === 'full' ? 'rgba(240,192,64,0.15)' : 'rgba(94,232,138,0.15)', color: level === 'full' ? 'var(--gold)' : 'var(--green-bright)', border: `1px solid ${level === 'full' ? 'rgba(240,192,64,0.3)' : 'rgba(94,232,138,0.3)'}` }}>
                    {level === 'full' ? '📊 Full (incl $)' : '📋 Team (no $)'}
                  </span>
                )}
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button onClick={() => grantAccess(e.id, 'full')} className={`btn btn-xs ${level === 'full' ? 'btn-gold' : 'btn-outline'}`} style={{ fontSize: '0.68rem' }}>Full</button>
                  <button onClick={() => grantAccess(e.id, 'team')} className={`btn btn-xs ${level === 'team' ? '' : 'btn-outline'}`} style={level === 'team' ? { fontSize: '0.68rem', background: 'rgba(94,232,138,0.25)', color: 'var(--green-bright)', border: '1px solid rgba(94,232,138,0.4)' } : { fontSize: '0.68rem' }}>Team</button>
                  {level && <button onClick={() => revokeAccess(e.id)} className="btn btn-danger btn-xs" style={{ fontSize: '0.68rem' }}>✕</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
