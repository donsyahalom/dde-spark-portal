/**
 * AdminTagsPanel.jsx — v3
 * Changes from v2:
 *   • User Access section collapsed by default, expandable
 *   • Tag categories and values can be reordered via ▲▼ buttons
 *   • Folder list shows full path prominently under display name
 *   • addValue() no longer inserts auto_apply/role_restriction (avoids schema-cache error);
 *     those fields are only written via the ⚙ meta modal (update path)
 *   • Folder delete prompts to also delete associated file records
 *   • All realtime / optimistic patterns retained from v2
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const CAT_COLORS = ['#F0C040','#5EE88A','#60a5fa','#f472b6','#a78bfa','#fb923c','#34d399','#f87171']

const pill = (color, sm) => ({
  display:'inline-flex', alignItems:'center', gap:sm?3:4,
  padding:sm?'2px 7px':'3px 10px', borderRadius:100,
  fontSize:sm?'0.68rem':'0.74rem', fontWeight:600,
  background:color+'22', color, border:`1px solid ${color}44`, whiteSpace:'nowrap',
})

const SH = ({children, style={}}) => (
  <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:'0.09em',
    color:'var(--gold)',marginBottom:8,fontFamily:'var(--font-display)',...style}}>
    {children}
  </div>
)

const IconBtn = ({onClick, title, children, danger}) => (
  <button onClick={onClick} title={title}
    style={{background:'none',border:'none',cursor:'pointer',padding:'2px 5px',
      borderRadius:4,lineHeight:1,color:danger?'var(--red)':'var(--white-dim)',fontSize:'0.9rem'}}
    onMouseEnter={e=>{e.currentTarget.style.color=danger?'#ff6b6b':'var(--white-soft)'}}
    onMouseLeave={e=>{e.currentTarget.style.color=danger?'var(--red)':'var(--white-dim)'}}>
    {children}
  </button>
)

// ─── Tag value ⚙ metadata modal ───────────────────────────────────────────────
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
    // Use only explicit column list to avoid schema-cache issues
    const { data, error } = await supabase
      .from('dde_tag_values')
      .update({
        official_name:    meta.official_name    || null,
        address:          meta.address          || null,
        company_name:     meta.company_name     || null,
        role_restriction: meta.role_restriction,
        auto_apply:       meta.auto_apply,
      })
      .eq('id', tv.id)
      .select('id,category_id,value,sort_order,official_name,address,company_name,role_restriction,auto_apply')
      .single()
    setSaving(false)
    if (!error && data) onSave(data)
    else if (error) console.error('TagValueMeta save error:', error)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:500,marginTop:100}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
          <div>
            <div style={{fontFamily:'var(--font-display)',fontSize:'1rem',color:catColor}}>{catName}: {tv.value}</div>
            <div style={{fontSize:'0.73rem',color:'var(--white-dim)',marginTop:2}}>Edit details &amp; OCR matching rules</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--white-dim)',fontSize:'1.4rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        <div style={{background:'rgba(240,192,64,0.07)',border:'1px solid rgba(240,192,64,0.22)',borderRadius:10,padding:'14px 16px',marginBottom:14}}>
          <SH>🔍 OCR Suggestion Hints</SH>
          <p style={{fontSize:'0.75rem',color:'var(--white-dim)',marginBottom:12,lineHeight:1.6}}>
            These fields are matched against scanned document text to automatically suggest this tag.
            Use the exact text that appears on invoices or bills.
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

        <div style={{background:'rgba(94,232,138,0.06)',border:'1px solid rgba(94,232,138,0.2)',borderRadius:10,padding:'14px 16px',marginBottom:18}}>
          <SH>⚙️ Access &amp; Behaviour</SH>
          <div className="form-group" style={{marginBottom:12}}>
            <label className="form-label">Who can apply this tag?</label>
            <select className="form-select" value={meta.role_restriction}
              onChange={e=>setMeta(m=>({...m,role_restriction:e.target.value}))}>
              <option value="any">Anyone with File Tags access</option>
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
  const [categories,    setCategories]    = useState([])
  const [tagValues,     setTagValues]     = useState([])
  const [folders,       setFolders]       = useState([])
  const [employees,     setEmployees]     = useState(propEmployees || [])
  const [loading,       setLoading]       = useState(true)
  const [userAccExpand, setUserAccExpand] = useState(false)  // collapsed by default
  const [newCatName,    setNewCatName]    = useState('')
  const [newCatColor,   setNewCatColor]   = useState('#F0C040')
  const [newValInputs,  setNewValInputs]  = useState({})
  const [newFolder,     setNewFolder]     = useState({ name:'', path:'' })
  const [saving,        setSaving]        = useState(false)
  const [editingMeta,   setEditingMeta]   = useState(null)

  // ── realtime + initial load ────────────────────────────────────────────────
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

  // ── categories ─────────────────────────────────────────────────────────────
  const addCategory = async () => {
    if (!newCatName.trim()) return
    setSaving(true)
    const maxOrder = categories.reduce((m,c)=>Math.max(m,c.sort_order||0),0)
    const opt = {id:'tmp-'+Date.now(),name:newCatName.trim(),color:newCatColor,sort_order:maxOrder+1}
    setCategories(p=>[...p,opt])
    const {error} = await supabase.from('dde_tag_categories').insert({name:opt.name,color:opt.color,sort_order:opt.sort_order})
    setSaving(false)
    if (error) { setCategories(p=>p.filter(c=>c.id!==opt.id)); showMsg('error',error.message); return }
    setNewCatName(''); fetchCategories()
    showMsg('success',`Category "${opt.name}" created`)
  }

  const deleteCategory = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}" and all its values?`)) return
    setCategories(p=>p.filter(c=>c.id!==cat.id))
    setTagValues(p=>p.filter(tv=>tv.category_id!==cat.id))
    await supabase.from('dde_tag_values').delete().eq('category_id',cat.id)
    await supabase.from('dde_tag_categories').delete().eq('id',cat.id)
    showMsg('success',`Category "${cat.name}" deleted`)
  }

  const moveCat = async (cat, dir) => {
    const sorted = [...categories].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
    const idx = sorted.findIndex(c=>c.id===cat.id)
    const swapIdx = dir==='up' ? idx-1 : idx+1
    if (swapIdx<0 || swapIdx>=sorted.length) return
    const other = sorted[swapIdx]
    const newA = other.sort_order; const newB = cat.sort_order
    setCategories(p=>p.map(c=> c.id===cat.id ? {...c,sort_order:newA} : c.id===other.id ? {...c,sort_order:newB} : c))
    await Promise.all([
      supabase.from('dde_tag_categories').update({sort_order:newA}).eq('id',cat.id),
      supabase.from('dde_tag_categories').update({sort_order:newB}).eq('id',other.id),
    ])
  }

  // ── values ─────────────────────────────────────────────────────────────────
  const addValue = async (catId) => {
    const val = (newValInputs[catId]||'').trim()
    if (!val) return
    setSaving(true)
    const maxOrder = tagValues.filter(tv=>tv.category_id===catId).reduce((m,tv)=>Math.max(m,tv.sort_order||0),0)
    const opt = {id:'tmp-'+Date.now(),category_id:catId,value:val,sort_order:maxOrder+1}
    setTagValues(p=>[...p,opt])
    // Only insert the safe minimal columns — avoid schema-cache issues with optional columns
    const {error} = await supabase.from('dde_tag_values').insert({
      category_id: catId,
      value: val,
      sort_order: maxOrder+1,
    })
    setSaving(false)
    if (error) { setTagValues(p=>p.filter(tv=>tv.id!==opt.id)); showMsg('error',error.message); return }
    setNewValInputs(p=>({...p,[catId]:''})); fetchValues()
  }

  const deleteValue = async (tv) => {
    setTagValues(p=>p.filter(t=>t.id!==tv.id))
    await supabase.from('dde_tag_values').delete().eq('id',tv.id)
  }

  const moveVal = async (tv, catId, dir) => {
    const sorted = tagValues.filter(t=>t.category_id===catId).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
    const idx = sorted.findIndex(t=>t.id===tv.id)
    const swapIdx = dir==='up' ? idx-1 : idx+1
    if (swapIdx<0 || swapIdx>=sorted.length) return
    const other = sorted[swapIdx]
    const newA = other.sort_order; const newB = tv.sort_order
    setTagValues(p=>p.map(t=> t.id===tv.id ? {...t,sort_order:newA} : t.id===other.id ? {...t,sort_order:newB} : t))
    await Promise.all([
      supabase.from('dde_tag_values').update({sort_order:newA}).eq('id',tv.id),
      supabase.from('dde_tag_values').update({sort_order:newB}).eq('id',other.id),
    ])
  }

  const handleMetaSaved = (updated) => {
    setTagValues(p=>p.map(tv=>tv.id===updated.id?updated:tv))
    setEditingMeta(null); showMsg('success','Tag details saved')
  }

  // ── folders ────────────────────────────────────────────────────────────────
  const addFolder = async () => {
    if (!newFolder.name.trim()||!newFolder.path.trim()) return
    setSaving(true)
    const opt = {id:'tmp-'+Date.now(),...newFolder}
    setFolders(p=>[...p,opt].sort((a,b)=>a.name.localeCompare(b.name)))
    const {data,error} = await supabase.from('dde_tag_folders')
      .insert({name:newFolder.name.trim(),path:newFolder.path.trim()})
      .select().single()
    setSaving(false)
    if (error) { setFolders(p=>p.filter(f=>f.id!==opt.id)); showMsg('error',error.message); return }
    setNewFolder({name:'',path:''}); showMsg('success',`Folder "${newFolder.name.trim()}" added`); fetchFolders()
  }

  const deleteFolder = async (fo) => {
    // Count files in this folder
    const {count} = await supabase.from('dde_tag_files').select('id',{count:'exact',head:true}).eq('folder_id',fo.id)
    let deleteFiles = false
    if (count>0) {
      const choice = window.confirm(
        `Folder "${fo.name}" has ${count} file record${count!==1?'s':''} associated with it.\n\n` +
        `Click OK to DELETE those file records too.\nClick Cancel to remove the folder but KEEP the file records (they will become unassigned).`
      )
      deleteFiles = choice
    } else {
      if (!window.confirm(`Remove folder "${fo.name}"?`)) return
    }
    setFolders(p=>p.filter(f=>f.id!==fo.id))
    if (deleteFiles) {
      await supabase.from('dde_tag_files').delete().eq('folder_id',fo.id)
    }
    await supabase.from('dde_tag_folders').delete().eq('id',fo.id)
    showMsg('success',`Folder "${fo.name}" removed${deleteFiles?` (${count} file records deleted)`:''}`)
  }

  const browseFolder = async () => {
    try {
      if (window.showDirectoryPicker) {
        const dir = await window.showDirectoryPicker({mode:'read'})
        setNewFolder(f=>({...f,path:dir.name,name:f.name||dir.name}))
      } else {
        const input = document.createElement('input')
        input.type='file'; input.webkitdirectory=true; input.multiple=true
        input.onchange = () => {
          if (input.files.length>0) {
            const rel = input.files[0].webkitRelativePath||input.files[0].name
            const dir = rel.split('/')[0]||input.files[0].name
            setNewFolder(f=>({...f,path:dir,name:f.name||dir}))
          }
        }
        input.click()
      }
    } catch(e) {}
  }

  // ── user access ────────────────────────────────────────────────────────────
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
  const sortedCats   = [...categories].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))

  return (
    <div>
      {/* ── USER ACCESS (collapsed by default) ───────────────────────── */}
      <div className="card" style={{marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}
          onClick={()=>setUserAccExpand(v=>!v)}>
          <div className="card-title" style={{marginBottom:0}}>
            <span className="icon">👥</span> File Tags — User Access
            <span style={{fontSize:'0.72rem',color:'var(--white-dim)',fontFamily:'var(--font-body)',fontWeight:400,marginLeft:8,textTransform:'none',letterSpacing:0}}>
              {enabledCount} / {nonAdminEmps.length} enabled
            </span>
          </div>
          <span style={{color:'var(--gold)',fontSize:'1rem',transition:'transform 0.2s',
            transform:userAccExpand?'rotate(180deg)':'rotate(0deg)'}}>▼</span>
        </div>

        {userAccExpand && (
          <div style={{marginTop:14}}>
            <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:14}}>
              Grant employees access to File Tags.&nbsp;
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
                          {emp.job_title&&<div style={{fontSize:'0.72rem',color:'var(--white-dim)'}}>{emp.job_title}</div>}
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
        )}
      </div>

      {/* ── TAG CATEGORIES & VALUES ───────────────────────────────────── */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title"><span className="icon">🏷️</span> Tag Categories &amp; Values</div>
        <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:16}}>
          Use ▲▼ arrows to reorder categories and individual values — order here controls display order everywhere.
          Click <strong style={{color:'var(--gold)'}}>⚙</strong> on a value to set OCR hints and access rules.
        </p>

        {/* Add category form */}
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

        {sortedCats.length===0 && <div className="empty-state" style={{padding:'20px 0'}}><p>No tag categories yet</p></div>}

        {sortedCats.map((cat,ci)=>{
          const color = cat.color||CAT_COLORS[ci%CAT_COLORS.length]
          const vals = tagValues.filter(tv=>tv.category_id===cat.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
          const catIdx = sortedCats.indexOf(cat)
          return (
            <div key={cat.id} style={{marginBottom:14,background:'rgba(0,0,0,0.2)',
              border:`1px solid ${color}33`,borderRadius:10,padding:'14px 16px'}}>
              {/* Category header row */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {/* Reorder arrows */}
                  <div style={{display:'flex',flexDirection:'column',gap:0,marginRight:4}}>
                    <button onClick={()=>moveCat(cat,'up')} disabled={catIdx===0}
                      style={{background:'none',border:'none',cursor:catIdx===0?'default':'pointer',
                        color:catIdx===0?'rgba(255,255,255,0.15)':'var(--white-dim)',fontSize:'0.65rem',lineHeight:1,padding:'1px 3px'}}>▲</button>
                    <button onClick={()=>moveCat(cat,'down')} disabled={catIdx===sortedCats.length-1}
                      style={{background:'none',border:'none',cursor:catIdx===sortedCats.length-1?'default':'pointer',
                        color:catIdx===sortedCats.length-1?'rgba(255,255,255,0.15)':'var(--white-dim)',fontSize:'0.65rem',lineHeight:1,padding:'1px 3px'}}>▼</button>
                  </div>
                  <div style={{width:12,height:12,borderRadius:'50%',background:color}} />
                  <span style={{fontWeight:700,fontSize:'0.9rem',color}}>{cat.name}</span>
                  <span style={{fontSize:'0.7rem',color:'var(--white-dim)'}}>{vals.length} value{vals.length!==1?'s':''}</span>
                </div>
                <IconBtn onClick={()=>deleteCategory(cat)} danger>×</IconBtn>
              </div>

              {/* Values list with reorder */}
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
                {vals.map((tv,vi)=>{
                  const hasOcr = tv.official_name||tv.address||tv.company_name
                  const restricted = tv.role_restriction && tv.role_restriction!=='any'
                  return (
                    <div key={tv.id} style={{display:'inline-flex',alignItems:'center',
                      background:color+'18',border:`1px solid ${color}44`,borderRadius:100,
                      paddingLeft:4,paddingRight:3,paddingTop:3,paddingBottom:3,gap:1}}>
                      {/* value reorder */}
                      <div style={{display:'flex',flexDirection:'column',gap:0,marginRight:2}}>
                        <button onClick={()=>moveVal(tv,cat.id,'up')} disabled={vi===0}
                          style={{background:'none',border:'none',cursor:vi===0?'default':'pointer',
                            color:vi===0?'rgba(255,255,255,0.1)':color,fontSize:'0.55rem',lineHeight:1,padding:'0 2px'}}>▲</button>
                        <button onClick={()=>moveVal(tv,cat.id,'down')} disabled={vi===vals.length-1}
                          style={{background:'none',border:'none',cursor:vi===vals.length-1?'default':'pointer',
                            color:vi===vals.length-1?'rgba(255,255,255,0.1)':color,fontSize:'0.55rem',lineHeight:1,padding:'0 2px'}}>▼</button>
                      </div>
                      <span style={{fontSize:'0.78rem',fontWeight:600,color,marginRight:3}}>{tv.value}</span>
                      {hasOcr && <span title="Has OCR hints" style={{fontSize:'0.62rem'}}>🔍</span>}
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

              <div style={{marginTop:8,fontSize:'0.67rem',color:'var(--white-dim)',opacity:0.8}}>
                ▲▼ reorder &nbsp;·&nbsp; ⚙ edit &nbsp;·&nbsp; 🔍 OCR hint &nbsp;·&nbsp; ⚡ auto-applied &nbsp;·&nbsp;
                <span style={{color:'#5EE88A'}}>Sign-off</span> = restricted &nbsp;·&nbsp;
                <span style={{color:'#60a5fa'}}>Viewer</span> = restricted
              </div>
            </div>
          )
        })}
      </div>

      {/* ── FOLDERS ──────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title"><span className="icon">📁</span> Folder Paths</div>
        <p style={{color:'var(--white-dim)',fontSize:'0.82rem',marginBottom:16}}>
          Register shared folder locations. Deleting a folder lets you choose to keep or remove associated file records.
        </p>

        {folders.map(fo=>(
          <div key={fo.id} style={{background:'rgba(0,0,0,0.2)',border:'1px solid var(--border)',
            borderRadius:8,padding:'12px 14px',marginBottom:8}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
              <span style={{fontSize:'1.1rem',marginTop:1}}>📁</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:'0.9rem',marginBottom:4}}>{fo.name}</div>
                <div style={{fontFamily:'monospace',fontSize:'0.78rem',color:'var(--gold)',
                  background:'rgba(240,192,64,0.08)',border:'1px solid rgba(240,192,64,0.2)',
                  borderRadius:6,padding:'4px 8px',wordBreak:'break-all'}}>
                  {fo.path}
                </div>
              </div>
              <IconBtn onClick={()=>deleteFolder(fo)} danger title="Remove folder">×</IconBtn>
            </div>
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
              {newFolder.path && (
                <div style={{marginTop:5,fontFamily:'monospace',fontSize:'0.73rem',color:'var(--gold)',
                  background:'rgba(240,192,64,0.08)',border:'1px solid rgba(240,192,64,0.2)',
                  borderRadius:6,padding:'4px 8px',wordBreak:'break-all'}}>
                  {newFolder.path}
                </div>
              )}
            </div>
          </div>
          <button className="btn btn-gold btn-sm" onClick={addFolder}
            disabled={saving||!newFolder.name.trim()||!newFolder.path.trim()}>
            {saving?'…':'+ Add Folder'}
          </button>
        </div>
      </div>

      {/* ── META MODAL ────────────────────────────────────────────────── */}
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
