import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── Grade peer groups for spark comparison ────────────────────────────────────
const PEER_GROUPS = {
  'Pre-Apprentice': ['Pre1'],
  'Apprentice':     ['A1','A2','A3','A4'],
  'Journeyman':     ['J1','J2','J3','J4'],
  'Foreman':        ['F1','F2','F3','F4'],
  'Management':     ['P1','P2','P3','P4','Owner'],
}
function getPeerGroup(grade) {
  for (const [group, grades] of Object.entries(PEER_GROUPS)) {
    if (grades.includes(grade)) return group
  }
  return null
}

// ── Star rating component ─────────────────────────────────────────────────────
function StarRating({ value, onChange, disabled }) {
  const [hovered, setHovered] = useState(0)
  const labels = ['','Poor','Below Average','Average','Good','Excellent']
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
      {[1,2,3,4,5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onMouseEnter={() => !disabled && setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => !disabled && onChange(n)}
          style={{
            background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
            fontSize: '1.6rem', lineHeight:1, padding:'2px',
            color: n <= (hovered || value) ? 'var(--gold)' : 'rgba(255,255,255,0.15)',
            transition: 'color 0.15s, transform 0.1s',
            transform: hovered === n && !disabled ? 'scale(1.2)' : 'scale(1)',
          }}
          title={labels[n]}
        >★</button>
      ))}
      <span style={{ fontSize:'0.8rem', color:'var(--white-dim)', minWidth:'110px' }}>
        {labels[hovered || value] || '—'}
      </span>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ answered, total }) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0
  return (
    <div style={{ marginBottom:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
        <span style={{ fontSize:'0.8rem', color:'var(--white-dim)' }}>Progress</span>
        <span style={{ fontSize:'0.8rem', color: pct===100 ? 'var(--green-bright)' : 'var(--gold)' }}>
          {answered}/{total} questions
        </span>
      </div>
      <div style={{ height:'6px', background:'rgba(255,255,255,0.1)', borderRadius:'3px', overflow:'hidden' }}>
        <div style={{
          height:'100%', borderRadius:'3px', transition:'width 0.4s ease',
          width:`${pct}%`,
          background: pct===100 ? 'var(--green-bright)' : 'linear-gradient(90deg, var(--gold-dark), var(--gold))'
        }}/>
      </div>
    </div>
  )
}

export default function PerformanceRatingPage() {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState(null)

  const [teamMembers, setTeamMembers] = useState([])   // employees on my team
  const [selectedEmpId, setSelectedEmpId] = useState('')
  const [categories, setCategories] = useState([])
  const [questions, setQuestions] = useState([])
  const [cycles, setCycles] = useState([])             // perf_cycles for me as foreman
  const [answers, setAnswers] = useState({})            // { questionId: score }
  const [profile, setProfile] = useState(null)          // perf_employee_profiles
  const [gradeResp, setGradeResp] = useState(null)       // perf_grade_responsibilities for this employee's grade

  const isAdmin = currentUser?.is_admin
  const grade = currentUser?.job_grade || ''
  const isForeman = isAdmin || /^[FP]/.test(grade) || grade === 'Owner'

  // ── Fetch team members for this foreman ───────────────────────────────────
  const fetchTeam = useCallback(async () => {
    setLoading(true)
    // Get teams where current user is listed as foreman
    const { data: myTeamMemberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('employee_id', currentUser.id)
    const myTeamIds = (myTeamMemberships || []).map(r => r.team_id)

    let members = []
    if (myTeamIds.length > 0) {
      const { data: teamMemberRows } = await supabase
        .from('team_members')
        .select('employee_id, employees(id, first_name, last_name, job_grade, job_title)')
        .in('team_id', myTeamIds)
        .neq('employee_id', currentUser.id)
      members = (teamMemberRows || [])
        .map(r => r.employees)
        .filter(Boolean)
        .filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i)
    }
    // Admin sees everyone
    if (isAdmin) {
      const { data: all } = await supabase
        .from('employees')
        .select('id, first_name, last_name, job_grade, job_title')
        .eq('is_admin', false)
        .order('last_name')
      members = all || []
    }
    setTeamMembers(members)

    // Load categories + questions
    const [{ data: cats }, { data: qs }] = await Promise.all([
      supabase.from('perf_categories').select('*').eq('active', true).order('sort_order'),
      supabase.from('perf_questions').select('*').eq('active', true).order('sort_order'),
    ])
    setCategories(cats || [])
    setQuestions(qs || [])

    // Load cycles assigned to me as foreman
    const { data: cycleRows } = await supabase
      .from('perf_cycles')
      .select('*, employee:employee_id(id, first_name, last_name, job_grade, job_title)')
      .eq('foreman_id', currentUser.id)
      .order('triggered_at', { ascending: false })
    setCycles(cycleRows || [])

    setLoading(false)
  }, [currentUser.id, isAdmin])

  useEffect(() => { fetchTeam() }, [fetchTeam])

  // ── When employee selected, load cycle + saved answers + profile ──────────
  const selectedCycle = useMemo(() => {
    if (!selectedEmpId) return null
    // Find open or in-progress cycle for this employee + foreman
    const open = cycles.find(c =>
      c.employee_id === selectedEmpId &&
      (c.status === 'pending' || c.status === 'in_progress')
    )
    return open || null
  }, [selectedEmpId, cycles])

  const selectedEmployee = useMemo(() => {
    // First try team members list; fall back to the employee data embedded
    // in the cycle row — this ensures grades like F4 that aren't in the
    // foreman's own team membership list can still be rated.
    const fromTeam = teamMembers.find(e => e.id === selectedEmpId)
    if (fromTeam) return fromTeam
    const fromCycle = cycles.find(c => c.employee_id === selectedEmpId)?.employee
    return fromCycle || null
  }, [teamMembers, selectedEmpId, cycles])

  useEffect(() => {
    if (!selectedCycle) { setAnswers({}); setProfile(null); setGradeResp(null); return }
    const loadAnswersAndProfile = async () => {
      const empGrade = selectedEmployee?.job_grade || ''
      const [{ data: ansRows }, { data: prof }, { data: gResp }] = await Promise.all([
        supabase.from('perf_answers').select('*').eq('cycle_id', selectedCycle.id),
        supabase.from('perf_employee_profiles').select('*').eq('employee_id', selectedEmpId).single(),
        empGrade
          ? supabase.from('perf_grade_responsibilities').select('*').eq('job_grade', empGrade).single()
          : Promise.resolve({ data: null }),
      ])
      const map = {}
      if (ansRows) ansRows.forEach(r => { map[r.question_id] = r.score })
      setAnswers(map)
      setProfile(prof || null)
      setGradeResp(gResp || null)
    }
    loadAnswersAndProfile()
  }, [selectedCycle, selectedEmpId])

  const showMsg = (text, type='success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  // ── Auto-save a single answer ─────────────────────────────────────────────
  const handleScore = async (questionId, score) => {
    if (!selectedCycle) return
    const next = { ...answers, [questionId]: score }
    setAnswers(next)
    setSaving(true)
    // Upsert answer
    await supabase.from('perf_answers').upsert({
      cycle_id: selectedCycle.id,
      question_id: questionId,
      score,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cycle_id,question_id' })
    // Mark cycle in_progress
    if (selectedCycle.status === 'pending') {
      await supabase.from('perf_cycles').update({ status: 'in_progress' }).eq('id', selectedCycle.id)
      setCycles(prev => prev.map(c => c.id === selectedCycle.id ? { ...c, status: 'in_progress' } : c))
    }
    setSaving(false)
  }

  // ── Submit cycle ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedCycle) return
    const answeredCount = Object.keys(answers).length
    if (answeredCount < questions.length) {
      showMsg(`Please answer all ${questions.length} questions before submitting.`, 'error')
      return
    }
    setSubmitting(true)
    await supabase.from('perf_cycles').update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }).eq('id', selectedCycle.id)
    setCycles(prev => prev.map(c =>
      c.id === selectedCycle.id ? { ...c, status: 'submitted' } : c
    ))
    setSelectedEmpId('')
    setAnswers({})
    showMsg('Evaluation submitted successfully!')
    setSubmitting(false)
  }

  // ── Next pending employee ─────────────────────────────────────────────────
  const pendingCycles = cycles.filter(c => c.status === 'pending' || c.status === 'in_progress')
  const nextPending = pendingCycles.find(c => c.employee_id !== selectedEmpId)

  const answered = Object.keys(answers).length
  const total = questions.length

  if (!isForeman) {
    return (
      <div className="card" style={{ textAlign:'center', padding:'60px 24px' }}>
        <div style={{ fontSize:'3rem', marginBottom:'16px' }}>🔒</div>
        <h2 style={{ color:'var(--gold)', fontFamily:'var(--font-display)', marginBottom:'8px' }}>Access Restricted</h2>
        <p style={{ color:'var(--white-dim)' }}>Performance evaluations are available to foreman and above.</p>
      </div>
    )
  }

  if (loading) return (
    <div style={{ textAlign:'center', padding:'60px' }}>
      <div className="spark-loader" style={{ margin:'0 auto' }}></div>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom:'24px' }}>
        <h1 style={{ fontFamily:'var(--font-display)', color:'var(--gold)', fontSize:'1.4rem', letterSpacing:'0.06em', marginBottom:'6px' }}>
          📋 Performance Evaluations
        </h1>
        <p style={{ color:'var(--white-dim)', fontSize:'0.88rem' }}>
          Rate each team member across all evaluation categories. Answers save automatically.
        </p>
      </div>

      {msg && (
        <div className="card" style={{
          marginBottom:'16px', padding:'12px 18px',
          borderColor: msg.type==='error' ? 'rgba(224,85,85,0.5)' : 'rgba(94,232,138,0.4)',
          color: msg.type==='error' ? 'var(--red)' : 'var(--green-bright)',
        }}>
          {msg.text}
        </div>
      )}

      {/* ── Pending evaluations summary ── */}
      {pendingCycles.length > 0 && (
        <div className="card" style={{ marginBottom:'20px', borderColor:'rgba(240,192,64,0.4)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
            <span style={{ fontFamily:'var(--font-display)', color:'var(--gold)', fontSize:'0.9rem', letterSpacing:'0.05em' }}>
              ⏳ Pending Evaluations ({pendingCycles.length})
            </span>
            {saving && <span style={{ fontSize:'0.75rem', color:'var(--white-dim)' }}>Saving…</span>}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
            {pendingCycles.map(c => {
              const emp = c.employee
              const isSelected = c.employee_id === selectedEmpId
              const isInProgress = c.status === 'in_progress'
              return (
                <button
                  key={c.id}
                  className={`btn ${isSelected ? 'btn-gold' : 'btn-outline'}`}
                  style={{ fontSize:'0.8rem', position:'relative' }}
                  onClick={() => setSelectedEmpId(isSelected ? '' : c.employee_id)}
                >
                  {isInProgress && (
                    <span style={{
                      position:'absolute', top:'-4px', right:'-4px',
                      width:'10px', height:'10px', borderRadius:'50%',
                      background:'var(--gold)', border:'2px solid var(--bg-darker)'
                    }}/>
                  )}
                  {emp?.first_name} {emp?.last_name}
                  <span style={{ opacity:0.6, marginLeft:'4px', fontSize:'0.72rem' }}>
                    {emp?.job_grade}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {pendingCycles.length === 0 && (
        <div className="card" style={{ textAlign:'center', padding:'40px', marginBottom:'20px' }}>
          <div style={{ fontSize:'2rem', marginBottom:'10px' }}>✅</div>
          <p style={{ color:'var(--white-dim)' }}>No pending evaluations. The admin will trigger new cycles when needed.</p>
        </div>
      )}

      {/* ── Evaluation form ── */}
      {selectedEmpId && selectedEmployee && (
        <div>
          {/* Employee header */}
          <div className="card" style={{ marginBottom:'16px', borderColor:'rgba(240,192,64,0.35)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'12px' }}>
              <div>
                <h2 style={{ fontFamily:'var(--font-display)', color:'var(--gold)', fontSize:'1.1rem', letterSpacing:'0.06em', marginBottom:'4px' }}>
                  {selectedEmployee.first_name} {selectedEmployee.last_name}
                </h2>
                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <span style={{
                    fontSize:'0.78rem', padding:'3px 10px', borderRadius:'20px',
                    background:'rgba(240,192,64,0.12)', border:'1px solid rgba(240,192,64,0.35)',
                    color:'var(--gold-light)'
                  }}>
                    {selectedEmployee.job_grade || 'No Grade'}
                  </span>
                  {selectedEmployee.job_title && (
                    <span style={{ fontSize:'0.82rem', color:'var(--white-dim)' }}>
                      {selectedEmployee.job_title}
                    </span>
                  )}
                  {selectedCycle && (
                    <span style={{ fontSize:'0.78rem', color:'var(--white-dim)' }}>
                      Eval period: {new Date(selectedCycle.start_date + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                      {' – '}
                      {new Date(selectedCycle.end_date + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                    </span>
                  )}
                </div>
              </div>
              {selectedCycle?.status === 'submitted' && (
                <span style={{ fontSize:'0.78rem', color:'var(--green-bright)', border:'1px solid rgba(94,232,138,0.4)', borderRadius:'20px', padding:'3px 10px' }}>
                  ✓ Submitted
                </span>
              )}
            </div>

            {/* Responsibilities — grade-level + employee-specific */}
            {(gradeResp?.responsibilities || profile?.responsibilities) && (
              <details style={{ marginTop:'16px' }}>
                <summary style={{ cursor:'pointer', color:'var(--gold-light)', fontSize:'0.85rem', userSelect:'none' }}>
                  📄 Job Responsibilities
                  {gradeResp?.responsibilities && profile?.responsibilities && (
                    <span style={{ fontSize:'0.72rem', color:'var(--white-dim)', marginLeft:'8px' }}>
                      (grade standard + individual)
                    </span>
                  )}
                </summary>

                {/* Grade-level responsibilities */}
                {gradeResp?.responsibilities && (
                  <div style={{ marginTop:'10px' }}>
                    <div style={{
                      fontSize:'0.72rem', letterSpacing:'0.06em',
                      color:'var(--gold)', marginBottom:'6px'
                    }}>
                      {selectedEmployee?.job_grade} — STANDARD RESPONSIBILITIES
                    </div>
                    <div style={{
                      padding:'12px', borderRadius:'8px',
                      background:'rgba(240,192,64,0.06)', border:'1px solid rgba(240,192,64,0.15)',
                      fontSize:'0.83rem', color:'var(--white-soft)', lineHeight:1.7,
                      whiteSpace:'pre-wrap', maxHeight:'180px', overflowY:'auto'
                    }}>
                      {gradeResp.responsibilities}
                    </div>
                  </div>
                )}

                {/* Employee-specific additional responsibilities */}
                {profile?.responsibilities && (
                  <div style={{ marginTop:'10px' }}>
                    <div style={{
                      fontSize:'0.72rem', letterSpacing:'0.06em',
                      color:'var(--green-bright)', marginBottom:'6px'
                    }}>
                      ADDITIONAL / INDIVIDUAL RESPONSIBILITIES
                    </div>
                    <div style={{
                      padding:'12px', borderRadius:'8px',
                      background:'rgba(94,232,138,0.05)', border:'1px solid rgba(94,232,138,0.15)',
                      fontSize:'0.83rem', color:'var(--white-soft)', lineHeight:1.7,
                      whiteSpace:'pre-wrap', maxHeight:'180px', overflowY:'auto'
                    }}>
                      {profile.responsibilities}
                    </div>
                  </div>
                )}
              </details>
            )}
          </div>

          {/* Progress */}
          <ProgressBar answered={answered} total={total} />

          {/* Questions by category */}
          {categories.map(cat => {
            const catQs = questions.filter(q => q.category_id === cat.id)
            if (catQs.length === 0) return null
            const catAnswered = catQs.filter(q => answers[q.id]).length
            const catAvg = catQs.length > 0
              ? catQs.reduce((s, q) => s + (answers[q.id] || 0), 0) / catAnswered
              : 0
            return (
              <div key={cat.id} className="card" style={{ marginBottom:'16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
                  <h3 style={{ fontFamily:'var(--font-display)', color:'var(--gold)', fontSize:'0.95rem', letterSpacing:'0.06em', margin:0 }}>
                    {cat.name}
                  </h3>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <span style={{ fontSize:'0.75rem', color:'var(--white-dim)' }}>{catAnswered}/{catQs.length}</span>
                    {catAnswered > 0 && (
                      <span style={{ fontSize:'0.8rem', color:'var(--gold)', fontWeight:600 }}>
                        avg {catAvg.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
                {cat.description && (
                  <p style={{ fontSize:'0.8rem', color:'var(--white-dim)', marginBottom:'14px', lineHeight:1.5 }}>
                    {cat.description}
                  </p>
                )}
                <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
                  {catQs.map((q, idx) => (
                    <div key={q.id} style={{
                      padding:'14px', borderRadius:'8px',
                      background: answers[q.id] ? 'rgba(240,192,64,0.06)' : 'rgba(0,0,0,0.2)',
                      border: `1px solid ${answers[q.id] ? 'rgba(240,192,64,0.2)' : 'rgba(255,255,255,0.06)'}`,
                      transition:'all 0.2s'
                    }}>
                      <p style={{ fontSize:'0.88rem', color:'var(--white-soft)', marginBottom:'10px', lineHeight:1.5 }}>
                        <span style={{ color:'var(--white-dim)', marginRight:'6px', fontSize:'0.78rem' }}>Q{idx+1}.</span>
                        {q.text}
                      </p>
                      <StarRating
                        value={answers[q.id] || 0}
                        onChange={(score) => handleScore(q.id, score)}
                        disabled={selectedCycle?.status === 'submitted'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Submit controls */}
          {selectedCycle?.status !== 'submitted' && (
            <div className="card" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
              <div>
                <p style={{ fontSize:'0.85rem', color: answered === total ? 'var(--green-bright)' : 'var(--white-dim)', margin:0 }}>
                  {answered === total
                    ? '✓ All questions answered — ready to submit'
                    : `${total - answered} question${total - answered !== 1 ? 's' : ''} remaining`}
                </p>
              </div>
              <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
                {nextPending && (
                  <button
                    className="btn btn-outline"
                    onClick={() => setSelectedEmpId(nextPending.employee_id)}
                  >
                    Skip → {nextPending.employee?.first_name} {nextPending.employee?.last_name}
                  </button>
                )}
                <button
                  className="btn btn-gold"
                  disabled={answered < total || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? 'Submitting…' : '✓ Submit Evaluation'}
                </button>
              </div>
            </div>
          )}

          {selectedCycle?.status === 'submitted' && (
            <div className="card" style={{ textAlign:'center', borderColor:'rgba(94,232,138,0.4)' }}>
              <p style={{ color:'var(--green-bright)', marginBottom:'12px' }}>
                ✓ This evaluation has been submitted.
              </p>
              {nextPending && (
                <button className="btn btn-gold" onClick={() => setSelectedEmpId(nextPending.employee_id)}>
                  Next → {nextPending.employee?.first_name} {nextPending.employee?.last_name}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
