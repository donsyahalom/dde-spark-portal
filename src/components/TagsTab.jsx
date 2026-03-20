/**
 * TagsTab.jsx — v3
 * New:
 *  • Delete file record / Replace with different file
 *  • "My Assignments" tab — sign-off reassigns back to original assigner
 *  • Bulk tag + bulk assign on file list (checkbox select)
 *  • "Paid" completion status with timestamp (clears assignments)
 *  • Sign-off users can add notes to any file
 *  • Tags in every list sorted by category sort_order then value sort_order
 *  • Search: date filter by added | approved | assigned
 *  • File detail: full timestamped audit trail for all events
 *  • Click filename to attempt open/download
 *  • Windows Explorer Tags string shown in file detail
 *  • Modals pushed down (marginTop:110px)
 */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const fmtDate  = iso => new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
const fmtShort = iso => new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
const nowISO   = () => new Date().toISOString()

const CAT_COLORS = ['#F0C040','#5EE88A','#60a5fa','#f472b6','#a78bfa','#fb923c','#34d399','#f87171']
const catColor  = idx => CAT_COLORS[Math.abs(idx||0) % CAT_COLORS.length]

const pill = (color,sm) => ({
  display:'inline-flex',alignItems:'center',gap:sm?3:4,
  padding:sm?'2px 7px':'3px 9px',borderRadius:100,
  fontSize:sm?'0.68rem':'0.73rem',fontWeight:600,
  background:color+'22',color,border:`1px solid ${color}44`,whiteSpace:'nowrap',
})

const SH = ({children,style={}}) => (
  <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:'0.09em',
    color:'var(--gold)',marginBottom:8,fontFamily:'var(--font-display)',...style}}>
    {children}
  </div>
)

const Dot = ({color}) => <span style={{width:7,height:7,borderRadius:'50%',background:color,display:'inline-block',flexShrink:0}} />
const metaCard = {background:'rgba(0,0,0,0.25)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,padding:'10px 12px'}

function SOBanner({ok,warn,children}) {
  return (
    <div style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 14px',borderRadius:8,marginBottom:8,
      background:ok?'rgba(94,232,138,0.10)':warn?'rgba(224,85,85,0.10)':'rgba(240,192,64,0.10)',
      border:`1px solid ${ok?'rgba(94,232,138,0.25)':warn?'rgba(224,85,85,0.25)':'rgba(240,192,64,0.25)'}`}}>
      <span style={{flexShrink:0,marginTop:1}}>{ok?'✅':warn?'❌':'⏳'}</span>
      <div style={{fontSize:'0.83rem',color:ok?'#5EE88A':warn?'#E05555':'#F0C040'}}>{children}</div>
    </div>
  )
}

function runOcrMatch(text, tagValues, categories) {
  if (!text) return []
  const low = text.toLowerCase()
  const matches = []
  for (const tv of tagValues) {
    const hits = [tv.official_name, tv.address, tv.company_name, tv.value]
      .filter(Boolean).map(s=>s.toLowerCase())
    const hit = hits.find(c => c.length>2 && low.includes(c))
    if (hit) {
      const cat = categories.find(c=>c.id===tv.category_id)
      matches.push({tv,cat,matchedOn:hit})
    }
  }
  return matches
}

// Sorted chips — consistent category+value order everywhere
function SortedTagChips({ tagValueIds, categories, tagValues, small=false }) {
  const sorted = [...(tagValueIds||[])]
    .map(id => {
      const tv = tagValues.find(t=>t.id===id); if (!tv) return null
      const cat = categories.find(c=>c.id===tv.category_id); if (!cat) return null
      const catIdx = categories.findIndex(c=>c.id===tv.category_id)
      return {tv,cat,catIdx,catOrder:cat.sort_order||0,valOrder:tv.sort_order||0}
    })
    .filter(Boolean)
    .sort((a,b)=>a.catOrder-b.catOrder||a.valOrder-b.valOrder)
  return (
    <>
      {sorted.map(({tv,cat,catIdx})=>{
        const color=catColor(catIdx)
        return (
          <span key={tv.id} style={pill(color,small)}>
            <Dot color={color}/>
            <span style={{opacity:0.7,fontSize:'0.62rem'}}>{cat.name}:</span>
            {tv.value}
          </span>
        )
      })}
    </>
  )
}

