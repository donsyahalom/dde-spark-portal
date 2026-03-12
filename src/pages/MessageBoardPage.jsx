import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const DOC_ICONS = ['📄','📋','📁','📊','📈','📝','🔒','⚠️','📢','🛠️','💼','📌','🗂️','📑','🏗️']

export default function MessageBoardPage() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.is_admin
  const [section, setSection] = useState('board') // 'board' | 'docs'

  // Message board
  const [posts, setPosts] = useState([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [pushEmail, setPushEmail] = useState(false)
  const [pushSms, setPushSms] = useState(false)
  const [postLoading, setPostLoading] = useState(false)
  const [postMsg, setPostMsg] = useState(null)

  // Documents
  const [docs, setDocs] = useState([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docForm, setDocForm] = useState({ title:'', description:'', icon:'📄', file_url:'', file_name:'' })
  const [editingDoc, setEditingDoc] = useState(null)
  const [docMsg, setDocMsg] = useState(null)
  const [docLoading, setDocLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(null) // slug
  const [historyData, setHistoryData] = useState([])
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetchPosts()
    fetchDocs()
    // Realtime
    const ch = supabase.channel('mb-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'message_board'},fetchPosts)
      .on('postgres_changes',{event:'*',schema:'public',table:'company_documents'},fetchDocs)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const fetchPosts = async () => {
    setPostsLoading(true)
    const { data } = await supabase.from('message_board')
      .select('*, author:author_id(first_name,last_name)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setPosts(data)
    setPostsLoading(false)
  }

  const fetchDocs = async () => {
    setDocsLoading(true)
    const { data } = await supabase.from('company_documents')
      .select('*').eq('is_current', true)
      .order('created_at', { ascending: false })
    if (data) setDocs(data)
    setDocsLoading(false)
  }

  const fetchDocHistory = async (slug) => {
    const { data } = await supabase.from('company_documents')
      .select('*, uploader:uploaded_by(first_name,last_name)')
      .eq('slug', slug)
      .order('version', { ascending: false })
    if (data) setHistoryData(data)
    setShowHistory(slug)
  }

  // ── POST ──
  const handlePost = async () => {
    if (!newBody.trim()) { setPostMsg({ type:'error', text:'Message body required' }); return }
    setPostLoading(true); setPostMsg(null)
    const { error } = await supabase.from('message_board').insert({
      author_id: currentUser.id, title: newTitle.trim()||null, body: newBody.trim(),
      push_email: pushEmail, push_sms: pushSms,
    })
    if (error) { setPostMsg({ type:'error', text:error.message }); setPostLoading(false); return }

    // If push requested, invoke edge function
    if (pushEmail || pushSms) {
      try {
        await supabase.functions.invoke('send-spark-summary', {
          body: { broadcast: true, subject: newTitle||'New Message Board Post', message: newBody.trim(), pushEmail, pushSms }
        })
      } catch(e) { console.warn('broadcast failed', e) }
    }

    setNewTitle(''); setNewBody(''); setPushEmail(false); setPushSms(false)
    setPostMsg({ type:'success', text:'Post published!' })
    setPostLoading(false); fetchPosts()
  }

  const deletePost = async (id) => {
    if (!window.confirm('Delete this post?')) return
    await supabase.from('message_board').delete().eq('id', id)
    fetchPosts()
  }

  // ── DOCUMENTS ──
  const handleFileUpload = async (file) => {
    if (!file) return
    // Upload to Supabase storage
    const ext = file.name.split('.').pop()
    const path = `docs/${Date.now()}-${file.name}`
    const { data, error } = await supabase.storage.from('company-docs').upload(path, file, { upsert: true })
    if (error) { setDocMsg({ type:'error', text:`Upload failed: ${error.message}` }); return null }
    const { data: { publicUrl } } = supabase.storage.from('company-docs').getPublicUrl(path)
    return { url: publicUrl, name: file.name }
  }

  const saveDocument = async () => {
    if (!docForm.title.trim()) { setDocMsg({ type:'error', text:'Title required' }); return }
    setDocLoading(true); setDocMsg(null)

    // Handle file
    let fileUrl = docForm.file_url, fileName = docForm.file_name
    const fileEl = fileInputRef.current
    if (fileEl?.files?.[0]) {
      const result = await handleFileUpload(fileEl.files[0])
      if (result) { fileUrl = result.url; fileName = result.name }
    }

    if (editingDoc) {
      // New version of existing doc
      const newVersion = (editingDoc.version||1) + 1
      // Mark old as not current
      await supabase.from('company_documents').update({ is_current: false }).eq('slug', editingDoc.slug)
      // Insert new version
      await supabase.from('company_documents').insert({
        slug: editingDoc.slug, version: newVersion, is_current: true,
        title: docForm.title.trim(), description: docForm.description.trim()||null,
        icon: docForm.icon||'📄', file_url: fileUrl||null, file_name: fileName||null,
        uploaded_by: currentUser.id,
      })
      setDocMsg({ type:'success', text:`Document updated (v${newVersion})` })
    } else {
      // New document
      const slug = docForm.title.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now()
      await supabase.from('company_documents').insert({
        slug, version: 1, is_current: true,
        title: docForm.title.trim(), description: docForm.description.trim()||null,
        icon: docForm.icon||'📄', file_url: fileUrl||null, file_name: fileName||null,
        uploaded_by: currentUser.id,
      })
      setDocMsg({ type:'success', text:'Document added!' })
    }

    setDocLoading(false); setEditingDoc(null); setDocForm({ title:'', description:'', icon:'📄', file_url:'', file_name:'' })
    if (fileEl) fileEl.value = ''
    fetchDocs()
  }

  const openEditDoc = (doc) => {
    setEditingDoc(doc)
    setDocForm({ title: doc.title, description: doc.description||'', icon: doc.icon||'📄', file_url: doc.file_url||'', file_name: doc.file_name||'' })
    setDocMsg(null)
  }

  const deleteDoc = async (slug) => {
    if (!window.confirm('Archive this document? All versions will be hidden.')) return
    await supabase.from('company_documents').update({ is_current: false }).eq('slug', slug)
    fetchDocs()
  }

  const fmtDateTime = (d) => new Date(d).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })

  return (
    <div className="fade-in">
      <h1 className="page-title">📢 Company Board</h1>
      <p className="page-subtitle">Announcements and company resources</p>

      {/* Section tabs */}
      <div className="tabs" style={{marginBottom:'20px'}}>
        <button className={`tab-btn${section==='board'?' active':''}`} onClick={()=>setSection('board')}>📢 Message Board</button>
        <button className={`tab-btn${section==='docs'?' active':''}`} onClick={()=>setSection('docs')}>📁 Company Documents</button>
      </div>

      {/* ── MESSAGE BOARD ── */}
      {section==='board'&&(
        <div>
          {/* Admin post form */}
          {isAdmin&&(
            <div className="card" style={{marginBottom:'20px'}}>
              <div className="card-title"><span className="icon">✍️</span> New Post</div>
              {postMsg&&<div className={`alert alert-${postMsg.type}`}>{postMsg.text}</div>}
              <div className="form-group">
                <label className="form-label">Title <span style={{color:'var(--white-dim)',fontWeight:400}}>(optional)</span></label>
                <input className="form-input" value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Post headline..." maxLength={120} />
              </div>
              <div className="form-group">
                <label className="form-label">Message *</label>
                <textarea className="form-textarea" rows={5} value={newBody} onChange={e=>setNewBody(e.target.value)} placeholder="Write your announcement..." />
              </div>
              <div style={{display:'flex',gap:'16px',alignItems:'center',flexWrap:'wrap',marginBottom:'14px'}}>
                <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'0.85rem'}}>
                  <input type="checkbox" checked={pushEmail} onChange={e=>setPushEmail(e.target.checked)} style={{accentColor:'var(--gold)'}} />
                  Push via Email
                </label>
                <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'0.85rem'}}>
                  <input type="checkbox" checked={pushSms} onChange={e=>setPushSms(e.target.checked)} style={{accentColor:'var(--gold)'}} />
                  Push via SMS
                </label>
              </div>
              <button className="btn btn-gold" onClick={handlePost} disabled={postLoading||!newBody.trim()}>
                {postLoading?'Posting...':'📢 Publish Post'}
              </button>
            </div>
          )}

          {/* Posts feed */}
          {postsLoading ? <div style={{textAlign:'center',padding:'30px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
          : posts.length===0 ? <div className="empty-state"><div className="icon">📢</div><p>No posts yet</p></div>
          : posts.map(post=>(
            <div key={post.id} className="card" style={{marginBottom:'14px',padding:'20px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'10px',marginBottom:'8px'}}>
                <div>
                  {post.title&&<div style={{fontFamily:'var(--font-display)',fontSize:'1rem',color:'var(--gold)',marginBottom:'4px'}}>{post.title}</div>}
                  <div style={{fontSize:'0.75rem',color:'var(--white-dim)'}}>
                    {post.author?`${post.author.first_name} ${post.author.last_name}`:' Admin'}
                    {' · '}{fmtDateTime(post.created_at)}
                    {(post.push_email||post.push_sms)&&(
                      <span style={{marginLeft:'8px',color:'var(--gold)'}}>
                        {post.push_email&&'📧'}{post.push_sms&&' 📱'}
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin&&(
                  <button onClick={()=>deletePost(post.id)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--white-dim)',fontSize:'1rem',padding:'2px 6px',borderRadius:'4px',transition:'all 0.15s'}}
                    title="Delete post" onMouseEnter={e=>e.target.style.color='var(--red)'} onMouseLeave={e=>e.target.style.color='var(--white-dim)'}>✕</button>
                )}
              </div>
              <div style={{fontSize:'0.9rem',lineHeight:'1.6',color:'var(--white-soft)',whiteSpace:'pre-wrap'}}>{post.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── COMPANY DOCUMENTS ── */}
      {section==='docs'&&(
        <div>
          {/* Admin: add/edit form */}
          {isAdmin&&(
            <div className="card" style={{marginBottom:'20px'}}>
              <div className="card-title"><span className="icon">{editingDoc?'✏️':'➕'}</span> {editingDoc?`Update: ${editingDoc.title}`:'Add Document'}</div>
              {docMsg&&<div className={`alert alert-${docMsg.type}`}>{docMsg.text}</div>}

              {/* Icon picker */}
              <div className="form-group">
                <label className="form-label">Icon</label>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'6px'}}>
                  {DOC_ICONS.map(ic=>(
                    <button key={ic} onClick={()=>setDocForm(f=>({...f,icon:ic}))}
                      style={{fontSize:'1.3rem',padding:'4px 6px',background:docForm.icon===ic?'rgba(240,192,64,0.2)':'rgba(0,0,0,0.2)',border:`1px solid ${docForm.icon===ic?'var(--border-bright)':'var(--border)'}`,borderRadius:'6px',cursor:'pointer',transition:'all 0.15s'}}>
                      {ic}
                    </button>
                  ))}
                </div>
                <span style={{fontSize:'0.82rem',color:'var(--white-dim)'}}>Selected: {docForm.icon}</span>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Title *</label>
                  <input className="form-input" value={docForm.title} onChange={e=>setDocForm(f=>({...f,title:e.target.value}))} placeholder="Employee Handbook" />
                </div>
                <div className="form-group">
                  <label className="form-label">Upload File</label>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png"
                    style={{background:'rgba(0,0,0,0.3)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--white)',padding:'8px',width:'100%',fontSize:'0.85rem'}} />
                  {docForm.file_name&&<div style={{fontSize:'0.72rem',color:'var(--white-dim)',marginTop:'3px'}}>Current: {docForm.file_name}</div>}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" rows={3} value={docForm.description} onChange={e=>setDocForm(f=>({...f,description:e.target.value}))} placeholder="Brief description of this document..." style={{minHeight:'70px'}} />
              </div>
              <div className="form-group">
                <label className="form-label">Or Link URL <span style={{color:'var(--white-dim)',fontWeight:400}}>(if no file upload)</span></label>
                <input className="form-input" value={docForm.file_url} onChange={e=>setDocForm(f=>({...f,file_url:e.target.value}))} placeholder="https://..." />
              </div>
              <div style={{display:'flex',gap:'10px'}}>
                <button className="btn btn-gold" onClick={saveDocument} disabled={docLoading||!docForm.title.trim()}>
                  {docLoading?'Saving...':(editingDoc?'📝 Save New Version':'➕ Add Document')}
                </button>
                {editingDoc&&<button className="btn btn-outline" onClick={()=>{setEditingDoc(null);setDocForm({title:'',description:'',icon:'📄',file_url:'',file_name:''})}}>Cancel</button>}
              </div>
            </div>
          )}

          {/* Documents grid */}
          {docsLoading ? <div style={{textAlign:'center',padding:'30px'}}><div className="spark-loader" style={{margin:'0 auto'}}></div></div>
          : docs.length===0 ? <div className="empty-state"><div className="icon">📁</div><p>No documents yet</p></div>
          : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:'14px'}}>
              {docs.map(doc=>(
                <div key={doc.id} className="card" style={{padding:'18px',display:'flex',flexDirection:'column',gap:'10px'}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'8px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                      <span style={{fontSize:'2rem'}}>{doc.icon||'📄'}</span>
                      <div>
                        <div style={{fontFamily:'var(--font-display)',fontSize:'0.9rem',color:'var(--gold)',lineHeight:1.2}}>{doc.title}</div>
                        <div style={{fontSize:'0.68rem',color:'var(--white-dim)',marginTop:'2px'}}>v{doc.version} · {new Date(doc.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                    {isAdmin&&(
                      <div style={{display:'flex',gap:'4px',flexShrink:0}}>
                        <button className="btn btn-outline btn-xs" onClick={()=>openEditDoc(doc)} title="Update document">✏️</button>
                        <button onClick={()=>fetchDocHistory(doc.slug)} className="btn btn-outline btn-xs" title="Version history">🕐</button>
                        <button onClick={()=>deleteDoc(doc.slug)} className="btn btn-danger btn-xs" title="Archive">✕</button>
                      </div>
                    )}
                  </div>
                  {doc.description&&<p style={{fontSize:'0.83rem',color:'var(--white-dim)',lineHeight:1.5}}>{doc.description}</p>}
                  {(doc.file_url||doc.file_name)&&(
                    <a href={doc.file_url||'#'} target="_blank" rel="noopener noreferrer"
                      style={{display:'inline-flex',alignItems:'center',gap:'6px',background:'rgba(240,192,64,0.1)',border:'1px solid var(--border-bright)',borderRadius:'6px',padding:'6px 12px',color:'var(--gold)',fontSize:'0.78rem',textDecoration:'none',fontFamily:'var(--font-display)',letterSpacing:'0.06em',transition:'all 0.15s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(240,192,64,0.2)'}
                      onMouseLeave={e=>e.currentTarget.style.background='rgba(240,192,64,0.1)'}>
                      ⬇️ {doc.file_name||'Open Document'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Version history modal */}
          {showHistory&&(
            <div className="modal-overlay" onClick={()=>{setShowHistory(null);setHistoryData([])}}>
              <div className="modal" style={{maxWidth:'600px'}} onClick={e=>e.stopPropagation()}>
                <div className="modal-title">🕐 Version History</div>
                {historyData.length===0 ? <p style={{color:'var(--white-dim)'}}>No history found</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Version</th><th>Title</th><th>Uploaded</th><th>By</th><th>File</th><th>Current</th></tr></thead>
                      <tbody>
                        {historyData.map(h=>(
                          <tr key={h.id}>
                            <td><span className="spark-badge">v{h.version}</span></td>
                            <td style={{fontWeight:600,fontSize:'0.85rem'}}>{h.title}</td>
                            <td style={{fontSize:'0.78rem',color:'var(--white-dim)',whiteSpace:'nowrap'}}>{fmtDateTime(h.created_at)}</td>
                            <td style={{fontSize:'0.78rem'}}>{h.uploader?`${h.uploader.first_name} ${h.uploader.last_name}`:'—'}</td>
                            <td>{h.file_url?<a href={h.file_url} target="_blank" rel="noopener noreferrer" style={{color:'var(--gold)',fontSize:'0.78rem'}}>View</a>:'—'}</td>
                            <td>{h.is_current?<span className="chip chip-green">Current</span>:<span className="chip chip-gold">Archived</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button className="btn btn-outline" style={{marginTop:'16px'}} onClick={()=>{setShowHistory(null);setHistoryData([])}}>Close</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
