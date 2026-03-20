/**
 * TagsTab.jsx
 * Full DDE Tags experience embedded inside the DDE Spark Portal.
 * Shown only to employees who have been granted tags_access by an admin.
 *
 * Props:
 *   currentUser  – the logged-in employee object from AuthContext
 *   employees    – full employee list (fetched by parent or self)
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─── tiny helpers ────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9)
const fmtDate = iso =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

// ─── colour palette for tag categories ───────────────────────────────────────
const CAT_COLORS = [
  '#F0C040', '#5EE88A', '#60a5fa', '#f472b6',
  '#a78bfa', '#fb923c', '#34d399', '#f87171',
]
const catColor = (idx) => CAT_COLORS[idx % CAT_COLORS.length]

// ─── pill/chip shared style ──────────────────────────────────────────────────
const pill = (color, small) => ({
  display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4,
  padding: small ? '2px 7px' : '3px 9px',
  borderRadius: 100,
  fontSize: small ? '0.68rem' : '0.73rem',
  fontWeight: 600,
  background: color + '22',
  color: color,
  border: `1px solid ${color}44`,
  whiteSpace: 'nowrap',
})

// ─── Dot coloured circle ─────────────────────────────────────────────────────
const Dot = ({ color }) => (
  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
)

// ─── Sign-off banner ──────────────────────────────────────────────────────────
const SOBanner = ({ ok, children }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', borderRadius: 8, marginBottom: 8,
    background: ok ? 'rgba(94,232,138,0.10)' : 'rgba(240,192,64,0.10)',
    border: `1px solid ${ok ? 'rgba(94,232,138,0.25)' : 'rgba(240,192,64,0.25)'}`,
  }}>
    <span style={{ fontSize: '1rem' }}>{ok ? '✅' : '⏳'}</span>
    <div style={{ fontSize: '0.83rem', color: ok ? '#5EE88A' : '#F0C040' }}>{children}</div>
  </div>
)

// ─── Tag chip with optional remove button ─────────────────────────────────────
function TagChip({ tagValueId, categories, tagValues, onRemove }) {
  const tv = tagValues.find(t => t.id === tagValueId)
  if (!tv) return null
  const cat = categories.find(c => c.id === tv.category_id)
  if (!cat) return null
  const color = catColor(categories.indexOf(cat))
  return (
    <span style={pill(color)}>
      <Dot color={color} />
      <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>{cat.name}:</span>
      {tv.value}
      {onRemove && (
        <button onClick={onRemove}
          style={{ background: 'none', border: 'none', color, cursor: 'pointer', padding: '0 0 0 2px', lineHeight: 1, fontSize: '0.8rem' }}>×</button>
      )}
    </span>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// FILE DETAIL MODAL
// ═════════════════════════════════════════════════════════════════════════════
function FileModal({ file, state, currentUser, employees, onClose, onUpdate }) {
  const { folders, categories, tagValues } = state
  const [signoffNote, setSignoffNote] = useState('')
  const [showSignoff, setShowSignoff] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!file) return null

  const folder = folders.find(f => f.id === file.folder_id)
  const adder = employees.find(u => u.id === file.added_by)
  const assignedEmps = employees.filter(u => (file.assigned_to || []).includes(u.id))
  const signoffEmps = employees.filter(u => u.tags_role === 'signoff')
  const alreadySigned = (file.signoffs || []).some(s => s.user_id === currentUser.id)
  const isAssigned = (file.assigned_to || []).includes(currentUser.id)
  const canSignoff = currentUser.tags_role === 'signoff' && isAssigned && !alreadySigned

  const handleSignoff = async () => {
    setSaving(true)
    const newSignoff = { user_id: currentUser.id, timestamp: new Date().toISOString(), note: signoffNote }
    const updatedSignoffs = [...(file.signoffs || []), newSignoff]
    const { data, error } = await supabase
      .from('dde_tag_files')
      .update({ signoffs: updatedSignoffs })
      .eq('id', file.id)
      .select()
      .single()
    setSaving(false)
    if (!error && data) { onUpdate(data); setShowSignoff(false); setSignoffNote('') }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--gold)', marginBottom: 4 }}>{file.name}</div>
            <div style={{ fontSize: '0.73rem', color: 'var(--white-dim)' }}>{folder?.path}/{file.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--white-dim)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Sign-off history */}
        {(file.signoffs || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={sectionLabel}>Sign-off Status</div>
            {(file.signoffs || []).map((so, i) => {
              const su = employees.find(u => u.id === so.user_id)
              return (
                <SOBanner key={i} ok>
                  <strong>Approved by {su?.first_name} {su?.last_name}</strong>
                  <span style={{ opacity: 0.8 }}> · {fmtDate(so.timestamp)}</span>
                  {so.note && <span style={{ display: 'block', marginTop: 2, opacity: 0.8 }}>"{so.note}"</span>}
                </SOBanner>
              )
            })}
          </div>
        )}

        {/* Pending indicator */}
        {(file.assigned_to || []).length > 0 &&
          (file.signoffs || []).length < (file.assigned_to || []).filter(id => employees.find(u => u.id === id)?.tags_role === 'signoff').length && (
            <SOBanner ok={false}>Pending sign-off from assigned reviewers</SOBanner>
          )}

        {/* Tags */}
        <div style={{ marginBottom: 14 }}>
          <div style={sectionLabel}>Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {(file.tag_value_ids || []).length === 0
              ? <span style={{ fontSize: '0.8rem', color: 'var(--white-dim)' }}>No tags assigned</span>
              : (file.tag_value_ids || []).map(tv => (
                <TagChip key={tv} tagValueId={tv} categories={categories} tagValues={tagValues} />
              ))}
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div style={metaCard}>
            <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)', marginBottom: 5 }}>Added by</div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{adder?.first_name} {adder?.last_name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)' }}>{fmtDate(file.created_at)}</div>
          </div>
          <div style={metaCard}>
            <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)', marginBottom: 5 }}>Assigned to</div>
            {assignedEmps.length === 0
              ? <span style={{ fontSize: '0.8rem', color: 'var(--white-dim)' }}>Not assigned</span>
              : assignedEmps.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{u.first_name} {u.last_name}</span>
                  {u.tags_role === 'signoff' && (
                    <span style={pill('#5EE88A', true)}>Sign-off</span>
                  )}
                </div>
              ))}
          </div>
        </div>

        {file.notes && (
          <div style={{ ...metaCard, marginBottom: 14 }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)', marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: '0.83rem', color: 'var(--white-soft)' }}>{file.notes}</div>
          </div>
        )}

        {/* Sign-off action */}
        {canSignoff && !showSignoff && (
          <button className="btn btn-gold" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setShowSignoff(true)}>
            ✅ Sign Off on This File
          </button>
        )}
        {showSignoff && (
          <div style={{ ...metaCard, border: '1px solid rgba(94,232,138,0.3)' }}>
            <div style={{ fontWeight: 600, color: '#5EE88A', marginBottom: 10, fontSize: '0.88rem' }}>Confirm Sign-off</div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Note (optional)</label>
              <textarea className="form-textarea" rows={2} style={{ minHeight: 60 }}
                placeholder="Add a note about your approval..."
                value={signoffNote} onChange={e => setSignoffNote(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-gold btn-sm" onClick={handleSignoff} disabled={saving}>
                {saving ? 'Saving…' : '✅ Confirm'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setShowSignoff(false)}>Cancel</button>
            </div>
          </div>
        )}
        {alreadySigned && (
          <div style={{ ...metaCard, border: '1px solid rgba(94,232,138,0.3)', color: '#5EE88A', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            ✅ You have signed off on this file
          </div>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ADD FILE MODAL
// ═════════════════════════════════════════════════════════════════════════════
function AddFileModal({ state, currentUser, employees, onClose, onAdd }) {
  const { folders, categories, tagValues } = state
  const [form, setForm] = useState({ name: '', folder_id: folders[0]?.id || '', notes: '' })
  const [selTags, setSelTags] = useState([])
  const [selAssign, setSelAssign] = useState([])
  const [saving, setSaving] = useState(false)

  const toggleTag = id => setSelTags(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleAssign = id => setSelAssign(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const handleSubmit = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      name: form.name.trim(),
      added_by: currentUser.id,
      tag_value_ids: selTags,
      assigned_to: selAssign,
      signoffs: [],
    }
    const { data, error } = await supabase.from('dde_tag_files').insert(payload).select().single()
    setSaving(false)
    if (!error && data) { onAdd(data); onClose() }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-title">📎 Add New File</div>

        <div className="form-group">
          <label className="form-label">File Name *</label>
          <input className="form-input" placeholder="e.g. Q4 Report.pdf"
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>

        <div className="form-group">
          <label className="form-label">Folder</label>
          <select className="form-select" value={form.folder_id}
            onChange={e => setForm(f => ({ ...f, folder_id: e.target.value }))}>
            {folders.map(fo => (
              <option key={fo.id} value={fo.id}>{fo.name} — {fo.path}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" rows={2} style={{ minHeight: 60 }}
            placeholder="Optional notes..."
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {/* Tags */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Tags</div>
          {categories.map((cat, ci) => (
            <div key={cat.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: '0.68rem', color: catColor(ci), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
                {cat.name}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {tagValues.filter(tv => tv.category_id === cat.id).map(tv => {
                  const active = selTags.includes(tv.id)
                  const color = catColor(ci)
                  return (
                    <button key={tv.id} onClick={() => toggleTag(tv.id)}
                      style={{ ...pill(color, true), cursor: 'pointer', border: `1px solid ${active ? color + '88' : color + '33'}`, background: active ? color + '33' : 'transparent', transition: 'all 0.15s' }}>
                      {active && '✓ '}{tv.value}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Assign */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Assign To</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {employees.filter(u => u.id !== currentUser.id && u.tags_access).map(u => {
              const active = selAssign.includes(u.id)
              return (
                <button key={u.id} onClick={() => toggleAssign(u.id)}
                  style={{ ...pill(active ? '#F0C040' : 'rgba(255,255,255,0.4)', true), cursor: 'pointer', background: active ? 'rgba(240,192,64,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(240,192,64,0.5)' : 'rgba(255,255,255,0.15)'}`, fontSize: '0.78rem', padding: '4px 10px' }}>
                  {active && '✓ '}{u.first_name} {u.last_name}
                  {u.tags_role === 'signoff' && <span style={{ ...pill('#5EE88A', true), marginLeft: 4, fontSize: '0.6rem' }}>Sign-off</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-gold" onClick={handleSubmit} disabled={saving || !form.name.trim()}>
            {saving ? 'Adding…' : '➕ Add File'}
          </button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN TagsTab COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function TagsTab({ currentUser, employees }) {
  const [innerTab, setInnerTab] = useState('files')
  const [state, setState] = useState({ folders: [], categories: [], tagValues: [], files: [] })
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [showAddFile, setShowAddFile] = useState(false)
  const [search, setSearch] = useState('')
  const [filterFolder, setFilterFolder] = useState('')
  const [filterTags, setFilterTags] = useState({})   // { [catId]: [tvId, …] }
  const [msg, setMsg] = useState(null)

  const isSignoff = currentUser.tags_role === 'signoff'

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: folders }, { data: categories }, { data: tagValues }, { data: files }] = await Promise.all([
      supabase.from('dde_tag_folders').select('*').order('name'),
      supabase.from('dde_tag_categories').select('*').order('sort_order'),
      supabase.from('dde_tag_values').select('*').order('sort_order'),
      supabase.from('dde_tag_files').select('*').order('created_at', { ascending: false }),
    ])
    setState({
      folders: folders || [],
      categories: categories || [],
      tagValues: tagValues || [],
      files: files || [],
    })
    setLoading(false)
  }

  const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000) }

  const updateFileInState = (updated) => {
    setState(s => ({ ...s, files: s.files.map(f => f.id === updated.id ? updated : f) }))
    setSelectedFile(updated)
  }

  const addFileToState = (newFile) => {
    setState(s => ({ ...s, files: [newFile, ...s.files] }))
    showMsg('success', `📎 "${newFile.name}" added!`)
  }

  // ── filter logic ────────────────────────────────────────────────────────────
  const filteredFiles = state.files.filter(f => {
    const q = search.toLowerCase()
    if (q && !f.name.toLowerCase().includes(q)) return false
    if (filterFolder && f.folder_id !== filterFolder) return false
    for (const [catId, tvIds] of Object.entries(filterTags)) {
      if (!tvIds.length) continue
      if (!tvIds.some(tvId => (f.tag_value_ids || []).includes(tvId))) return false
    }
    return true
  })

  const toggleFilterTag = (catId, tvId) => {
    setFilterTags(prev => {
      const cur = prev[catId] || []
      const upd = cur.includes(tvId) ? cur.filter(x => x !== tvId) : [...cur, tvId]
      return { ...prev, [catId]: upd }
    })
  }
  const activeFilterCount = Object.values(filterTags).flat().length

  // ── pending sign-offs for this user ─────────────────────────────────────────
  const pendingSignoffs = isSignoff
    ? state.files.filter(f =>
        (f.assigned_to || []).includes(currentUser.id) &&
        !(f.signoffs || []).some(s => s.user_id === currentUser.id)
      )
    : []

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <div className="spark-loader" style={{ margin: '0 auto' }} />
    </div>
  )

  return (
    <div className="fade-in">
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      {/* Pending sign-off banner */}
      {pendingSignoffs.length > 0 && (
        <div style={{ background: 'rgba(240,192,64,0.12)', border: '1px solid rgba(240,192,64,0.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
          onClick={() => setInnerTab('pending')}>
          <span style={{ fontSize: '1.1rem' }}>⏳</span>
          <span style={{ color: '#F0C040', fontWeight: 600, fontSize: '0.88rem' }}>
            {pendingSignoffs.length} file{pendingSignoffs.length !== 1 ? 's' : ''} awaiting your sign-off — click to review
          </span>
        </div>
      )}

      {/* Inner tab bar */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        {[
          ['files', '📎 Files'],
          ['search', '🔍 Search'],
          ...(isSignoff && pendingSignoffs.length ? [['pending', `⏳ Pending (${pendingSignoffs.length})`]] : []),
        ].map(([t, label]) => (
          <button key={t} className={`tab-btn${innerTab === t ? ' active' : ''}`} onClick={() => setInnerTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── FILES TAB ─────────────────────────────────────────────────────── */}
      {innerTab === 'files' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}>🔍</span>
              <input className="form-input" style={{ paddingLeft: 34 }} placeholder="Search files…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 180 }} value={filterFolder} onChange={e => setFilterFolder(e.target.value)}>
              <option value="">All Folders</option>
              {state.folders.map(fo => <option key={fo.id} value={fo.id}>{fo.name}</option>)}
            </select>
            <button className="btn btn-gold" onClick={() => setShowAddFile(true)}>➕ Add File</button>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📂</div>
              <p>{state.files.length === 0 ? 'No files yet. Click "Add File" to get started.' : 'No files match your search.'}</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Folder</th>
                      <th>Tags</th>
                      <th>Added By</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map(f => {
                      const folder = state.folders.find(fo => fo.id === f.folder_id)
                      const adder = employees.find(u => u.id === f.added_by)
                      const signed = (f.signoffs || []).length > 0
                      const pending = (f.assigned_to || []).length > 0 && !signed
                      return (
                        <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedFile(f)}>
                          <td style={{ fontWeight: 600 }}>📄 {f.name}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--white-dim)' }}>{folder?.name || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 260 }}>
                              {(f.tag_value_ids || []).slice(0, 3).map(tvId => (
                                <TagChip key={tvId} tagValueId={tvId} categories={state.categories} tagValues={state.tagValues} />
                              ))}
                              {(f.tag_value_ids || []).length > 3 && (
                                <span style={{ ...pill('rgba(255,255,255,0.4)', true) }}>+{(f.tag_value_ids || []).length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td style={{ fontSize: '0.83rem' }}>{adder?.first_name} {adder?.last_name}</td>
                          <td>
                            {signed
                              ? <span style={pill('#5EE88A')}>✅ Approved</span>
                              : pending
                                ? <span style={pill('#F0C040')}>⏳ Pending</span>
                                : <span style={{ fontSize: '0.78rem', color: 'var(--white-dim)' }}>—</span>}
                          </td>
                          <td>
                            <button className="btn btn-outline btn-xs"
                              onClick={e => { e.stopPropagation(); setSelectedFile(f) }}>View</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SEARCH TAB ───────────────────────────────────────────────────── */}
      {innerTab === 'search' && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* Filter sidebar */}
          <div style={{ width: 210, flexShrink: 0 }}>
            <div className="card" style={{ padding: '16px 14px', position: 'sticky', top: 80 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={sectionLabel}>Filter by Tags</div>
                {activeFilterCount > 0 && (
                  <button className="btn btn-outline btn-xs" onClick={() => setFilterTags({})}>Clear ({activeFilterCount})</button>
                )}
              </div>
              {state.categories.map((cat, ci) => (
                <div key={cat.id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: '0.67rem', color: catColor(ci), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
                    {cat.name}
                  </div>
                  {state.tagValues.filter(tv => tv.category_id === cat.id).map(tv => {
                    const active = (filterTags[cat.id] || []).includes(tv.id)
                    const color = catColor(ci)
                    return (
                      <div key={tv.id} onClick={() => toggleFilterTag(cat.id, tv.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: 6, cursor: 'pointer', background: active ? color + '18' : 'transparent', marginBottom: 2, transition: 'all 0.15s' }}>
                        <div style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${active ? color : 'rgba(255,255,255,0.25)'}`, background: active ? color : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          {active && <span style={{ fontSize: '0.6rem', color: '#000', lineHeight: 1 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: active ? color : 'var(--white-dim)' }}>{tv.value}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>🔍</span>
                <input className="form-input" style={{ paddingLeft: 36 }} placeholder="Search by file name…"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--white-dim)', marginBottom: 12 }}>
              {filteredFiles.length} file{filteredFiles.length !== 1 ? 's' : ''} found
            </div>
            {filteredFiles.length === 0 ? (
              <div className="empty-state"><div className="icon">🔍</div><p>No files match</p></div>
            ) : filteredFiles.map(f => {
              const folder = state.folders.find(fo => fo.id === f.folder_id)
              const adder = employees.find(u => u.id === f.added_by)
              const signed = (f.signoffs || []).length > 0
              return (
                <div key={f.id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => setSelectedFile(f)}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: '0.95rem' }}>📄</span>
                        <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{f.name}</span>
                        {signed && <span style={pill('#5EE88A', true)}>✅ Approved</span>}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--white-dim)', marginBottom: 8 }}>
                        📁 {folder?.name} · Added by {adder?.first_name} {adder?.last_name} · {fmtDate(f.created_at)}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(f.tag_value_ids || []).map(tvId => (
                          <TagChip key={tvId} tagValueId={tvId} categories={state.categories} tagValues={state.tagValues} />
                        ))}
                      </div>
                    </div>
                    <button className="btn btn-outline btn-xs">View</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── PENDING SIGN-OFF TAB ────────────────────────────────────────────── */}
      {innerTab === 'pending' && (
        <div>
          {pendingSignoffs.length === 0 ? (
            <div className="empty-state"><div className="icon">✅</div><p>All caught up! No pending sign-offs.</p></div>
          ) : pendingSignoffs.map(f => {
            const folder = state.folders.find(fo => fo.id === f.folder_id)
            const adder = employees.find(u => u.id === f.added_by)
            return (
              <div key={f.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', border: '1px solid rgba(240,192,64,0.3)' }}
                onClick={() => setSelectedFile(f)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 4 }}>📄 {f.name}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--white-dim)', marginBottom: 8 }}>
                      📁 {folder?.name} · Added by {adder?.first_name} {adder?.last_name} · {fmtDate(f.created_at)}
                    </div>
                    {f.notes && <div style={{ fontSize: '0.8rem', color: 'var(--white-soft)' }}>{f.notes}</div>}
                  </div>
                  <button className="btn btn-gold btn-sm" onClick={e => { e.stopPropagation(); setSelectedFile(f) }}>
                    ✅ Review
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {selectedFile && (
        <FileModal
          file={selectedFile}
          state={state}
          currentUser={currentUser}
          employees={employees}
          onClose={() => setSelectedFile(null)}
          onUpdate={updateFileInState}
        />
      )}
      {showAddFile && (
        <AddFileModal
          state={state}
          currentUser={currentUser}
          employees={employees}
          onClose={() => setShowAddFile(false)}
          onAdd={addFileToState}
        />
      )}
    </div>
  )
}

// ─── shared mini-styles ───────────────────────────────────────────────────────
const sectionLabel = {
  fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.09em',
  color: 'var(--gold)', marginBottom: 8, fontFamily: 'var(--font-display)',
}

const metaCard = {
  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, padding: '10px 12px',
}
