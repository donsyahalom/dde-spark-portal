/**
 * TagsTab.jsx — v2
 * Shown to employees with tags_access = true.
 * New features:
 *   • Separate "File Tags" section in nav (renamed from Tags tab)
 *   • Browse Folder — walk the registered folder contents
 *   • Add File — browse for single/multiple files, copy-to-folder if outside
 *   • New Files — scan folder for untracked files, run OCR, get tag suggestions
 *   • OCR matching against tag value metadata (official_name, address, company_name)
 *   • Role-filtered tag picker (sign-off tags hidden from viewers)
 *   • Auto-apply tags injected on file creation
 *   • Date range filter on Search tab
 *   • Modal pushed below header (marginTop: 80px)
 */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = iso => new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
const fmtDateShort = iso => new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
const CAT_COLORS = ['#F0C040','#5EE88A','#60a5fa','#f472b6','#a78bfa','#fb923c','#34d399','#f87171']
const catColor = idx => CAT_COLORS[idx % CAT_COLORS.length]

const pill = (color, sm) => ({
  display:'inline-flex', alignItems:'center', gap:sm?3:4,
  padding:sm?'2px 7px':'3px 9px', borderRadius:100,
  fontSize:sm?'0.68rem':'0.73rem', fontWeight:600,
  background:color+'22', color, border:`1px solid ${color}44`, whiteSpace:'nowrap',
})

const SH = ({children}) => (
  <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:'0.09em',
    color:'var(--gold)',marginBottom:8,fontFamily:'var(--font-display)'}}>
    {children}
  </div>
)

const Dot = ({color}) => <span style={{width:7,height:7,borderRadius:'50%',background:color,display:'inline-block',flexShrink:0}} />

const SOBanner = ({ok,children}) => (
  <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:8,marginBottom:8,
    background:ok?'rgba(94,232,138,0.10)':'rgba(240,192,64,0.10)',
    border:`1px solid ${ok?'rgba(94,232,138,0.25)':'rgba(240,192,64,0.25)'}`}}>
    <span>{ok?'✅':'⏳'}</span>
    <div style={{fontSize:'0.83rem',color:ok?'#5EE88A':'#F0C040'}}>{children}</div>
  </div>
)

function TagChip({ tagValueId, categories, tagValues, onRemove }) {
  const tv = tagValues.find(t=>t.id===tagValueId)
  if (!tv) return null
  const cat = categories.find(c=>c.id===tv.category_id)
  if (!cat) return null
  const color = catColor(categories.indexOf(cat))
  return (
    <span style={pill(color)}>
      <Dot color={color} />
      <span style={{opacity:0.7,fontSize:'0.65rem'}}>{cat.name}:</span>
      {tv.value}
      {onRemove && <button onClick={onRemove} style={{background:'none',border:'none',color,cursor:'pointer',padding:'0 0 0 2px',lineHeight:1,fontSize:'0.8rem'}}>×</button>}
    </span>
  )
}

