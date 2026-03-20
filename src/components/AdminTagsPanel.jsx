/**
 * AdminTagsPanel.jsx  — v2
 * Real-time Supabase subscriptions keep every section live.
 * Features:
 *   • Optimistic updates + realtime channel refresh
 *   • Tag value metadata: official_name, address, company_name (OCR hints)
 *   • Tag values restricted by role (any | viewer | signoff)
 *   • Auto-apply flag (e.g. "Status: Added" applied on every new file)
 *   • Folder browse button (File System Access API + fallback)
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const CAT_COLORS = ['#F0C040','#5EE88A','#60a5fa','#f472b6','#a78bfa','#fb923c','#34d399','#f87171']

const pill = (color, sm) => ({
  display:'inline-flex', alignItems:'center', gap: sm?3:4,
  padding: sm?'2px 7px':'3px 10px', borderRadius:100,
  fontSize: sm?'0.68rem':'0.74rem', fontWeight:600,
  background: color+'22', color, border:`1px solid ${color}44`, whiteSpace:'nowrap',
})

const SH = ({children, style={}}) => (
  <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:'0.09em',
    color:'var(--gold)',marginBottom:8,fontFamily:'var(--font-display)',...style}}>
    {children}
  </div>
)

// ─── Tag value metadata / OCR hints modal ─────────────────────────────────────
function TagValueMetaModal({ tv, catName, catColor, onSave, onClose }) {
  const [meta, setMeta] = useState({
    official_name:    tv.official_name    || '',
    address:          tv.address          || '',
    company_name:     tv.company_name     || '',
    role_restriction: tv.role_restriction || 'any',
    auto_apply:       !!tv.auto_apply,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const { data, error } = await supabase
      .from('dde_tag_values').update(meta).eq('id', tv.id).select().single()
    setSaving(false)
    if (!error && data) onSave(data)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:500, marginTop:80}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
          <div>
            <div style={{fontFamily:'var(--font-display)',fontSize:'1rem',color:catColor}}>
              {catName}: {tv.value}
            </div>
            <div style={{fontSize:'0.73rem',color:'var(--white-dim)',marginTop:2}}>Edit details &amp; OCR matching rules</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--white-dim)',fontSize:'1.4rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        {/* OCR hints section */}
        <div style={{background:'rgba(240,192,64,0.07)',border:'1px solid rgba(240,192,64,0.22)',borderRadius:10,padding:'14px 16px',marginBottom:14}}>
          <SH>🔍 OCR Suggestion Hints</SH>
          <p style={{fontSize:'0.75rem',color:'var(--white-dim)',marginBottom:12,lineHeight:1.6}}>
            When a user runs OCR on a document, these fields are matched against the extracted text
            to automatically suggest this tag. Use the exact names that appear on invoices or bills.
          </p>
          <div className="form-group" style={{marginBottom:10}}>
            <label className="form-label">Official Name</label>
            <input className="form-input" placeholder="e.g. Trinity Construction LLC"
              value={meta.official_name} onChange={e=>setMeta(m=>({...m,official_name:e.target.value}))} />
            <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginTop:3}}>Full legal name as it appears on invoices / contracts</div>
          </div>
          <div className="form-group" style={{marginBottom:10}}>
            <label className="form-label">Physical / Job-site Address</label>
            <input className="form-input" placeholder="e.g. 1234 Main St, Dallas TX 75201"
              value={meta.address} onChange={e=>setMeta(m=>({...m,address:e.target.value}))} />
            <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginTop:3}}>When OCR finds this address on a bill, this tag is suggested</div>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">Company / Vendor Name</label>
            <input className="form-input" placeholder="e.g. Acme Electrical Supply"
              value={meta.company_name} onChange={e=>setMeta(m=>({...m,company_name:e.target.value}))} />
            <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginTop:3}}>Vendor name on invoices — links bills to this tag value</div>
          </div>
        </div>

        {/* Access & behaviour */}
        <div style={{background:'rgba(94,232,138,0.06)',border:'1px solid rgba(94,232,138,0.2)',borderRadius:10,padding:'14px 16px',marginBottom:18}}>
          <SH>⚙️ Access &amp; Behaviour</SH>
          <div className="form-group" style={{marginBottom:12}}>
            <label className="form-label">Who can apply this tag?</label>
            <select className="form-select" value={meta.role_restriction}
              onChange={e=>setMeta(m=>({...m,role_restriction:e.target.value}))}>
              <option value="any">Anyone with Tags access</option>
              <option value="signoff">Sign-off users only (e.g. Status: Approved)</option>
              <option value="viewer">Viewer users only</option>
            </select>
          </div>
          <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
            <input type="checkbox" checked={meta.auto_apply}
              onChange={e=>setMeta(m=>({...m,auto_apply:e.target.checked}))}
              style={{accentColor:'var(--gold)',marginTop:2,width:16,height:16,flexShrink:0}} />
            <div>
              <div style={{fontSize:'0.85rem',fontWeight:600}}>⚡ Auto-apply when a file is added</div>
              <div style={{fontSize:'0.72rem',color:'var(--white-dim)',marginTop:3,lineHeight:1.5}}>
                This tag is added automatically every time a user creates a new file record.
                Use for "Status: Added", "Status: Draft", etc.
              </div>
            </div>
          </label>
        </div>

        <div style={{display:'flex',gap:10}}>
          <button className="btn btn-gold" onClick={handleSave} disabled={saving}>{saving?'Saving…':'💾 Save Changes'}</button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