// ─── File Detail Modal ────────────────────────────────────────────
function FileModal({file,state,currentUser,employees,onClose,onUpdate,onDelete}) {
  const {folders,categories,tagValues}=state
  const [signoffNote,setSignoffNote]=useState('')
  const [showSignoff,setShowSignoff]=useState(false)
  const [addNoteText,setAddNoteText]=useState('')
  const [showAddNote,setShowAddNote]=useState(false)
  const [saving,setSaving]=useState(false)
  const [confirmDel,setConfirmDel]=useState(false)
  const replaceRef=useRef()

  if (!file) return null
  const folder=folders.find(f=>f.id===file.folder_id)
  const adder=employees.find(u=>u.id===file.added_by)
  const assignedEmps=employees.filter(u=>(file.assigned_to||[]).includes(u.id))
  const alreadySigned=(file.signoffs||[]).some(s=>s.user_id===currentUser.id)
  const isAssigned=(file.assigned_to||[]).includes(currentUser.id)
  const canSignoff=currentUser.tags_role==='signoff'&&isAssigned&&!alreadySigned
  const canNote=currentUser.tags_role==='signoff'
  const isPaid=(file.status_events||[]).some(e=>e.status==='paid')
  const filePath=folder?`${folder.path}\\${file.name}`:file.name

  const winTagStr=[...(file.tag_value_ids||[])]
    .map(id=>{const tv=tagValues.find(t=>t.id===id);if(!tv)return null;const cat=categories.find(c=>c.id===tv.category_id);return cat?`${cat.name}: ${tv.value}`:tv.value})
    .filter(Boolean).join('; ')

  const handleSignoff=async()=>{
    setSaving(true)
    const ts=nowISO()
    const newSO={user_id:currentUser.id,timestamp:ts,note:signoffNote}
    const updatedSO=[...(file.signoffs||[]),newSO]
    const newAssigned=(file.assigned_to||[]).filter(id=>id!==currentUser.id)
    if(file.added_by&&!newAssigned.includes(file.added_by)) newAssigned.push(file.added_by)
    const statusEvents=[...(file.status_events||[]),{status:'approved',user_id:currentUser.id,timestamp:ts,note:signoffNote}]
    const {data,error}=await supabase.from('dde_tag_files').update({signoffs:updatedSO,assigned_to:newAssigned,status_events:statusEvents}).eq('id',file.id).select().single()
    setSaving(false)
    if(!error&&data){onUpdate(data);setShowSignoff(false);setSignoffNote('')}
  }

  const handleAddNote=async()=>{
    if(!addNoteText.trim())return
    setSaving(true)
    const statusEvents=[...(file.status_events||[]),{status:'note',user_id:currentUser.id,timestamp:nowISO(),note:addNoteText.trim()}]
    const {data,error}=await supabase.from('dde_tag_files').update({status_events:statusEvents}).eq('id',file.id).select().single()
    setSaving(false)
    if(!error&&data){onUpdate(data);setShowAddNote(false);setAddNoteText('')}
  }

  const handlePaid=async()=>{
    if(!window.confirm('Mark as Paid? This clears all assignments and marks the file complete.'))return
    setSaving(true)
    const ts=nowISO()
    const statusEvents=[...(file.status_events||[]),{status:'paid',user_id:currentUser.id,timestamp:ts,note:''}]
    const {data,error}=await supabase.from('dde_tag_files').update({assigned_to:[],status_events:statusEvents}).eq('id',file.id).select().single()
    setSaving(false)
    if(!error&&data) onUpdate(data)
  }

  const handleDelete=async()=>{
    setSaving(true)
    await supabase.from('dde_tag_files').delete().eq('id',file.id)
    setSaving(false)
    onDelete(file.id)
    onClose()
  }

  const handleReplace=async(e)=>{
    const f=e.target.files?.[0];if(!f)return
    setSaving(true)
    const statusEvents=[...(file.status_events||[]),{status:'replaced',user_id:currentUser.id,timestamp:nowISO(),note:`Replaced with: ${f.name}`}]
    const {data,error}=await supabase.from('dde_tag_files').update({name:f.name,status_events:statusEvents}).eq('id',file.id).select().single()
    setSaving(false)
    if(!error&&data) onUpdate(data)
  }

  const openFile=()=>{
    const url=filePath.startsWith('http')?filePath:`file:///${filePath.replace(/\\/g,'/')}`
    window.open(url,'_blank')
  }

  const audit=[
    {ts:file.created_at,icon:'📎',label:`Added by ${adder?.first_name||''} ${adder?.last_name||''}`},
    ...(file.status_events||[]).map(e=>{
      const u=employees.find(x=>x.id===e.user_id)
      const n=u?`${u.first_name} ${u.last_name}`:'Unknown'
      const icons={approved:'✅',note:'📝',paid:'💰',replaced:'🔄',assigned:'👤',added:'📎'}
      const labels={
        approved:`Approved by ${n}${e.note?` — "${e.note}"` :''}`,
        note:`Note by ${n}: "${e.note}"`,
        paid:`Marked Paid by ${n}`,
        replaced:`${n} — ${e.note}`,
        assigned:`Assigned by ${n}`,
        added:`File added by ${n}`,
      }
      return {ts:e.timestamp,icon:icons[e.status]||'📋',label:labels[e.status]||e.status}
    }),
  ].sort((a,b)=>new Date(a.ts)-new Date(b.ts))

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:600,marginTop:110,maxHeight:'80vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <button onClick={openFile} title="Click to open file"
                style={{background:'none',border:'none',cursor:'pointer',padding:0,
                  fontFamily:'var(--font-display)',fontSize:'1rem',color:'var(--gold)',
                  textDecoration:'underline dotted',textAlign:'left'}}>
                📄 {file.name}
              </button>
              {isPaid&&<span style={pill('#5EE88A',true)}>💰 Paid</span>}
            </div>
            <div style={{fontSize:'0.73rem',color:'var(--white-dim)',marginTop:3,fontFamily:'monospace',wordBreak:'break-all'}}>{filePath}</div>
            <div style={{fontSize:'0.67rem',color:'var(--white-dim)',marginTop:4}}>
              Windows Tags field: <span style={{color:'var(--gold)',fontFamily:'monospace'}}>{winTagStr||'(no tags)'}</span>
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--white-dim)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1,marginLeft:8,flexShrink:0}}>×</button>
        </div>

        {(file.signoffs||[]).map((so,i)=>{
          const su=employees.find(u=>u.id===so.user_id)
          return <SOBanner key={i} ok><strong>Approved by {su?.first_name} {su?.last_name}</strong> · {fmtDate(so.timestamp)}{so.note&&<span style={{display:'block',marginTop:2,opacity:0.8}}>"{so.note}"</span>}</SOBanner>
        })}
        {(file.assigned_to||[]).length>0&&(file.signoffs||[]).length<(file.assigned_to||[]).filter(id=>employees.find(u=>u.id===id)?.tags_role==='signoff').length&&(
          <SOBanner>Pending sign-off from assigned reviewers</SOBanner>
        )}

        <div style={{marginBottom:14}}>
          <SH>Tags</SH>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {(file.tag_value_ids||[]).length===0
              ?<span style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>No tags</span>
              :<SortedTagChips tagValueIds={file.tag_value_ids} categories={categories} tagValues={tagValues}/>}
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
            {isPaid?<span style={{fontSize:'0.85rem',color:'#5EE88A',fontWeight:600}}>💰 Paid — complete</span>
              :assignedEmps.length===0?<span style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>Not assigned</span>
              :assignedEmps.map(u=>(
                <div key={u.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                  <span style={{fontSize:'0.82rem',fontWeight:500}}>{u.first_name} {u.last_name}</span>
                  {u.tags_role==='signoff'&&<span style={pill('#5EE88A',true)}>Sign-off</span>}
                </div>
              ))}
          </div>
        </div>

        {file.notes&&<div style={{...metaCard,marginBottom:14}}><div style={{fontSize:'0.68rem',color:'var(--white-dim)',marginBottom:4}}>Notes</div><div style={{fontSize:'0.83rem',color:'var(--white-soft)'}}>{file.notes}</div></div>}

        {audit.length>0&&(
          <div style={{marginBottom:14}}>
            <SH>Activity Timeline</SH>
            <div style={{borderLeft:'2px solid rgba(240,192,64,0.25)',paddingLeft:12,marginLeft:4}}>
              {audit.map((ev,i)=>(
                <div key={i} style={{position:'relative',marginBottom:10,paddingLeft:4}}>
                  <div style={{position:'absolute',left:-18,top:2,fontSize:'0.75rem'}}>{ev.icon}</div>
                  <div style={{fontSize:'0.82rem',color:'var(--white-soft)'}}>{ev.label}</div>
                  <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginTop:1}}>{fmtDate(ev.ts)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {canSignoff&&!showSignoff&&(
            <button className="btn btn-gold" style={{justifyContent:'center'}} onClick={()=>setShowSignoff(true)}>✅ Sign Off on This File</button>
          )}
          {showSignoff&&(
            <div style={{...metaCard,border:'1px solid rgba(94,232,138,0.3)'}}>
              <div style={{fontWeight:600,color:'#5EE88A',marginBottom:10,fontSize:'0.88rem'}}>Confirm Sign-off</div>
              <div className="form-group" style={{marginBottom:10}}>
                <label className="form-label">Note (optional)</label>
                <textarea className="form-textarea" rows={2} style={{minHeight:60}} value={signoffNote} onChange={e=>setSignoffNote(e.target.value)} placeholder="Add a note…"/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-gold btn-sm" onClick={handleSignoff} disabled={saving}>{saving?'Saving…':'✅ Confirm'}</button>
                <button className="btn btn-outline btn-sm" onClick={()=>setShowSignoff(false)}>Cancel</button>
              </div>
            </div>
          )}
          {alreadySigned&&<SOBanner ok>You have signed off on this file</SOBanner>}

          {canNote&&!showAddNote&&(
            <button className="btn btn-outline" style={{justifyContent:'center'}} onClick={()=>setShowAddNote(true)}>📝 Add Note</button>
          )}
          {showAddNote&&(
            <div style={metaCard}>
              <div style={{fontWeight:600,marginBottom:8,fontSize:'0.88rem'}}>Add Note</div>
              <div className="form-group" style={{marginBottom:10}}>
                <textarea className="form-textarea" rows={2} style={{minHeight:52}} value={addNoteText} onChange={e=>setAddNoteText(e.target.value)} placeholder="Your note…"/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-gold btn-sm" onClick={handleAddNote} disabled={saving||!addNoteText.trim()}>{saving?'…':'💾 Save Note'}</button>
                <button className="btn btn-outline btn-sm" onClick={()=>setShowAddNote(false)}>Cancel</button>
              </div>
            </div>
          )}

          {!isPaid&&(
            <button className="btn btn-outline" style={{justifyContent:'center',color:'#5EE88A',borderColor:'rgba(94,232,138,0.3)'}} onClick={handlePaid} disabled={saving}>
              💰 Mark as Paid (Complete)
            </button>
          )}

          <div>
            <input ref={replaceRef} type="file" style={{display:'none'}} onChange={handleReplace}/>
            <button className="btn btn-outline" style={{justifyContent:'center',width:'100%'}} onClick={()=>replaceRef.current.click()} disabled={saving}>
              🔄 Replace with Different File
            </button>
          </div>

          {!confirmDel
            ?<button className="btn btn-danger" style={{justifyContent:'center'}} onClick={()=>setConfirmDel(true)}>🗑 Delete File Record</button>
            :(
              <div style={{...metaCard,border:'1px solid rgba(224,85,85,0.3)'}}>
                <div style={{fontSize:'0.85rem',marginBottom:10,color:'var(--red)'}}>Delete this file record? Cannot be undone. The actual file on disk is not affected.</div>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={saving}>{saving?'…':'Confirm Delete'}</button>
                  <button className="btn btn-outline btn-sm" onClick={()=>setConfirmDel(false)}>Cancel</button>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

// ─── Add File Modal ───────────────────────────────────────────────
function AddFileModal({state,currentUser,employees,onClose,onAdd,initialFolderId=''}) {
  const {folders,categories,tagValues}=state
  const [step,setStep]=useState('pick')
  const [pickedFiles,setPickedFiles]=useState([])
  const [ocrRunning,setOcrRunning]=useState(false)
  const [ocrResults,setOcrResults]=useState([])
  const [form,setForm]=useState({folder_id:initialFolderId||folders[0]?.id||'',notes:''})
  const [selTags,setSelTags]=useState([])
  const [selAssign,setSelAssign]=useState([])
  const [saving,setSaving]=useState(false)
  const fileRef=useRef()

  useEffect(()=>{
    const autoIds=tagValues.filter(tv=>tv.auto_apply).map(tv=>tv.id)
    setSelTags(autoIds)
  },[tagValues])

  const handlePick=(e)=>{
    const files=Array.from(e.target.files||[])
    setPickedFiles(files)
    if(files.length>0) setStep('ocr')
  }

  const runOcr=async()=>{
    setOcrRunning(true)
    const results=[]
    for(const file of pickedFiles){
      let text=''
      try{
        if(file.type.startsWith('text/')||file.name.endsWith('.txt')||file.name.endsWith('.csv')) text=await file.text()
        else text=file.name.replace(/[_\-\.]/g,' ')
      }catch(e){text=file.name}
      results.push({fileName:file.name,suggestions:runOcrMatch(text,tagValues,categories)})
    }
    setOcrResults(results)
    const ids=results.flatMap(r=>r.suggestions.map(s=>s.tv.id))
    setSelTags(p=>[...new Set([...p,...ids])])
    setOcrRunning(false)
    setStep('tags')
  }

  const toggleTag=id=>setSelTags(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const toggleAssign=id=>setSelAssign(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])

  const visible=tagValues.filter(tv=>!tv.role_restriction||tv.role_restriction==='any'||tv.role_restriction===currentUser.tags_role)

  const handleSubmit=async()=>{
    if(!pickedFiles.length)return
    setSaving(true)
    const ts=nowISO()
    for(const file of pickedFiles){
      const payload={name:file.name,folder_id:form.folder_id||null,added_by:currentUser.id,notes:form.notes,
        tag_value_ids:selTags,assigned_to:selAssign,signoffs:[],
        status_events:[{status:'added',user_id:currentUser.id,timestamp:ts,note:''}]}
      const {data,error}=await supabase.from('dde_tag_files').insert(payload).select().single()
      if(!error&&data) onAdd(data)
    }
    setSaving(false)
    onClose()
  }

  const stepIdx={pick:0,ocr:1,tags:2}[step]

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:580,marginTop:110}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div>
            <div style={{fontFamily:'var(--font-display)',fontSize:'1rem',color:'var(--gold)'}}>📎 Add File</div>
            <div style={{display:'flex',gap:6,marginTop:6}}>
              {['Select','OCR','Tags'].map((s,i)=>(
                <div key={s} style={{display:'flex',alignItems:'center',gap:4}}>
                  <div style={{width:20,height:20,borderRadius:'50%',display:'grid',placeItems:'center',
                    fontSize:'0.65rem',fontWeight:700,
                    background:stepIdx===i?'var(--gold)':stepIdx>i?'rgba(240,192,64,0.3)':'rgba(255,255,255,0.1)',
                    color:stepIdx===i?'#000':'var(--white-dim)'}}>
                    {i+1}
                  </div>
                  <span style={{fontSize:'0.7rem',color:stepIdx===i?'var(--gold)':'var(--white-dim)'}}>{s}</span>
                  {i<2&&<span style={{color:'var(--white-dim)',fontSize:'0.7rem'}}>›</span>}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--white-dim)',fontSize:'1.3rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        {step==='pick'&&(
          <div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:16}}>Select one or more files. Hold Ctrl/Cmd to select multiple.</p>
            <input ref={fileRef} type="file" multiple style={{display:'none'}} onChange={handlePick}/>
            <button className="btn btn-gold" style={{width:'100%',justifyContent:'center'}} onClick={()=>fileRef.current.click()}>📂 Browse &amp; Select Files</button>
          </div>
        )}

        {step==='ocr'&&(
          <div>
            <div style={{background:'rgba(0,0,0,0.2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
              <SH>Selected ({pickedFiles.length})</SH>
              {pickedFiles.map((f,i)=><div key={i} style={{fontSize:'0.83rem',color:'var(--white-soft)',marginBottom:3}}>📄 {f.name}</div>)}
            </div>
            <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:16}}>Run OCR to auto-detect Job/Vendor tags from official names, addresses, and company names on your tags.</p>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-gold" onClick={runOcr} disabled={ocrRunning} style={{flex:1,justifyContent:'center'}}>
                {ocrRunning?'🔍 Scanning…':'🔍 Run OCR & Suggest Tags'}
              </button>
              <button className="btn btn-outline" onClick={()=>setStep('tags')}>Skip</button>
            </div>
          </div>
        )}

        {step==='tags'&&(
          <div>
            {ocrResults.length>0&&(
              <div style={{background:'rgba(94,232,138,0.07)',border:'1px solid rgba(94,232,138,0.2)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
                <SH>🔍 OCR Suggestions</SH>
                {ocrResults.every(r=>r.suggestions.length===0)
                  ?<p style={{fontSize:'0.8rem',color:'var(--white-dim)'}}>No matches found. Apply manually below.</p>
                  :ocrResults.map((r,i)=>(
                    <div key={i} style={{marginBottom:8}}>
                      <div style={{fontSize:'0.78rem',fontWeight:600,marginBottom:4}}>📄 {r.fileName}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                        {r.suggestions.map((s,j)=>{
                          const color=catColor(categories.findIndex(c=>c.id===s.cat?.id))
                          return (
                            <span key={j} style={{...pill(color,true),cursor:'pointer',background:selTags.includes(s.tv.id)?color+'33':color+'18'}}
                              onClick={()=>toggleTag(s.tv.id)}>
                              {selTags.includes(s.tv.id)?'✓ ':''}{s.cat?.name}: {s.tv.value}
                              <span style={{opacity:0.6,fontSize:'0.6rem',marginLeft:3}}>via "{s.matchedOn.slice(0,18)}"</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Save to Folder</label>
              <select className="form-select" value={form.folder_id} onChange={e=>setForm(f=>({...f,folder_id:e.target.value}))}>
                <option value="">— No folder —</option>
                {state.folders.map(fo=><option key={fo.id} value={fo.id}>{fo.name} — {fo.path}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} style={{minHeight:52}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes…"/>
            </div>

            <div style={{marginBottom:14}}>
              <SH>Tags</SH>
              {[...categories].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map((cat,ci)=>{
                const vals=visible.filter(tv=>tv.category_id===cat.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
                if(!vals.length)return null
                const color=cat.color||catColor(ci)
                return (
                  <div key={cat.id} style={{marginBottom:10}}>
                    <div style={{fontSize:'0.68rem',color,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:5}}>{cat.name}</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                      {vals.map(tv=>{
                        const active=selTags.includes(tv.id)
                        return (
                          <button key={tv.id} onClick={()=>!tv.auto_apply&&toggleTag(tv.id)}
                            style={{...pill(color,true),cursor:tv.auto_apply?'default':'pointer',
                              background:active?color+'33':'transparent',
                              border:`1px solid ${active?color+'88':color+'33'}`,
                              opacity:tv.auto_apply?0.7:1,transition:'all 0.15s'}}>
                            {active&&'✓ '}{tv.value}
                            {tv.auto_apply&&<span style={{fontSize:'0.58rem',marginLeft:3}}>⚡</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{marginBottom:16}}>
              <SH>Assign To</SH>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {employees.filter(u=>u.id!==currentUser.id&&u.tags_access).map(u=>{
                  const active=selAssign.includes(u.id)
                  return (
                    <button key={u.id} onClick={()=>toggleAssign(u.id)}
                      style={{...pill(active?'#F0C040':'rgba(255,255,255,0.35)',true),
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

            {pickedFiles.length>1&&(
              <div style={{background:'rgba(0,0,0,0.2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px',marginBottom:14}}>
                <div style={{fontSize:'0.75rem',color:'var(--white-dim)',marginBottom:6}}>Adding {pickedFiles.length} files — tags &amp; assignment apply to all:</div>
                {pickedFiles.map((f,i)=><div key={i} style={{fontSize:'0.8rem',color:'var(--white-soft)'}}>📄 {f.name}</div>)}
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-gold" onClick={handleSubmit} disabled={saving||!pickedFiles.length}>
                {saving?'Adding…':`➕ Add File${pickedFiles.length>1?'s':''}`}
              </button>
              <button className="btn btn-outline" onClick={()=>setStep('ocr')}>← Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bulk Actions Bar ─────────────────────────────────────────────
function BulkBar({selected,files,state,employees,currentUser,onDone}) {
  const [mode,setMode]=useState(null)
  const [selTags,setSelTags]=useState([])
  const [selAssign,setSelAssign]=useState([])
  const [saving,setSaving]=useState(false)
  const {categories,tagValues}=state

  const applyTags=async()=>{
    setSaving(true)
    for(const fid of selected){
      const f=files.find(x=>x.id===fid);if(!f)continue
      const merged=[...new Set([...(f.tag_value_ids||[]),...selTags])]
      await supabase.from('dde_tag_files').update({tag_value_ids:merged}).eq('id',fid)
    }
    setSaving(false);onDone()
  }

  const applyAssign=async()=>{
    setSaving(true)
    const ts=nowISO()
    for(const fid of selected){
      const f=files.find(x=>x.id===fid);if(!f)continue
      const merged=[...new Set([...(f.assigned_to||[]),...selAssign])]
      const se=[...(f.status_events||[]),{status:'assigned',user_id:currentUser.id,timestamp:ts,note:`Bulk assigned`}]
      await supabase.from('dde_tag_files').update({assigned_to:merged,status_events:se}).eq('id',fid)
    }
    setSaving(false);onDone()
  }

  return (
    <div style={{background:'rgba(240,192,64,0.1)',border:'1px solid rgba(240,192,64,0.3)',borderRadius:10,padding:'12px 16px',marginBottom:14}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span style={{fontWeight:600,fontSize:'0.88rem',color:'var(--gold)'}}>{selected.length} selected</span>
        <button className="btn btn-outline btn-sm" onClick={()=>setMode(mode==='tag'?null:'tag')}>🏷️ Bulk Tag</button>
        <button className="btn btn-outline btn-sm" onClick={()=>setMode(mode==='assign'?null:'assign')}>👤 Bulk Assign</button>
        <button className="btn btn-outline btn-sm" onClick={onDone} style={{marginLeft:'auto'}}>✕ Cancel</button>
      </div>
      {mode==='tag'&&(
        <div style={{marginTop:12}}>
          <SH>Add Tags to Selected Files</SH>
          <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
            {[...categories].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map((cat,ci)=>{
              const color=cat.color||catColor(ci)
              return tagValues.filter(tv=>tv.category_id===cat.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(tv=>{
                const active=selTags.includes(tv.id)
                return (
                  <button key={tv.id} onClick={()=>setSelTags(p=>p.includes(tv.id)?p.filter(x=>x!==tv.id):[...p,tv.id])}
                    style={{...pill(color,true),cursor:'pointer',background:active?color+'33':'transparent',transition:'all 0.15s'}}>
                    {active&&'✓ '}{cat.name}: {tv.value}
                  </button>
                )
              })
            })}
          </div>
          <button className="btn btn-gold btn-sm" onClick={applyTags} disabled={saving||!selTags.length}>{saving?'…':'Apply Tags'}</button>
        </div>
      )}
      {mode==='assign'&&(
        <div style={{marginTop:12}}>
          <SH>Assign Selected Files To</SH>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
            {employees.filter(u=>u.tags_access&&u.id!==currentUser.id).map(u=>{
              const active=selAssign.includes(u.id)
              return (
                <button key={u.id} onClick={()=>setSelAssign(p=>p.includes(u.id)?p.filter(x=>x!==u.id):[...p,u.id])}
                  style={{...pill(active?'#F0C040':'rgba(255,255,255,0.4)',true),cursor:'pointer',padding:'4px 10px',
                    background:active?'rgba(240,192,64,0.2)':'rgba(255,255,255,0.05)',transition:'all 0.15s'}}>
                  {active&&'✓ '}{u.first_name} {u.last_name}
                  {u.tags_role==='signoff'&&<span style={{...pill('#5EE88A',true),marginLeft:4,fontSize:'0.6rem'}}>SO</span>}
                </button>
              )
            })}
          </div>
          <button className="btn btn-gold btn-sm" onClick={applyAssign} disabled={saving||!selAssign.length}>{saving?'…':'Assign'}</button>
        </div>
      )}
    </div>
  )
}

// ─── Main TagsTab ─────────────────────────────────────────────────
export default function TagsTab({currentUser,employees}) {
  const [innerTab,setInnerTab]=useState('files')
  const [state,setState]=useState({folders:[],categories:[],tagValues:[],files:[]})
  const [loading,setLoading]=useState(true)
  const [selectedFile,setSelectedFile]=useState(null)
  const [showAddFile,setShowAddFile]=useState(false)
  const [addFolderPre,setAddFolderPre]=useState('')
  const [search,setSearch]=useState('')
  const [filterFolder,setFilterFolder]=useState('')
  const [filterTags,setFilterTags]=useState({})
  const [filterDateField,setFilterDateField]=useState('created')
  const [filterDateFrom,setFilterDateFrom]=useState('')
  const [filterDateTo,setFilterDateTo]=useState('')
  const [expandedFolder,setExpandedFolder]=useState(null)
  const [selectedIds,setSelectedIds]=useState([])
  const [showBulk,setShowBulk]=useState(false)
  const [msg,setMsg]=useState(null)

  const isSignoff=currentUser.tags_role==='signoff'

  useEffect(()=>{fetchAll()},[])

  const fetchAll=async()=>{
    setLoading(true)
    const [{data:folders},{data:categories},{data:tagValues},{data:files}]=await Promise.all([
      supabase.from('dde_tag_folders').select('*').order('name'),
      supabase.from('dde_tag_categories').select('*').order('sort_order'),
      supabase.from('dde_tag_values').select('*').order('sort_order'),
      supabase.from('dde_tag_files').select('*').order('created_at',{ascending:false}),
    ])
    setState({folders:folders||[],categories:categories||[],tagValues:tagValues||[],files:files||[]})
    setLoading(false)
  }

  const showMsg=(type,text)=>{setMsg({type,text});setTimeout(()=>setMsg(null),4500)}
  const updateFile=u=>{setState(s=>({...s,files:s.files.map(f=>f.id===u.id?u:f)}));setSelectedFile(u)}
  const addFile=f=>{setState(s=>({...s,files:[f,...s.files]}));showMsg('success',`📎 "${f.name}" added!`)}
  const deleteFile=id=>{setState(s=>({...s,files:s.files.filter(f=>f.id!==id)}));showMsg('success','File record deleted')}

  const getDateForFilter=f=>{
    if(filterDateField==='approved'){const ev=(f.status_events||[]).find(e=>e.status==='approved');return ev?.timestamp||null}
    if(filterDateField==='assigned'){const ev=(f.status_events||[]).find(e=>e.status==='assigned'||e.status==='added');return ev?.timestamp||f.created_at}
    return f.created_at
  }

  const filteredFiles=state.files.filter(f=>{
    if(search&&!f.name.toLowerCase().includes(search.toLowerCase()))return false
    if(filterFolder&&f.folder_id!==filterFolder)return false
    for(const[catId,tvIds]of Object.entries(filterTags)){
      if(!tvIds.length)continue
      if(!tvIds.some(tvId=>(f.tag_value_ids||[]).includes(tvId)))return false
    }
    const dv=getDateForFilter(f)
    if(filterDateFrom&&(!dv||new Date(dv)<new Date(filterDateFrom)))return false
    if(filterDateTo&&(!dv||new Date(dv)>new Date(filterDateTo+'T23:59:59')))return false
    return true
  })

  const toggleFilterTag=(catId,tvId)=>{
    setFilterTags(p=>{const c=p[catId]||[];return{...p,[catId]:c.includes(tvId)?c.filter(x=>x!==tvId):[...c,tvId]}})
  }
  const activeFilterCount=Object.values(filterTags).flat().length+(filterDateFrom?1:0)+(filterDateTo?1:0)

  const myAssignments=state.files.filter(f=>(f.assigned_to||[]).includes(currentUser.id))
  const myPending=myAssignments.filter(f=>!(f.signoffs||[]).some(s=>s.user_id===currentUser.id)&&!(f.status_events||[]).some(e=>e.status==='paid'))

  const toggleSelect=id=>setSelectedIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const bulkDone=()=>{setSelectedIds([]);setShowBulk(false);fetchAll()}

  if(loading)return <div style={{textAlign:'center',padding:'60px 0'}}><div className="spark-loader" style={{margin:'0 auto'}}/></div>

  return (
    <div className="fade-in">
      {msg&&<div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      {myPending.length>0&&(
        <div style={{background:'rgba(240,192,64,0.12)',border:'1px solid rgba(240,192,64,0.3)',borderRadius:10,
          padding:'12px 16px',marginBottom:20,display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}
          onClick={()=>setInnerTab('assigned')}>
          <span>⏳</span>
          <span style={{color:'#F0C040',fontWeight:600,fontSize:'0.88rem'}}>
            {myPending.length} file{myPending.length!==1?'s':''} awaiting your action
          </span>
        </div>
      )}

      <div className="tabs" style={{marginBottom:20}}>
        {[
          ['files','📎 Files'],
          ['assigned',`📬 My Assignments${myPending.length>0?` (${myPending.length})`:''}`],
          ['browse','📂 Browse Folders'],
          ['search','🔍 Search'],
        ].map(([t,label])=>(
          <button key={t} className={`tab-btn${innerTab===t?' active':''}`} onClick={()=>setInnerTab(t)}>{label}</button>
        ))}
      </div>

      {/* FILES */}
      {innerTab==='files'&&(
        <div>
          <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
            <div style={{position:'relative',flex:1,minWidth:180}}>
              <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',opacity:0.4,pointerEvents:'none'}}>🔍</span>
              <input className="form-input" style={{paddingLeft:34}} placeholder="Search files…" value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <select className="form-select" style={{width:180}} value={filterFolder} onChange={e=>setFilterFolder(e.target.value)}>
              <option value="">All Folders</option>
              {state.folders.map(fo=><option key={fo.id} value={fo.id}>{fo.name}</option>)}
            </select>
            {selectedIds.length>0&&<button className="btn btn-outline" onClick={()=>setShowBulk(true)} style={{color:'var(--gold)',borderColor:'rgba(240,192,64,0.4)'}}>✏️ Bulk ({selectedIds.length})</button>}
            <button className="btn btn-gold" onClick={()=>{setAddFolderPre('');setShowAddFile(true)}}>➕ Add File</button>
          </div>

          {showBulk&&selectedIds.length>0&&(
            <BulkBar selected={selectedIds} files={state.files} state={state} employees={employees} currentUser={currentUser} onDone={bulkDone}/>
          )}

          {filteredFiles.length===0
            ?<div className="empty-state"><div className="icon">📂</div><p>{state.files.length===0?'No files yet.':'No files match.'}</p></div>
            :(
              <div className="card" style={{padding:0}}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{width:32}}></th>
                        <th>File Name</th><th>Folder</th><th>Tags</th><th>Added By</th><th>Date</th><th>Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.map(f=>{
                        const folder=state.folders.find(fo=>fo.id===f.folder_id)
                        const adder=employees.find(u=>u.id===f.added_by)
                        const signed=(f.signoffs||[]).length>0
                        const paid=(f.status_events||[]).some(e=>e.status==='paid')
                        const pending=(f.assigned_to||[]).length>0&&!signed&&!paid
                        const sel=selectedIds.includes(f.id)
                        return (
                          <tr key={f.id} style={{cursor:'pointer',background:sel?'rgba(240,192,64,0.07)':''}}>
                            <td onClick={e=>e.stopPropagation()}>
                              <input type="checkbox" checked={sel} onChange={()=>toggleSelect(f.id)} style={{accentColor:'var(--gold)',width:15,height:15}}/>
                            </td>
                            <td style={{fontWeight:600}} onClick={()=>setSelectedFile(f)}>📄 {f.name}</td>
                            <td style={{fontSize:'0.8rem',color:'var(--white-dim)'}} onClick={()=>setSelectedFile(f)}>{folder?.name||'—'}</td>
                            <td onClick={()=>setSelectedFile(f)}>
                              <div style={{display:'flex',flexWrap:'wrap',gap:4,maxWidth:240}}>
                                <SortedTagChips tagValueIds={(f.tag_value_ids||[]).slice(0,3)} categories={state.categories} tagValues={state.tagValues} small/>
                                {(f.tag_value_ids||[]).length>3&&<span style={pill('rgba(255,255,255,0.4)',true)}>+{(f.tag_value_ids||[]).length-3}</span>}
                              </div>
                            </td>
                            <td style={{fontSize:'0.83rem'}} onClick={()=>setSelectedFile(f)}>{adder?.first_name} {adder?.last_name}</td>
                            <td style={{fontSize:'0.78rem',color:'var(--white-dim)',whiteSpace:'nowrap'}} onClick={()=>setSelectedFile(f)}>{fmtShort(f.created_at)}</td>
                            <td onClick={()=>setSelectedFile(f)}>
                              {paid?<span style={pill('#5EE88A')}>💰 Paid</span>
                                :signed?<span style={pill('#5EE88A')}>✅ Approved</span>
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

      {/* MY ASSIGNMENTS */}
      {innerTab==='assigned'&&(
        <div>
          <p style={{color:'var(--white-dim)',fontSize:'0.83rem',marginBottom:16}}>Files assigned to you. Signing off returns the file to its original assignor.</p>
          {myAssignments.length===0
            ?<div className="empty-state"><div className="icon">📬</div><p>No files assigned to you.</p></div>
            :myAssignments.map(f=>{
              const signed=(f.signoffs||[]).some(s=>s.user_id===currentUser.id)
              const paid=(f.status_events||[]).some(e=>e.status==='paid')
              const adder=employees.find(u=>u.id===f.added_by)
              const folder=state.folders.find(fo=>fo.id===f.folder_id)
              return (
                <div key={f.id} className="card" style={{marginBottom:10,cursor:'pointer',border:(!signed&&!paid)?'1px solid rgba(240,192,64,0.3)':'1px solid var(--border)'}}
                  onClick={()=>setSelectedFile(f)}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:'0.92rem',marginBottom:4}}>📄 {f.name}</div>
                      <div style={{fontSize:'0.74rem',color:'var(--white-dim)',marginBottom:8}}>📁 {folder?.name||'—'} · From {adder?.first_name} {adder?.last_name} · {fmtShort(f.created_at)}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}><SortedTagChips tagValueIds={f.tag_value_ids} categories={state.categories} tagValues={state.tagValues} small/></div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end',flexShrink:0}}>
                      {paid?<span style={pill('#5EE88A',true)}>💰 Paid</span>:signed?<span style={pill('#5EE88A',true)}>✅ Signed</span>:<span style={pill('#F0C040',true)}>⏳ Pending</span>}
                      {!signed&&!paid&&isSignoff&&(
                        <button className="btn btn-gold btn-sm" onClick={e=>{e.stopPropagation();setSelectedFile(f)}}>✅ Sign Off</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* BROWSE FOLDERS */}
      {innerTab==='browse'&&(
        <div>
          {state.folders.length===0
            ?<div className="empty-state"><div className="icon">📁</div><p>No folders registered.</p></div>
            :state.folders.map(fo=>{
              const folderFiles=state.files.filter(f=>f.folder_id===fo.id)
              const isOpen=expandedFolder===fo.id
              return (
                <div key={fo.id} className="card" style={{marginBottom:10,padding:'14px 16px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}} onClick={()=>setExpandedFolder(isOpen?null:fo.id)}>
                    <span style={{fontSize:'1.2rem'}}>{isOpen?'📂':'📁'}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:'0.92rem'}}>{fo.name}</div>
                      <div style={{fontFamily:'monospace',fontSize:'0.72rem',color:'var(--gold)',
                        background:'rgba(240,192,64,0.08)',borderRadius:4,padding:'2px 6px',
                        display:'inline-block',marginTop:3,wordBreak:'break-all'}}>{fo.path}</div>
                    </div>
                    <span style={{fontSize:'0.78rem',color:'var(--white-dim)',flexShrink:0}}>{folderFiles.length} file{folderFiles.length!==1?'s':''}</span>
                    <span style={{color:'var(--gold)',fontSize:'0.8rem',flexShrink:0}}>{isOpen?'▲':'▼'}</span>
                  </div>
                  {isOpen&&(
                    <div style={{marginTop:12,borderTop:'1px solid var(--border)',paddingTop:12}}>
                      <button className="btn btn-outline btn-sm" style={{marginBottom:10}} onClick={()=>{setAddFolderPre(fo.id);setShowAddFile(true)}}>
                        ➕ Add File to "{fo.name}"
                      </button>
                      {folderFiles.length===0
                        ?<div style={{fontSize:'0.82rem',color:'var(--white-dim)',padding:'8px 0'}}>No files tracked yet.</div>
                        :folderFiles.map(f=>{
                          const signed=(f.signoffs||[]).length>0
                          const paid=(f.status_events||[]).some(e=>e.status==='paid')
                          const adder=employees.find(u=>u.id===f.added_by)
                          return (
                            <div key={f.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:'rgba(0,0,0,0.2)',cursor:'pointer'}}
                              onClick={()=>setSelectedFile(f)}>
                              <span>📄</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontWeight:600,fontSize:'0.85rem',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div>
                                <div style={{fontSize:'0.72rem',color:'var(--white-dim)'}}>{adder?.first_name} {adder?.last_name} · {fmtShort(f.created_at)}</div>
                              </div>
                              <SortedTagChips tagValueIds={(f.tag_value_ids||[]).slice(0,2)} categories={state.categories} tagValues={state.tagValues} small/>
                              {paid?<span style={pill('#5EE88A',true)}>💰</span>:signed&&<span style={pill('#5EE88A',true)}>✅</span>}
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

      {/* SEARCH */}
      {innerTab==='search'&&(
        <div style={{display:'flex',gap:20,alignItems:'flex-start'}}>
          <div style={{width:220,flexShrink:0}}>
            <div className="card" style={{padding:'16px 14px',position:'sticky',top:80}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <SH style={{marginBottom:0}}>Filters</SH>
                {activeFilterCount>0&&<button className="btn btn-outline btn-xs" onClick={()=>{setFilterTags({});setFilterDateFrom('');setFilterDateTo('')}}>Clear ({activeFilterCount})</button>}
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:'0.67rem',color:'var(--gold)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Date Filter</div>
                <select className="form-select" style={{marginBottom:8,padding:'5px 8px',fontSize:'0.76rem'}} value={filterDateField} onChange={e=>setFilterDateField(e.target.value)}>
                  <option value="created">Date Added</option>
                  <option value="approved">Date Approved</option>
                  <option value="assigned">Date Assigned</option>
                </select>
                <div style={{marginBottom:6}}>
                  <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginBottom:3}}>From</div>
                  <input type="date" className="form-input" style={{padding:'5px 8px',fontSize:'0.75rem'}} value={filterDateFrom} onChange={e=>setFilterDateFrom(e.target.value)}/>
                </div>
                <div>
                  <div style={{fontSize:'0.7rem',color:'var(--white-dim)',marginBottom:3}}>To</div>
                  <input type="date" className="form-input" style={{padding:'5px 8px',fontSize:'0.75rem'}} value={filterDateTo} onChange={e=>setFilterDateTo(e.target.value)}/>
                </div>
              </div>
              {[...state.categories].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map((cat,ci)=>{
                const color=cat.color||catColor(ci)
                return (
                  <div key={cat.id} style={{marginBottom:12}}>
                    <div style={{fontSize:'0.67rem',color,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:5}}>{cat.name}</div>
                    {[...state.tagValues].filter(tv=>tv.category_id===cat.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(tv=>{
                      const active=(filterTags[cat.id]||[]).includes(tv.id)
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
                )
              })}
            </div>
          </div>

          <div style={{flex:1}}>
            <div style={{marginBottom:14,position:'relative'}}>
              <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',opacity:0.4}}>🔍</span>
              <input className="form-input" style={{paddingLeft:36}} placeholder="Search by file name…" value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <div style={{fontSize:'0.78rem',color:'var(--white-dim)',marginBottom:12}}>
              {filteredFiles.length} file{filteredFiles.length!==1?'s':''} found
              {(filterDateFrom||filterDateTo)&&<span style={{color:'var(--gold)',marginLeft:8}}>📅 {filterDateField}: {filterDateFrom||'…'} → {filterDateTo||'now'}</span>}
            </div>
            {filteredFiles.length===0
              ?<div className="empty-state"><div className="icon">🔍</div><p>No files match</p></div>
              :filteredFiles.map(f=>{
                const folder=state.folders.find(fo=>fo.id===f.folder_id)
                const adder=employees.find(u=>u.id===f.added_by)
                const signed=(f.signoffs||[]).length>0
                const paid=(f.status_events||[]).some(e=>e.status==='paid')
                const dv=getDateForFilter(f)
                return (
                  <div key={f.id} className="card" style={{marginBottom:10,cursor:'pointer'}} onClick={()=>setSelectedFile(f)}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                          <span>📄</span>
                          <span style={{fontWeight:700,fontSize:'0.92rem'}}>{f.name}</span>
                          {paid?<span style={pill('#5EE88A',true)}>💰 Paid</span>:signed&&<span style={pill('#5EE88A',true)}>✅ Approved</span>}
                        </div>
                        <div style={{fontSize:'0.74rem',color:'var(--white-dim)',marginBottom:8}}>
                          📁 {folder?.name||'—'} · {adder?.first_name} {adder?.last_name}
                          {dv&&<span> · {filterDateField==='approved'?'Approved':filterDateField==='assigned'?'Assigned':'Added'}: {fmtShort(dv)}</span>}
                        </div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                          <SortedTagChips tagValueIds={f.tag_value_ids} categories={state.categories} tagValues={state.tagValues} small/>
                        </div>
                      </div>
                      <button className="btn btn-outline btn-xs" onClick={e=>{e.stopPropagation();setSelectedFile(f)}}>View</button>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {selectedFile&&<FileModal file={selectedFile} state={state} currentUser={currentUser} employees={employees} onClose={()=>setSelectedFile(null)} onUpdate={updateFile} onDelete={deleteFile}/>}
      {showAddFile&&<AddFileModal state={state} currentUser={currentUser} employees={employees} onClose={()=>{setShowAddFile(false);setAddFolderPre('')}} onAdd={addFile} initialFolderId={addFolderPre}/>}
    </div>
  )
}