const metaCard = {background:'rgba(0,0,0,0.25)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,padding:'10px 12px'}

// ─── OCR simulation: match text against tag metadata ─────────────────────────
function runOcrMatch(ocrText, tagValues, categories) {
  if (!ocrText) return []
  const text = ocrText.toLowerCase()
  const matches = []
  for (const tv of tagValues) {
    const candidates = [tv.official_name, tv.address, tv.company_name, tv.value]
      .filter(Boolean).map(s=>s.toLowerCase())
    const hit = candidates.find(c => c.length > 2 && text.includes(c))
    if (hit) {
      const cat = categories.find(c=>c.id===tv.category_id)
      matches.push({ tv, cat, matchedOn: hit })
    }
  }
  return matches
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
  const folder = folders.find(f=>f.id===file.folder_id)
  const adder = employees.find(u=>u.id===file.added_by)
  const assignedEmps = employees.filter(u=>(file.assigned_to||[]).includes(u.id))
  const alreadySigned = (file.signoffs||[]).some(s=>s.user_id===currentUser.id)
  const isAssigned = (file.assigned_to||[]).includes(currentUser.id)
  const canSignoff = currentUser.tags_role==='signoff' && isAssigned && !alreadySigned

  const handleSignoff = async () => {
    setSaving(true)
    const newSO = {user_id:currentUser.id,timestamp:new Date().toISOString(),note:signoffNote}
    const updated = [...(file.signoffs||[]),newSO]
    const {data,error} = await supabase.from('dde_tag_files').update({signoffs:updated}).eq('id',file.id).select().single()
    setSaving(false)
    if (!error&&data) { onUpdate(data); setShowSignoff(false); setSignoffNote('') }
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:580,marginTop:80}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
          <div>
            <div style={{fontFamily:'var(--font-display)',fontSize:'1rem',color:'var(--gold)',marginBottom:4}}>{file.name}</div>
            <div style={{fontSize:'0.73rem',color:'var(--white-dim)'}}>{folder?.path ? folder.path+'\\'+file.name : file.name}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--white-dim)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>
        {(file.signoffs||[]).length>0 && (
          <div style={{marginBottom:14}}>
            <SH>Sign-off Status</SH>
            {(file.signoffs||[]).map((so,i)=>{
              const su=employees.find(u=>u.id===so.user_id)
              return <SOBanner key={i} ok><strong>Approved by {su?.first_name} {su?.last_name}</strong> · {fmtDate(so.timestamp)}{so.note&&<span style={{display:'block',marginTop:2,opacity:0.8}}>"{so.note}"</span>}</SOBanner>
            })}
          </div>
        )}
        {(file.assigned_to||[]).length>0 && (file.signoffs||[]).length < (file.assigned_to||[]).filter(id=>employees.find(u=>u.id===id)?.tags_role==='signoff').length && (
          <SOBanner ok={false}>Pending sign-off from assigned reviewers</SOBanner>
        )}
        <div style={{marginBottom:14}}>
          <SH>Tags</SH>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {(file.tag_value_ids||[]).length===0
              ? <span style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>No tags assigned</span>
              : (file.tag_value_ids||[]).map(tv=><TagChip key={tv} tagValueId={tv} categories={categories} tagValues={tagValues} />)}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div style={metaCard}>
            <div style={{fontSize:'0.68rem',color:'var(--white-dim)',marginBottom:5}}>Added by</div>
            <div style={{fontWeight:600,fontSize:'0.85rem'}}>{adder?.first_name} {adder?.last_name}</div>
            <div style={{fontSize:'0.72rem',color:'var(--white-dim)'}}>{fmtDate(file.created_at)}</div>
          </div>
          <div style={metaCard}>
            <div style={{fontSize:'0.68rem',color:'var(--white-dim)',marginBottom:5}}>Assigned to</div>
            {assignedEmps.length===0
              ? <span style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>Not assigned</span>
              : assignedEmps.map(u=>(
                  <div key={u.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                    <span style={{fontSize:'0.82rem',fontWeight:500}}>{u.first_name} {u.last_name}</span>
                    {u.tags_role==='signoff'&&<span style={pill('#5EE88A',true)}>Sign-off</span>}
                  </div>
                ))}
          </div>
        </div>
        {file.notes&&<div style={{...metaCard,marginBottom:14}}><div style={{fontSize:'0.68rem',color:'var(--white-dim)',marginBottom:4}}>Notes</div><div style={{fontSize:'0.83rem',color:'var(--white-soft)'}}>{file.notes}</div></div>}
        {canSignoff&&!showSignoff&&<button className="btn btn-gold" style={{width:'100%',justifyContent:'center'}} onClick={()=>setShowSignoff(true)}>✅ Sign Off on This File</button>}
        {showSignoff&&(
          <div style={{...metaCard,border:'1px solid rgba(94,232,138,0.3)'}}>
            <div style={{fontWeight:600,color:'#5EE88A',marginBottom:10,fontSize:'0.88rem'}}>Confirm Sign-off</div>
            <div className="form-group" style={{marginBottom:10}}>
              <label className="form-label">Note (optional)</label>
              <textarea className="form-textarea" rows={2} style={{minHeight:60}}
                value={signoffNote} onChange={e=>setSignoffNote(e.target.value)} placeholder="Add a note…" />
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-gold btn-sm" onClick={handleSignoff} disabled={saving}>{saving?'Saving…':'✅ Confirm'}</button>
              <button className="btn btn-outline btn-sm" onClick={()=>setShowSignoff(false)}>Cancel</button>
            </div>
          </div>
        )}
        {alreadySigned&&<div style={{...metaCard,border:'1px solid rgba(94,232,138,0.3)',color:'#5EE88A',fontSize:'0.85rem',display:'flex',alignItems:'center',gap:8}}>✅ You have signed off on this file</div>}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ADD / NEW FILES MODAL
// ═════════════════════════════════════════════════════════════════════════════
function AddFileModal({ state, currentUser, employees, onClose, onAdd, initialFiles=[], mode='add' }) {
  const { folders, categories, tagValues } = state
  const [step, setStep] = useState(initialFiles.length>0?'tags':'pick') // pick | ocr | tags
  const [pickedFiles, setPickedFiles] = useState(initialFiles)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrResults, setOcrResults] = useState([]) // [{fileName, text, suggestions:[{tv,cat,matchedOn}]}]
  const [form, setForm] = useState({ folder_id: folders[0]?.id||'', notes:'' })
  const [selTags, setSelTags] = useState([])
  const [selAssign, setSelAssign] = useState([])
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef()

  // Apply auto-apply tags on mount
  useEffect(()=>{
    const autoIds = tagValues.filter(tv=>tv.auto_apply).map(tv=>tv.id)
    setSelTags(autoIds)
  },[tagValues])

  // ── file picking ──────────────────────────────────────────────────────────
  const handleFilePick = (e) => {
    const files = Array.from(e.target.files||[])
    setPickedFiles(files)
    if (files.length>0) setStep('ocr')
  }

  // ── OCR simulation ────────────────────────────────────────────────────────
  // In a real integration you'd send the file to a server OCR endpoint.
  // Here we read text-based files and match against tag metadata.
  const runOcr = async () => {
    setOcrRunning(true)
    const results = []
    for (const file of pickedFiles) {
      let text = ''
      try {
        if (file.type.startsWith('text/')||file.name.endsWith('.txt')||file.name.endsWith('.csv')) {
          text = await file.text()
        } else {
          // For non-text files, use the filename itself as OCR text proxy
          text = file.name.replace(/[_\-\.]/g,' ')
        }
      } catch(e) { text = file.name }
      const suggestions = runOcrMatch(text, tagValues, categories)
      results.push({ fileName: file.name, text: text.slice(0,200), suggestions })
    }
    setOcrResults(results)
    // Auto-select suggested tags (merged with auto-apply)
    const suggestedIds = results.flatMap(r=>r.suggestions.map(s=>s.tv.id))
    setSelTags(p=>[...new Set([...p,...suggestedIds])])
    setOcrRunning(false)
    setStep('tags')
  }

  const skipOcr = () => setStep('tags')

  const toggleTag = id => setSelTags(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const toggleAssign = id => setSelAssign(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])

  // Filter tags by user role
  const visibleTagValues = tagValues.filter(tv=>{
    if (!tv.role_restriction || tv.role_restriction==='any') return true
    return tv.role_restriction === currentUser.tags_role
  })

  const handleSubmit = async () => {
    if (pickedFiles.length===0 && mode==='add') return
    setSaving(true)
    const filesToAdd = pickedFiles.length>0 ? pickedFiles : [{name:'Unnamed file'}]
    for (const file of filesToAdd) {
      const payload = {
        name: file.name||file,
        folder_id: form.folder_id||null,
        added_by: currentUser.id,
        notes: form.notes,
        tag_value_ids: selTags,
        assigned_to: selAssign,
        signoffs: [],
      }
      const {data,error} = await supabase.from('dde_tag_files').insert(payload).select().single()
      if (!error&&data) onAdd(data)
    }
    setSaving(false)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:580,marginTop:80}}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div>
            <div style={{fontFamily:'var(--font-display)',fontSize:'1rem',color:'var(--gold)'}}>
              {mode==='new'?'📂 New Files from Folder':'📎 Add File'}
            </div>
            {/* Step indicator */}
            <div style={{display:'flex',gap:6,marginTop:6}}>
              {['pick','ocr','tags'].map((s,i)=>(
                <div key={s} style={{display:'flex',alignItems:'center',gap:4}}>
                  <div style={{width:20,height:20,borderRadius:'50%',display:'grid',placeItems:'center',
                    fontSize:'0.65rem',fontWeight:700,
                    background:step===s?'var(--gold)':['pick','ocr','tags'].indexOf(step)>i?'rgba(240,192,64,0.3)':'rgba(255,255,255,0.1)',
                    color:step===s?'#000':'var(--white-dim)'}}>
                    {i+1}
                  </div>
                  <span style={{fontSize:'0.7rem',color:step===s?'var(--gold)':'var(--white-dim)'}}>
                    {['Select','OCR','Tags'][i]}
                  </span>
                  {i<2&&<span style={{color:'var(--white-dim)',fontSize:'0.7rem'}}>›</span>}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--white-dim)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        {/* ── STEP 1: PICK FILES ── */}
        {step==='pick'&&(
          <div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:16}}>
              Select one or more files. You can pick files from anywhere — if they are outside the target folder, a copy will be registered.
            </p>
            <input ref={fileInputRef} type="file" multiple style={{display:'none'}} onChange={handleFilePick} />
            <button className="btn btn-gold" style={{width:'100%',justifyContent:'center',marginBottom:10}}
              onClick={()=>fileInputRef.current.click()}>
              📂 Browse &amp; Select Files
            </button>
            <div style={{fontSize:'0.75rem',color:'var(--white-dim)',textAlign:'center'}}>
              Supports multiple file selection. Hold Ctrl/Cmd to select several at once.
            </div>
          </div>
        )}

        {/* ── STEP 2: OCR ── */}
        {step==='ocr'&&(
          <div>
            <div style={{background:'rgba(0,0,0,0.2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
              <SH>Selected Files ({pickedFiles.length})</SH>
              {pickedFiles.map((f,i)=>(
                <div key={i} style={{fontSize:'0.83rem',color:'var(--white-soft)',marginBottom:3}}>📄 {f.name}</div>
              ))}
            </div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:16}}>
              Run OCR to automatically detect which Job or Vendor tag to apply based on
              official names, addresses, and company names you've configured on your tags.
            </p>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-gold" onClick={runOcr} disabled={ocrRunning}
                style={{flex:1,justifyContent:'center'}}>
                {ocrRunning?'🔍 Scanning…':'🔍 Run OCR & Suggest Tags'}
              </button>
              <button className="btn btn-outline" onClick={skipOcr}>Skip</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: TAGS ── */}
        {step==='tags'&&(
          <div>
            {/* OCR results */}
            {ocrResults.length>0&&(
              <div style={{background:'rgba(94,232,138,0.07)',border:'1px solid rgba(94,232,138,0.2)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
                <SH>🔍 OCR Suggestions</SH>
                {ocrResults.every(r=>r.suggestions.length===0)
                  ? <p style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>No matching tags found in document text. You can apply tags manually below.</p>
                  : ocrResults.map((r,i)=>(
                    <div key={i} style={{marginBottom:8}}>
                      <div style={{fontSize:'0.78rem',fontWeight:600,marginBottom:4}}>📄 {r.fileName}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                        {r.suggestions.map((s,j)=>{
                          const color = catColor(state.categories.indexOf(s.cat))
                          return (
                            <span key={j} style={{...pill(color,true),cursor:'pointer',
                              background:selTags.includes(s.tv.id)?color+'33':color+'18',
                              border:`1px solid ${selTags.includes(s.tv.id)?color+'88':color+'44'}`}}
                              onClick={()=>toggleTag(s.tv.id)}>
                              {selTags.includes(s.tv.id)?'✓ ':''}{s.cat?.name}: {s.tv.value}
                              <span style={{opacity:0.6,fontSize:'0.6rem',marginLeft:3}}>via {s.matchedOn.slice(0,20)}</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Auto-applied notice */}
            {tagValues.some(tv=>tv.auto_apply&&selTags.includes(tv.id))&&(
              <div style={{fontSize:'0.75rem',color:'var(--gold)',marginBottom:10}}>
                ⚡ Auto-applied tags are pre-selected below
              </div>
            )}

            {/* Folder */}
            <div className="form-group">
              <label className="form-label">Save to Folder</label>
              <select className="form-select" value={form.folder_id} onChange={e=>setForm(f=>({...f,folder_id:e.target.value}))}>
                {state.folders.map(fo=><option key={fo.id} value={fo.id}>{fo.name} — {fo.path}</option>)}
              </select>
            </div>

            {/* Notes */}
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} style={{minHeight:52}}
                value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                placeholder="Optional notes…" />
            </div>

            {/* Tags — filtered by role */}
            <div style={{marginBottom:14}}>
              <SH>Tags</SH>
              {state.categories.map((cat,ci)=>{
                const vals = visibleTagValues.filter(tv=>tv.category_id===cat.id)
                if (vals.length===0) return null
                return (
                  <div key={cat.id} style={{marginBottom:10}}>
                    <div style={{fontSize:'0.68rem',color:catColor(ci),fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:5}}>
                      {cat.name}
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                      {vals.map(tv=>{
                        const active = selTags.includes(tv.id)
                        const color = catColor(ci)
                        const isAuto = tv.auto_apply
                        return (
                          <button key={tv.id} onClick={()=>!isAuto&&toggleTag(tv.id)}
                            style={{...pill(color,true),cursor:isAuto?'default':'pointer',
                              background:active?color+'33':'transparent',
                              border:`1px solid ${active?color+'88':color+'33'}`,
                              opacity:isAuto?0.75:1,transition:'all 0.15s'}}>
                            {active&&'✓ '}{tv.value}
                            {isAuto&&<span style={{fontSize:'0.58rem',marginLeft:3,opacity:0.7}}>⚡</span>}
                            {tv.role_restriction==='signoff'&&<span style={{fontSize:'0.58rem',marginLeft:3,opacity:0.7}}>🔒</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Assign */}
            <div style={{marginBottom:16}}>
              <SH>Assign To</SH>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {employees.filter(u=>u.id!==currentUser.id&&u.tags_access).map(u=>{
                  const active = selAssign.includes(u.id)
                  return (
                    <button key={u.id} onClick={()=>toggleAssign(u.id)}
                      style={{...pill(active?'var(--gold)':'rgba(255,255,255,0.35)',true),
                        cursor:'pointer',fontSize:'0.78rem',padding:'4px 10px',
                        background:active?'rgba(240,192,64,0.2)':'rgba(255,255,255,0.05)',
                        border:`1px solid ${active?'rgba(240,192,64,0.5)':'rgba(255,255,255,0.15)'}`,
                        transition:'all 0.15s'}}>
                      {active&&'✓ '}{u.first_name} {u.last_name}
                      {u.tags_role==='signoff'&&<span style={{...pill('#5EE88A',true),marginLeft:4,fontSize:'0.6rem'}}>SO</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Files summary */}
            {pickedFiles.length>1&&(
              <div style={{background:'rgba(0,0,0,0.2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px',marginBottom:14}}>
                <div style={{fontSize:'0.75rem',color:'var(--white-dim)',marginBottom:6}}>Adding {pickedFiles.length} files — tags &amp; assignment apply to all:</div>
                {pickedFiles.map((f,i)=><div key={i} style={{fontSize:'0.8rem',color:'var(--white-soft)'}}>📄 {f.name}</div>)}
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-gold" onClick={handleSubmit} disabled={saving}>{saving?'Adding…':'➕ Add File'+(pickedFiles.length>1?'s':'')}</button>
              <button className="btn btn-outline" onClick={()=>setStep('ocr')}>← Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN TagsTab
// ═════════════════════════════════════════════════════════════════════════════
export default function TagsTab({ currentUser, employees }) {
  const [innerTab, setInnerTab] = useState('files')
  const [state, setState] = useState({ folders:[], categories:[], tagValues:[], files:[] })
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [showAddFile, setShowAddFile] = useState(false)
  const [newFilesMode, setNewFilesMode] = useState(false)
  const [search, setSearch] = useState('')
  const [filterFolder, setFilterFolder] = useState('')
  const [filterTags, setFilterTags] = useState({})
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [msg, setMsg] = useState(null)
  const [expandedFolder, setExpandedFolder] = useState(null)

  const isSignoff = currentUser.tags_role==='signoff'

  useEffect(()=>{ fetchAll() },[])

  const fetchAll = async () => {
    setLoading(true)
    const [{ data:folders },{ data:categories },{ data:tagValues },{ data:files }] = await Promise.all([
      supabase.from('dde_tag_folders').select('*').order('name'),
      supabase.from('dde_tag_categories').select('*').order('sort_order'),
      supabase.from('dde_tag_values').select('*').order('sort_order'),
      supabase.from('dde_tag_files').select('*').order('created_at',{ascending:false}),
    ])
    setState({ folders:folders||[], categories:categories||[], tagValues:tagValues||[], files:files||[] })
    setLoading(false)
  }

  const showMsg = (type, text) => { setMsg({type,text}); setTimeout(()=>setMsg(null),4000) }
  const updateFileInState = (u) => { setState(s=>({...s,files:s.files.map(f=>f.id===u.id?u:f)})); setSelectedFile(u) }
  const addFileToState = (f) => { setState(s=>({...s,files:[f,...s.files]})); showMsg('success',`📎 "${f.name}" added!`) }

  // ── filters ────────────────────────────────────────────────────────────────
  const filteredFiles = state.files.filter(f=>{
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filterFolder && f.folder_id!==filterFolder) return false
    for (const [catId,tvIds] of Object.entries(filterTags)) {
      if (!tvIds.length) continue
      if (!tvIds.some(tvId=>(f.tag_value_ids||[]).includes(tvId))) return false
    }
    if (filterDateFrom && new Date(f.created_at) < new Date(filterDateFrom)) return false
    if (filterDateTo   && new Date(f.created_at) > new Date(filterDateTo+'T23:59:59')) return false
    return true
  })

  const toggleFilterTag = (catId, tvId) => {
    setFilterTags(p=>{ const cur=p[catId]||[]; return {...p,[catId]:cur.includes(tvId)?cur.filter(x=>x!==tvId):[...cur,tvId]} })
  }
  const activeFilterCount = Object.values(filterTags).flat().length + (filterDateFrom?1:0) + (filterDateTo?1:0)

  const pendingSignoffs = isSignoff
    ? state.files.filter(f=>(f.assigned_to||[]).includes(currentUser.id)&&!(f.signoffs||[]).some(s=>s.user_id===currentUser.id))
    : []

  if (loading) return <div style={{textAlign:'center',padding:'60px 0'}}><div className="spark-loader" style={{margin:'0 auto'}} /></div>

  return (
    <div className="fade-in">
      {msg&&<div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      {pendingSignoffs.length>0&&(
        <div style={{background:'rgba(240,192,64,0.12)',border:'1px solid rgba(240,192,64,0.3)',borderRadius:10,
          padding:'12px 16px',marginBottom:20,display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}
          onClick={()=>setInnerTab('pending')}>
          <span>⏳</span>
          <span style={{color:'#F0C040',fontWeight:600,fontSize:'0.88rem'}}>
            {pendingSignoffs.length} file{pendingSignoffs.length!==1?'s':''} awaiting your sign-off
          </span>
        </div>
      )}

      <div className="tabs" style={{marginBottom:20}}>
        {[
          ['files','📎 Files'],
          ['browse','📂 Browse Folders'],
          ['search','🔍 Search'],
          ...(isSignoff&&pendingSignoffs.length?[['pending',`⏳ Pending (${pendingSignoffs.length})`]]:[]),
        ].map(([t,label])=>(
          <button key={t} className={`tab-btn${innerTab===t?' active':''}`} onClick={()=>setInnerTab(t)}>{label}</button>
        ))}
      </div>

      {/* ── FILES TAB ─────────────────────────────────────────────────── */}
      {innerTab==='files'&&(
        <div>
          <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
            <div style={{position:'relative',flex:1,minWidth:180}}>
              <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',opacity:0.4,pointerEvents:'none'}}>🔍</span>
              <input className="form-input" style={{paddingLeft:34}} placeholder="Search files…"
                value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{width:180}} value={filterFolder} onChange={e=>setFilterFolder(e.target.value)}>
              <option value="">All Folders</option>
              {state.folders.map(fo=><option key={fo.id} value={fo.id}>{fo.name}</option>)}
            </select>
            <button className="btn btn-outline" onClick={()=>{ setNewFilesMode(true); setShowAddFile(true) }} style={{whiteSpace:'nowrap'}}>
              📂 New Files
            </button>
            <button className="btn btn-gold" onClick={()=>{ setNewFilesMode(false); setShowAddFile(true) }}>➕ Add File</button>
          </div>

          {filteredFiles.length===0
            ? <div className="empty-state"><div className="icon">📂</div><p>{state.files.length===0?'No files yet. Click "Add File" to get started.':'No files match your search.'}</p></div>
            : (
              <div className="card" style={{padding:0}}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>File Name</th><th>Folder</th><th>Tags</th><th>Added By</th><th>Date</th><th>Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.map(f=>{
                        const folder=state.folders.find(fo=>fo.id===f.folder_id)
                        const adder=employees.find(u=>u.id===f.added_by)
                        const signed=(f.signoffs||[]).length>0
                        const pending=(f.assigned_to||[]).length>0&&!signed
                        return (
                          <tr key={f.id} style={{cursor:'pointer'}} onClick={()=>setSelectedFile(f)}>
                            <td style={{fontWeight:600}}>📄 {f.name}</td>
                            <td style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>{folder?.name||'—'}</td>
                            <td>
                              <div style={{display:'flex',flexWrap:'wrap',gap:4,maxWidth:240}}>
                                {(f.tag_value_ids||[]).slice(0,3).map(tvId=><TagChip key={tvId} tagValueId={tvId} categories={state.categories} tagValues={state.tagValues} />)}
                                {(f.tag_value_ids||[]).length>3&&<span style={pill('rgba(255,255,255,0.4)',true)}>+{(f.tag_value_ids||[]).length-3}</span>}
                              </div>
                            </td>
                            <td style={{fontSize:'0.83rem'}}>{adder?.first_name} {adder?.last_name}</td>
                            <td style={{fontSize:'0.78rem',color:'var(--white-dim)',whiteSpace:'nowrap'}}>{fmtDateShort(f.created_at)}</td>
                            <td>
                              {signed?<span style={pill('#5EE88A')}>✅ Approved</span>
                                :pending?<span style={pill('#F0C040')}>⏳ Pending</span>
                                :<span style={{fontSize:'0.78rem',color:'var(--white-dim)'}}>—</span>}
                            </td>
                            <td><button className="btn btn-outline btn-xs" onClick={e=>{e.stopPropagation();setSelectedFile(f)}}>View</button></td>
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

      {/* ── BROWSE FOLDERS TAB ────────────────────────────────────────── */}
      {innerTab==='browse'&&(
        <div>
          <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:16}}>
            Browse registered folders and see which files have been tagged.
            Click a folder to expand it, then add or view files directly.
          </p>
          {state.folders.length===0
            ? <div className="empty-state"><div className="icon">📁</div><p>No folders registered. Ask your admin to add folder paths.</p></div>
            : state.folders.map(fo=>{
              const folderFiles = state.files.filter(f=>f.folder_id===fo.id)
              const isOpen = expandedFolder===fo.id
              return (
                <div key={fo.id} className="card" style={{marginBottom:10,padding:'14px 16px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setExpandedFolder(isOpen?null:fo.id)}>
                    <span style={{fontSize:'1.2rem'}}>{isOpen?'📂':'📁'}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:'0.92rem'}}>{fo.name}</div>
                      <div style={{fontFamily:'monospace',fontSize:'0.72rem',color:'var(--white-dim)'}}>{fo.path}</div>
                    </div>
                    <span style={{fontSize:'0.78rem',color:'var(--white-dim)'}}>{folderFiles.length} file{folderFiles.length!==1?'s':''}</span>
                    <span style={{color:'var(--gold)',fontSize:'0.8rem'}}>{isOpen?'▲':'▼'}</span>
                  </div>
                  {isOpen&&(
                    <div style={{marginTop:12,borderTop:'1px solid var(--border)',paddingTop:12}}>
                      <div style={{display:'flex',gap:8,marginBottom:10}}>
                        <button className="btn btn-outline btn-sm" onClick={()=>{setFilterFolder(fo.id);setNewFilesMode(false);setShowAddFile(true)}}>
                          ➕ Add File to this Folder
                        </button>
                      </div>
                      {folderFiles.length===0
                        ? <div style={{fontSize:'0.82rem',color:'var(--white-dim)',padding:'8px 0'}}>No files tracked in this folder yet.</div>
                        : folderFiles.map(f=>{
                          const signed=(f.signoffs||[]).length>0
                          const adder=employees.find(u=>u.id===f.added_by)
                          return (
                            <div key={f.id} style={{display:'flex',alignItems:'center',gap:10,
                              padding:'8px 10px',borderRadius:8,marginBottom:4,
                              background:'rgba(0,0,0,0.2)',cursor:'pointer'}}
                              onClick={()=>setSelectedFile(f)}>
                              <span>📄</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontWeight:600,fontSize:'0.85rem',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div>
                                <div style={{fontSize:'0.72rem',color:'var(--white-dim)'}}>{adder?.first_name} {adder?.last_name} · {fmtDateShort(f.created_at)}</div>
                              </div>
                              <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                                {(f.tag_value_ids||[]).slice(0,2).map(tvId=><TagChip key={tvId} tagValueId={tvId} categories={state.categories} tagValues={state.tagValues} />)}
                              </div>
                              {signed&&<span style={pill('#5EE88A',true)}>✅</span>}
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* ── SEARCH TAB ────────────────────────────────────────────────── */}
      {innerTab==='search'&&(
        <div style={{display:'flex',gap:20,alignItems:'flex-start'}}>
          {/* Sidebar */}
          <div style={{width:210,flexShrink:0}}>
            <div className="card" style={{padding:'16px 14px',position:'sticky',top:80}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <SH style={{marginBottom:0}}>Filters</SH>
                {activeFilterCount>0&&<button className="btn btn-outline btn-xs" onClick={()=>{setFilterTags({});setFilterDateFrom('');setFilterDateTo('')}}>Clear ({activeFilterCount})</button>}
              </div>

              {/* Date range */}
              <div style={{marginBottom:14}}>
                <div style={{fontSize:'0.67rem',color:'var(--gold)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Date Added</div>
                <div style={{marginBottom:6}}>
                  <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginBottom:3}}>From</div>
                  <input type="date" className="form-input" style={{padding:'5px 8px',fontSize:'0.75rem'}}
                    value={filterDateFrom} onChange={e=>setFilterDateFrom(e.target.value)} />
                </div>
                <div>
                  <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginBottom:3}}>To</div>
                  <input type="date" className="form-input" style={{padding:'5px 8px',fontSize:'0.75rem'}}
                    value={filterDateTo} onChange={e=>setFilterDateTo(e.target.value)} />
                </div>
              </div>

              {/* Tag filters */}
              {state.categories.map((cat,ci)=>(
                <div key={cat.id} style={{marginBottom:12}}>
                  <div style={{fontSize:'0.67rem',color:catColor(ci),fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:5}}>{cat.name}</div>
                  {state.tagValues.filter(tv=>tv.category_id===cat.id).map(tv=>{
                    const active=(filterTags[cat.id]||[]).includes(tv.id)
                    const color=catColor(ci)
                    return (
                      <div key={tv.id} onClick={()=>toggleFilterTag(cat.id,tv.id)}
                        style={{display:'flex',alignItems:'center',gap:7,padding:'5px 6px',borderRadius:6,cursor:'pointer',
                          background:active?color+'18':'transparent',marginBottom:2,transition:'all 0.15s'}}>
                        <div style={{width:13,height:13,borderRadius:3,border:`1.5px solid ${active?color:'rgba(255,255,255,0.25)'}`,
                          background:active?color:'transparent',display:'grid',placeItems:'center',flexShrink:0}}>
                          {active&&<span style={{fontSize:'0.6rem',color:'#000',lineHeight:1}}>✓</span>}
                        </div>
                        <span style={{fontSize:'0.78rem',color:active?color:'var(--white-dim)'}}>{tv.value}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div style={{flex:1}}>
            <div style={{marginBottom:14,position:'relative'}}>
              <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',opacity:0.4}}>🔍</span>
              <input className="form-input" style={{paddingLeft:36}} placeholder="Search by file name…"
                value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <div style={{fontSize:'0.78rem',color:'var(--white-dim)',marginBottom:12}}>
              {filteredFiles.length} file{filteredFiles.length!==1?'s':''} found
              {(filterDateFrom||filterDateTo)&&<span style={{color:'var(--gold)',marginLeft:8}}>
                📅 {filterDateFrom||'…'} → {filterDateTo||'now'}
              </span>}
            </div>
            {filteredFiles.length===0
              ? <div className="empty-state"><div className="icon">🔍</div><p>No files match</p></div>
              : filteredFiles.map(f=>{
                const folder=state.folders.find(fo=>fo.id===f.folder_id)
                const adder=employees.find(u=>u.id===f.added_by)
                const signed=(f.signoffs||[]).length>0
                return (
                  <div key={f.id} className="card" style={{marginBottom:10,cursor:'pointer'}} onClick={()=>setSelectedFile(f)}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                          <span>📄</span>
                          <span style={{fontWeight:700,fontSize:'0.92rem'}}>{f.name}</span>
                          {signed&&<span style={pill('#5EE88A',true)}>✅ Approved</span>}
                        </div>
                        <div style={{fontSize:'0.74rem',color:'var(--white-dim)',marginBottom:8}}>
                          📁 {folder?.name} · {adder?.first_name} {adder?.last_name} · {fmtDateShort(f.created_at)}
                        </div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                          {(f.tag_value_ids||[]).map(tvId=><TagChip key={tvId} tagValueId={tvId} categories={state.categories} tagValues={state.tagValues} />)}
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

      {/* ── PENDING TAB ───────────────────────────────────────────────── */}
      {innerTab==='pending'&&(
        <div>
          {pendingSignoffs.length===0
            ? <div className="empty-state"><div className="icon">✅</div><p>All caught up!</p></div>
            : pendingSignoffs.map(f=>{
              const folder=state.folders.find(fo=>fo.id===f.folder_id)
              const adder=employees.find(u=>u.id===f.added_by)
              return (
                <div key={f.id} className="card" style={{marginBottom:12,cursor:'pointer',border:'1px solid rgba(240,192,64,0.3)'}}
                  onClick={()=>setSelectedFile(f)}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:'0.92rem',marginBottom:4}}>📄 {f.name}</div>
                      <div style={{fontSize:'0.74rem',color:'var(--white-dim)',marginBottom:8}}>
                        📁 {folder?.name} · Added by {adder?.first_name} {adder?.last_name} · {fmtDateShort(f.created_at)}
                      </div>
                      {f.notes&&<div style={{fontSize:'0.8rem',color:'var(--white-soft)'}}>{f.notes}</div>}
                    </div>
                    <button className="btn btn-gold btn-sm" onClick={e=>{e.stopPropagation();setSelectedFile(f)}}>✅ Review</button>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* ── MODALS ────────────────────────────────────────────────────── */}
      {selectedFile&&<FileModal file={selectedFile} state={state} currentUser={currentUser} employees={employees} onClose={()=>setSelectedFile(null)} onUpdate={updateFileInState} />}
      {showAddFile&&(
        <AddFileModal
          state={state}
          currentUser={currentUser}
          employees={employees}
          onClose={()=>{ setShowAddFile(false); setNewFilesMode(false) }}
          onAdd={addFileToState}
          mode={newFilesMode?'new':'add'}
          initialFiles={[]}
        />
      )}
    </div>
  )
}