export default function AdminTagsPanel({ employees: propEmployees, showMsg }) {
  const [categories,  setCategories]  = useState([])
  const [tagValues,   setTagValues]   = useState([])
  const [folders,     setFolders]     = useState([])
  const [employees,   setEmployees]   = useState(propEmployees || [])
  const [loading,     setLoading]     = useState(true)
  const [newCatName,  setNewCatName]  = useState('')
  const [newCatColor, setNewCatColor] = useState('#F0C040')
  const [newValInputs,setNewValInputs]= useState({})
  const [newFolder,   setNewFolder]   = useState({ name:'', path:'' })
  const [saving,      setSaving]      = useState(false)
  const [editingMeta, setEditingMeta] = useState(null)

  // ── realtime + initial load ───────────────────────────────────────────────
  useEffect(() => {
    fetchAll()
    const ch = supabase.channel('admin-tags-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'dde_tag_categories'}, fetchCategories)
      .on('postgres_changes',{event:'*',schema:'public',table:'dde_tag_values'},     fetchValues)
      .on('postgres_changes',{event:'*',schema:'public',table:'dde_tag_folders'},    fetchFolders)
      .on('postgres_changes',{event:'*',schema:'public',table:'employees'},          fetchEmployees)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  useEffect(() => { if (propEmployees?.length) setEmployees(propEmployees) }, [propEmployees])

  const fetchAll       = async () => { setLoading(true); await Promise.all([fetchCategories(),fetchValues(),fetchFolders(),fetchEmployees()]); setLoading(false) }
  const fetchCategories= async () => { const {data}=await supabase.from('dde_tag_categories').select('*').order('sort_order'); if(data) setCategories(data) }
  const fetchValues    = async () => { const {data}=await supabase.from('dde_tag_values').select('*').order('sort_order'); if(data) setTagValues(data) }
  const fetchFolders   = async () => { const {data}=await supabase.from('dde_tag_folders').select('*').order('name'); if(data) setFolders(data) }
  const fetchEmployees = async () => {
    const {data}=await supabase.from('employees').select('id,first_name,last_name,job_title,is_admin,tags_access,tags_role').eq('is_admin',false).order('last_name')
    if(data) setEmployees(data)
  }

  // ── categories ────────────────────────────────────────────────────────────
  const addCategory = async () => {
    if (!newCatName.trim()) return
    setSaving(true)
    const maxOrder = categories.reduce((m,c)=>Math.max(m,c.sort_order||0),0)
    const optimistic = {id:'tmp-'+Date.now(),name:newCatName.trim(),color:newCatColor,sort_order:maxOrder+1}
    setCategories(p=>[...p,optimistic])
    const {error} = await supabase.from('dde_tag_categories').insert({name:optimistic.name,color:optimistic.color,sort_order:optimistic.sort_order})
    setSaving(false)
    if (error) { setCategories(p=>p.filter(c=>c.id!==optimistic.id)); showMsg('error',error.message); return }
    setNewCatName('')
    showMsg('success',`Category "${optimistic.name}" created`)
    fetchCategories()
  }

  const deleteCategory = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}" and all its values?`)) return
    setCategories(p=>p.filter(c=>c.id!==cat.id))
    setTagValues(p=>p.filter(tv=>tv.category_id!==cat.id))
    await supabase.from('dde_tag_values').delete().eq('category_id',cat.id)
    await supabase.from('dde_tag_categories').delete().eq('id',cat.id)
    showMsg('success',`Category "${cat.name}" deleted`)
  }

  // ── values ────────────────────────────────────────────────────────────────
  const addValue = async (catId) => {
    const val = (newValInputs[catId]||'').trim()
    if (!val) return
    setSaving(true)
    const maxOrder = tagValues.filter(tv=>tv.category_id===catId).reduce((m,tv)=>Math.max(m,tv.sort_order||0),0)
    const optimistic = {id:'tmp-'+Date.now(),category_id:catId,value:val,sort_order:maxOrder+1,role_restriction:'any',auto_apply:false}
    setTagValues(p=>[...p,optimistic])
    const {error} = await supabase.from('dde_tag_values').insert({category_id:catId,value:val,sort_order:maxOrder+1,role_restriction:'any',auto_apply:false})
    setSaving(false)
    if (error) { setTagValues(p=>p.filter(tv=>tv.id!==optimistic.id)); showMsg('error',error.message); return }
    setNewValInputs(p=>({...p,[catId]:''}))
    fetchValues()
  }

  const deleteValue = async (tv) => {
    setTagValues(p=>p.filter(t=>t.id!==tv.id))
    await supabase.from('dde_tag_values').delete().eq('id',tv.id)
  }

  const handleMetaSaved = (updated) => {
    setTagValues(p=>p.map(tv=>tv.id===updated.id?updated:tv))
    setEditingMeta(null)
    showMsg('success','Tag details saved')
  }

  // ── folders ───────────────────────────────────────────────────────────────
  const addFolder = async () => {
    if (!newFolder.name.trim()||!newFolder.path.trim()) return
    setSaving(true)
    const optimistic = {id:'tmp-'+Date.now(),...newFolder}
    setFolders(p=>[...p,optimistic].sort((a,b)=>a.name.localeCompare(b.name)))
    const {error} = await supabase.from('dde_tag_folders').insert({name:newFolder.name.trim(),path:newFolder.path.trim()})
    setSaving(false)
    if (error) { setFolders(p=>p.filter(f=>f.id!==optimistic.id)); showMsg('error',error.message); return }
    setNewFolder({name:'',path:''})
    showMsg('success',`Folder "${newFolder.name.trim()}" added`)
    fetchFolders()
  }

  const deleteFolder = async (fo) => {
    if (!window.confirm(`Remove folder "${fo.name}"? Files in it won't be deleted.`)) return
    setFolders(p=>p.filter(f=>f.id!==fo.id))
    await supabase.from('dde_tag_folders').delete().eq('id',fo.id)
    showMsg('success',`Folder "${fo.name}" removed`)
  }

  const browseFolder = async () => {
    try {
      if (window.showDirectoryPicker) {
        const dir = await window.showDirectoryPicker({ mode:'read' })
        setNewFolder(f=>({ ...f, path: dir.name, name: f.name||dir.name }))
      } else {
        const input = document.createElement('input')
        input.type='file'; input.webkitdirectory=true; input.multiple=true
        input.onchange = () => {
          if (input.files.length>0) {
            const fullPath = input.files[0].webkitRelativePath || input.files[0].name
            const dir = fullPath.split('/')[0] || input.files[0].name
            setNewFolder(f=>({ ...f, path: dir, name: f.name||dir }))
          }
        }
        input.click()
      }
    } catch(e) { /* user cancelled */ }
  }

  // ── user access ───────────────────────────────────────────────────────────
  const setTagsAccess = async (emp, granted) => {
    const patch = granted ? {tags_access:true,tags_role:'viewer'} : {tags_access:false,tags_role:null}
    setEmployees(p=>p.map(e=>e.id===emp.id?{...e,...patch}:e))
    const {error} = await supabase.from('employees').update(patch).eq('id',emp.id)
    if (error) { setEmployees(p=>p.map(e=>e.id===emp.id?emp:e)); showMsg('error',error.message) }
    else showMsg('success',`${emp.first_name} ${emp.last_name} — File Tags ${granted?'enabled':'disabled'}`)
  }

  const setTagsRole = async (emp, role) => {
    setEmployees(p=>p.map(e=>e.id===emp.id?{...e,tags_role:role}:e))
    const {error} = await supabase.from('employees').update({tags_role:role}).eq('id',emp.id)
    if (error) showMsg('error',error.message)
    else showMsg('success',`${emp.first_name} ${emp.last_name} — role: ${role}`)
  }

  if (loading) return <div style={{textAlign:'center',padding:'40px 0'}}><div className="spark-loader" style={{margin:'0 auto'}} /></div>

  const nonAdminEmps = employees.filter(e=>!e.is_admin)
  const enabledCount = nonAdminEmps.filter(e=>e.tags_access).length

  return (
    <div>
      {/* ── USER ACCESS ──────────────────────────────────────────── */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">
          <span className="icon">👥</span> File Tags — User Access
          <span style={{fontSize:'0.72rem',color:'var(--white-dim)',fontFamily:'var(--font-body)',fontWeight:400,marginLeft:8,textTransform:'none',letterSpacing:0}}>
            {enabledCount} / {nonAdminEmps.length} enabled
          </span>
        </div>
        <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:14}}>
          Grant employees access to the File Tags feature.&nbsp;
          <span style={{color:'#5EE88A',fontWeight:600}}>Sign-off</span> users can approve files and apply restricted tags.&nbsp;
          <span style={{color:'#60a5fa',fontWeight:600}}>Viewers</span> can add and tag files.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{position:'sticky',left:0,background:'var(--bg-darker)',zIndex:2}}>Employee</th>
                <th>File Tags Access</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {nonAdminEmps.map(emp=>{
                const hasAccess = !!emp.tags_access
                const role = emp.tags_role||'viewer'
                return (
                  <tr key={emp.id}>
                    <td style={{fontWeight:600,whiteSpace:'nowrap',position:'sticky',left:0,background:'rgba(17,46,28,0.97)',zIndex:1}}>
                      {emp.first_name} {emp.last_name}
                      {emp.job_title && <div style={{fontSize:'0.72rem',color:'var(--white-dim)'}}>{emp.job_title}</div>}
                    </td>
                    <td>
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                        <input type="checkbox" checked={hasAccess}
                          onChange={e=>setTagsAccess(emp,e.target.checked)}
                          style={{accentColor:'var(--gold)',width:16,height:16}} />
                        <span style={{fontSize:'0.82rem',color:hasAccess?'var(--green-bright)':'var(--white-dim)'}}>
                          {hasAccess?'Enabled':'Disabled'}
                        </span>
                      </label>
                    </td>
                    <td>
                      {hasAccess ? (
                        <select className="form-select" style={{width:130,padding:'5px 10px',fontSize:'0.8rem'}}
                          value={role} onChange={e=>setTagsRole(emp,e.target.value)}>
                          <option value="viewer">Viewer</option>
                          <option value="signoff">Sign-off</option>
                        </select>
                      ) : <span style={{color:'var(--white-dim)',fontSize:'0.8rem'}}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── TAG CATEGORIES & VALUES ───────────────────────────────── */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title"><span className="icon">🏷️</span> Tag Categories &amp; Values</div>
        <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:16}}>
          Create categories (Job, Vendor, Status…) and add values. Click&nbsp;
          <strong style={{color:'var(--gold)'}}>⚙</strong> on any value to add OCR hints, addresses, role restrictions, and auto-apply rules.
        </p>

        {/* Add category */}
        <div style={{display:'flex',gap:10,alignItems:'flex-end',marginBottom:20,flexWrap:'wrap',
          background:'rgba(0,0,0,0.15)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px'}}>
          <div className="form-group" style={{marginBottom:0,flex:1,minWidth:160}}>
            <label className="form-label">New Category Name</label>
            <input className="form-input" placeholder="e.g. Job, Vendor, Status…"
              value={newCatName} onChange={e=>setNewCatName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addCategory()} />
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">Color</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {CAT_COLORS.map(c=>(
                <div key={c} onClick={()=>setNewCatColor(c)}
                  style={{width:26,height:26,borderRadius:'50%',background:c,cursor:'pointer',
                    border:`2px solid ${newCatColor===c?'#fff':'transparent'}`,
                    boxShadow:newCatColor===c?`0 0 0 2px ${c}`:'none',transition:'all 0.15s'}} />
              ))}
            </div>
          </div>
          <button className="btn btn-gold btn-sm" onClick={addCategory} disabled={saving||!newCatName.trim()}>
            {saving?'…':'+ Add Category'}
          </button>
        </div>

        {categories.length===0 && <div className="empty-state" style={{padding:'20px 0'}}><p>No tag categories yet</p></div>}

        {categories.map((cat,ci)=>{
          const color = cat.color||CAT_COLORS[ci%CAT_COLORS.length]
          const vals = tagValues.filter(tv=>tv.category_id===cat.id)
          return (
            <div key={cat.id} style={{marginBottom:14,background:'rgba(0,0,0,0.2)',
              border:`1px solid ${color}33`,borderRadius:10,padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:12,height:12,borderRadius:'50%',background:color}} />
                  <span style={{fontWeight:700,fontSize:'0.9rem',color}}>{cat.name}</span>
                  <span style={{fontSize:'0.7rem',color:'var(--white-dim)'}}>{vals.length} value{vals.length!==1?'s':''}</span>
                </div>
                <button onClick={()=>deleteCategory(cat)}
                  style={{background:'none',border:'none',cursor:'pointer',color:'var(--white-dim)',fontSize:'1rem',padding:'2px 6px',borderRadius:4}}
                  onMouseEnter={e=>e.target.style.color='var(--red)'}
                  onMouseLeave={e=>e.target.style.color='var(--white-dim)'}>×</button>
              </div>

              {/* Values */}
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
                {vals.map(tv=>{
                  const hasOcr = tv.official_name||tv.address||tv.company_name
                  const restricted = tv.role_restriction && tv.role_restriction!=='any'
                  return (
                    <div key={tv.id} style={{display:'inline-flex',alignItems:'center',
                      background:color+'18',border:`1px solid ${color}44`,borderRadius:100,
                      paddingLeft:10,paddingRight:3,paddingTop:3,paddingBottom:3,gap:2}}>
                      <span style={{fontSize:'0.78rem',fontWeight:600,color,marginRight:3}}>{tv.value}</span>
                      {hasOcr   && <span title="Has OCR hints"              style={{fontSize:'0.62rem'}}>🔍</span>}
                      {tv.auto_apply && <span title="Auto-applied on file add" style={{fontSize:'0.62rem'}}>⚡</span>}
                      {restricted && (
                        <span style={{...pill(tv.role_restriction==='signoff'?'#5EE88A':'#60a5fa',true),
                          fontSize:'0.58rem',padding:'1px 5px',marginLeft:2}}>
                          {tv.role_restriction==='signoff'?'Sign-off':'Viewer'}
                        </span>
                      )}
                      <button onClick={()=>setEditingMeta({tv,cat,color})} title="Edit details / OCR hints"
                        style={{background:'none',border:'none',cursor:'pointer',color,
                          fontSize:'0.78rem',padding:'1px 5px',lineHeight:1,borderRadius:100,opacity:0.75}}
                        onMouseEnter={e=>e.target.style.opacity='1'}
                        onMouseLeave={e=>e.target.style.opacity='0.75'}>⚙</button>
                      <button onClick={()=>deleteValue(tv)}
                        style={{background:'none',border:'none',cursor:'pointer',color,
                          fontSize:'0.88rem',padding:'1px 6px',lineHeight:1,borderRadius:100,opacity:0.6}}
                        onMouseEnter={e=>e.target.style.opacity='1'}
                        onMouseLeave={e=>e.target.style.opacity='0.6'}>×</button>
                    </div>
                  )
                })}
                {vals.length===0 && <span style={{fontSize:'0.78rem',color:'var(--white-dim)'}}>No values yet</span>}
              </div>

              {/* Add value */}
              <div style={{display:'flex',gap:8}}>
                <input className="form-input" style={{flex:1,maxWidth:280,padding:'6px 10px',fontSize:'0.82rem'}}
                  placeholder={`Add a ${cat.name} value…`}
                  value={newValInputs[cat.id]||''}
                  onChange={e=>setNewValInputs(p=>({...p,[cat.id]:e.target.value}))}
                  onKeyDown={e=>e.key==='Enter'&&addValue(cat.id)} />
                <button className="btn btn-outline btn-sm" onClick={()=>addValue(cat.id)}
                  disabled={!(newValInputs[cat.id]||'').trim()}>+ Add</button>
              </div>

              {/* Legend */}
              <div style={{marginTop:8,fontSize:'0.67rem',color:'var(--white-dim)',opacity:0.8}}>
                ⚙ edit &nbsp;·&nbsp; 🔍 OCR hint &nbsp;·&nbsp; ⚡ auto-applied &nbsp;·&nbsp;
                <span style={{color:'#5EE88A'}}>Sign-off</span> = sign-off restricted &nbsp;·&nbsp;
                <span style={{color:'#60a5fa'}}>Viewer</span> = viewer restricted
              </div>
            </div>
          )
        })}
      </div>

      {/* ── FOLDERS ──────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title"><span className="icon">📁</span> Folder Paths</div>
        <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:16}}>
          Register shared folder locations. Users can browse these folders and add files.
          Company / vendor names on tag values help OCR match invoices to the right folder.
        </p>

        {folders.map(fo=>(
          <div key={fo.id} style={{display:'flex',alignItems:'center',gap:10,
            background:'rgba(0,0,0,0.2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',marginBottom:8}}>
            <span>📁</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:'0.88rem'}}>{fo.name}</div>
              <div style={{fontFamily:'monospace',fontSize:'0.73rem',color:'var(--white-dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fo.path}</div>
            </div>
            <button onClick={()=>deleteFolder(fo)}
              style={{background:'none',border:'none',cursor:'pointer',color:'var(--white-dim)',fontSize:'1.1rem',padding:'2px 6px',borderRadius:4,flexShrink:0}}
              onMouseEnter={e=>e.target.style.color='var(--red)'}
              onMouseLeave={e=>e.target.style.color='var(--white-dim)'}>×</button>
          </div>
        ))}
        {folders.length===0 && <div className="empty-state" style={{padding:'16px 0'}}><p>No folders registered yet</p></div>}

        <div style={{marginTop:16,background:'rgba(0,0,0,0.15)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px'}}>
          <SH>Add New Folder</SH>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
            <div className="form-group" style={{marginBottom:0,flex:1,minWidth:140}}>
              <label className="form-label">Display Name</label>
              <input className="form-input" placeholder="e.g. Accounts Payable"
                value={newFolder.name} onChange={e=>setNewFolder(f=>({...f,name:e.target.value}))} />
            </div>
            <div className="form-group" style={{marginBottom:0,flex:2,minWidth:200}}>
              <label className="form-label">Path</label>
              <div style={{display:'flex',gap:6}}>
                <input className="form-input" style={{flex:1}}
                  placeholder={`C:\\Shared\\AP  or  \\\\Server01\\Docs`}
                  value={newFolder.path} onChange={e=>setNewFolder(f=>({...f,path:e.target.value}))} />
                <button className="btn btn-outline btn-sm" onClick={browseFolder}
                  title="Browse for folder" style={{flexShrink:0,whiteSpace:'nowrap'}}>
                  📂 Browse
                </button>
              </div>
              <div style={{fontSize:'0.68rem',color:'var(--white-dim)',marginTop:3}}>
                Browse uses your OS folder picker where supported. You can also type the path directly.
              </div>
            </div>
          </div>
          <button className="btn btn-gold btn-sm" onClick={addFolder}
            disabled={saving||!newFolder.name.trim()||!newFolder.path.trim()}>
            {saving?'…':'+ Add Folder'}
          </button>
        </div>
      </div>

      {/* ── META MODAL ────────────────────────────────────────────── */}
      {editingMeta && (
        <TagValueMetaModal
          tv={editingMeta.tv}
          catName={editingMeta.cat.name}
          catColor={editingMeta.color}
          onSave={handleMetaSaved}
          onClose={()=>setEditingMeta(null)}
        />
      )}
    </div>
  )
}
