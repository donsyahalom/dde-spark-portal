/**
 * AdminTagsPanel.jsx
 * Embedded inside AdminPage — lets the admin:
 *   • Grant / revoke tags access to employees
 *   • Set each user's role: viewer | signoff
 *   • Create / delete tag categories (with colour)
 *   • Add / remove tag values within each category
 *   • Create / delete folder paths
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const CAT_COLORS = [
  '#F0C040', '#5EE88A', '#60a5fa', '#f472b6',
  '#a78bfa', '#fb923c', '#34d399', '#f87171',
]

function pill(color, small) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4,
    padding: small ? '2px 7px' : '3px 10px',
    borderRadius: 100, fontSize: small ? '0.68rem' : '0.74rem', fontWeight: 600,
    background: color + '22', color, border: `1px solid ${color}44`,
    whiteSpace: 'nowrap',
  }
}

export default function AdminTagsPanel({ employees, showMsg }) {
  const [categories, setCategories] = useState([])
  const [tagValues, setTagValues] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)

  // form states
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState('#F0C040')
  const [newValInputs, setNewValInputs] = useState({})   // { [catId]: '' }
  const [newFolder, setNewFolder] = useState({ name: '', path: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: cats }, { data: vals }, { data: folds }] = await Promise.all([
      supabase.from('dde_tag_categories').select('*').order('sort_order'),
      supabase.from('dde_tag_values').select('*').order('sort_order'),
      supabase.from('dde_tag_folders').select('*').order('name'),
    ])
    setCategories(cats || [])
    setTagValues(vals || [])
    setFolders(folds || [])
    setLoading(false)
  }

  // ── Tag Categories ──────────────────────────────────────────────────────────
  const addCategory = async () => {
    if (!newCatName.trim()) return
    setSaving(true)
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0)
    const { error } = await supabase.from('dde_tag_categories').insert({
      name: newCatName.trim(), color: newCatColor, sort_order: maxOrder + 1,
    })
    setSaving(false)
    if (error) { showMsg('error', error.message); return }
    setNewCatName(''); fetchAll()
    showMsg('success', `Category "${newCatName.trim()}" created`)
  }

  const deleteCategory = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}" and all its values?`)) return
    await supabase.from('dde_tag_values').delete().eq('category_id', cat.id)
    await supabase.from('dde_tag_categories').delete().eq('id', cat.id)
    fetchAll(); showMsg('success', `Category "${cat.name}" deleted`)
  }

  // ── Tag Values ──────────────────────────────────────────────────────────────
  const addValue = async (catId) => {
    const val = (newValInputs[catId] || '').trim()
    if (!val) return
    setSaving(true)
    const maxOrder = tagValues.filter(tv => tv.category_id === catId).reduce((m, tv) => Math.max(m, tv.sort_order || 0), 0)
    const { error } = await supabase.from('dde_tag_values').insert({
      category_id: catId, value: val, sort_order: maxOrder + 1,
    })
    setSaving(false)
    if (error) { showMsg('error', error.message); return }
    setNewValInputs(prev => ({ ...prev, [catId]: '' }))
    fetchAll()
  }

  const deleteValue = async (tv) => {
    await supabase.from('dde_tag_values').delete().eq('id', tv.id)
    fetchAll()
  }

  // ── Folders ─────────────────────────────────────────────────────────────────
  const addFolder = async () => {
    if (!newFolder.name.trim() || !newFolder.path.trim()) return
    setSaving(true)
    const { error } = await supabase.from('dde_tag_folders').insert({
      name: newFolder.name.trim(), path: newFolder.path.trim(),
    })
    setSaving(false)
    if (error) { showMsg('error', error.message); return }
    setNewFolder({ name: '', path: '' }); fetchAll()
    showMsg('success', `Folder "${newFolder.name.trim()}" added`)
  }

  const deleteFolder = async (fo) => {
    if (!window.confirm(`Remove folder "${fo.name}"? Files in it won't be deleted.`)) return
    await supabase.from('dde_tag_folders').delete().eq('id', fo.id)
    fetchAll(); showMsg('success', `Folder "${fo.name}" removed`)
  }

  // ── User Access ─────────────────────────────────────────────────────────────
  const setTagsAccess = async (emp, granted) => {
    const patch = granted
      ? { tags_access: true, tags_role: 'viewer' }
      : { tags_access: false, tags_role: null }
    const { error } = await supabase.from('employees').update(patch).eq('id', emp.id)
    if (error) showMsg('error', error.message)
    else showMsg('success', `${emp.first_name} ${emp.last_name} — tags ${granted ? 'enabled' : 'disabled'}`)
  }

  const setTagsRole = async (emp, role) => {
    const { error } = await supabase.from('employees').update({ tags_role: role }).eq('id', emp.id)
    if (error) showMsg('error', error.message)
    else showMsg('success', `${emp.first_name} ${emp.last_name} — role set to ${role}`)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spark-loader" style={{ margin: '0 auto' }} /></div>

  const nonAdminEmps = employees.filter(e => !e.is_admin)

  return (
    <div>
      {/* ── USER ACCESS ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span className="icon">🏷️</span> Tags User Access</div>
        <p style={{ color: 'var(--white-dim)', fontSize: '0.82rem', marginBottom: 16 }}>
          Grant employees access to the Tags feature. Sign-off users can approve files; viewers can only add files and tags.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg-darker)', zIndex: 2 }}>Employee</th>
                <th>Tags Access</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {nonAdminEmps.map(emp => {
                const hasAccess = !!emp.tags_access
                const role = emp.tags_role || 'viewer'
                return (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'rgba(17,46,28,0.97)', zIndex: 1 }}>
                      {emp.first_name} {emp.last_name}
                      <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)' }}>{emp.job_title || ''}</div>
                    </td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={hasAccess}
                          onChange={e => setTagsAccess(emp, e.target.checked)}
                          style={{ accentColor: 'var(--gold)', width: 16, height: 16 }} />
                        <span style={{ fontSize: '0.82rem', color: hasAccess ? 'var(--green-bright)' : 'var(--white-dim)' }}>
                          {hasAccess ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </td>
                    <td>
                      {hasAccess ? (
                        <select className="form-select" style={{ width: 130, padding: '5px 10px', fontSize: '0.8rem' }}
                          value={role} onChange={e => setTagsRole(emp, e.target.value)}>
                          <option value="viewer">Viewer</option>
                          <option value="signoff">Sign-off</option>
                        </select>
                      ) : (
                        <span style={{ color: 'var(--white-dim)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── TAG CATEGORIES ────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><span className="icon">🏷️</span> Tag Categories & Values</div>
        <p style={{ color: 'var(--white-dim)', fontSize: '0.82rem', marginBottom: 16 }}>
          Create tag categories (e.g. Department, Status) and add values to each.
        </p>

        {/* Add new category */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
            <label className="form-label">New Category Name</label>
            <input className="form-input" placeholder="e.g. Department, Priority…"
              value={newCatName} onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCategory()} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Color</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CAT_COLORS.map(c => (
                <div key={c} onClick={() => setNewCatColor(c)}
                  style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', border: `2px solid ${newCatColor === c ? '#fff' : 'transparent'}`, boxShadow: newCatColor === c ? `0 0 0 2px ${c}` : 'none', transition: 'all 0.15s' }} />
              ))}
            </div>
          </div>
          <button className="btn btn-gold btn-sm" onClick={addCategory} disabled={saving || !newCatName.trim()}>
            {saving ? '…' : '+ Add Category'}
          </button>
        </div>

        {/* Existing categories */}
        {categories.length === 0 && (
          <div className="empty-state" style={{ padding: '20px 0' }}><p>No tag categories yet</p></div>
        )}
        {categories.map((cat, ci) => {
          const color = cat.color || CAT_COLORS[ci % CAT_COLORS.length]
          const vals = tagValues.filter(tv => tv.category_id === cat.id)
          return (
            <div key={cat.id} style={{ marginBottom: 14, background: 'rgba(0,0,0,0.2)', border: `1px solid ${color}33`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color }}>{cat.name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--white-dim)' }}>{vals.length} values</span>
                </div>
                <button onClick={() => deleteCategory(cat)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--white-dim)', fontSize: '1rem', padding: '2px 6px', borderRadius: 4 }}
                  onMouseEnter={e => e.target.style.color = 'var(--red)'}
                  onMouseLeave={e => e.target.style.color = 'var(--white-dim)'}>×</button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                {vals.map(tv => (
                  <span key={tv.id} style={pill(color)}>
                    {tv.value}
                    <button onClick={() => deleteValue(tv)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color, lineHeight: 1, fontSize: '0.8rem', padding: '0 0 0 2px' }}>×</button>
                  </span>
                ))}
                {vals.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--white-dim)' }}>No values yet</span>}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" style={{ flex: 1, maxWidth: 260, padding: '6px 10px', fontSize: '0.82rem' }}
                  placeholder={`Add a ${cat.name} value…`}
                  value={newValInputs[cat.id] || ''}
                  onChange={e => setNewValInputs(p => ({ ...p, [cat.id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addValue(cat.id)} />
                <button className="btn btn-outline btn-sm" onClick={() => addValue(cat.id)}
                  disabled={!(newValInputs[cat.id] || '').trim()}>
                  + Add
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── FOLDERS ───────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title"><span className="icon">📁</span> Folder Paths</div>
        <p style={{ color: 'var(--white-dim)', fontSize: '0.82rem', marginBottom: 16 }}>
          Register shared folder locations so users can associate files with a path.
        </p>

        {folders.map(fo => (
          <div key={fo.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
            <span style={{ fontSize: '1rem' }}>📁</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{fo.name}</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.73rem', color: 'var(--white-dim)' }}>{fo.path}</div>
            </div>
            <button onClick={() => deleteFolder(fo)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--white-dim)', fontSize: '1.1rem', padding: '2px 6px', borderRadius: 4 }}
              onMouseEnter={e => e.target.style.color = 'var(--red)'}
              onMouseLeave={e => e.target.style.color = 'var(--white-dim)'}>×</button>
          </div>
        ))}
        {folders.length === 0 && (
          <div className="empty-state" style={{ padding: '16px 0' }}><p>No folders registered yet</p></div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <label className="form-label">Display Name</label>
            <input className="form-input" placeholder="Engineering Docs"
              value={newFolder.name} onChange={e => setNewFolder(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: 2, minWidth: 200 }}>
            <label className="form-label">Path (local or network)</label>
            <input className="form-input" placeholder={`C:/Shared/Engineering  or  \\\\Server01\\Docs`}
              value={newFolder.path} onChange={e => setNewFolder(f => ({ ...f, path: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 0 }}>
            <button className="btn btn-gold btn-sm" onClick={addFolder}
              disabled={saving || !newFolder.name.trim() || !newFolder.path.trim()}>
              {saving ? '…' : '+ Add Folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
