import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── Peer groups for spark comparison ─────────────────────────────────────────
const PEER_GROUPS = {
  'Pre-Apprentice': ['Pre1'],
  'Apprentice':     ['A1','A2','A3','A4'],
  'Journeyman':     ['J1','J2','J3','J4'],
  'Foreman':        ['F1','F2','F3','F4'],
  'Management':     ['P1','P2','P3','P4','Owner'],
}
function getPeerGroupLabel(grade) {
  for (const [group, grades] of Object.entries(PEER_GROUPS)) {
    if (grades.includes(grade)) return group
  }
  return 'Other'
}

// ── Count weekdays between two date strings ───────────────────────────────────
function countWorkdays(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00')
  const end   = new Date(endStr   + 'T00:00:00')
  let count = 0, d = new Date(start)
  while (d <= end) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

// ── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score }) {
  if (!score && score !== 0) return <span style={{ color:'var(--white-dim)' }}>—</span>
  const s = parseFloat(score)
  const color = s >= 4.5 ? 'var(--green-bright)' : s >= 3.5 ? 'var(--gold)' : s >= 2.5 ? 'var(--gold-dark)' : 'var(--red)'
  return (
    <span style={{
      fontWeight:600, fontSize:'0.9rem', color,
      background: 'rgba(0,0,0,0.3)', padding:'2px 10px', borderRadius:'20px',
      border:`1px solid ${color}40`
    }}>
      {s.toFixed(1)}/5
    </span>
  )
}

// ── Mini sparkline ────────────────────────────────────────────────────────────
function Sparkline({ scores }) {
  if (!scores || scores.length === 0) return <span style={{ color:'var(--white-dim)', fontSize:'0.78rem' }}>No data</span>
  const max = 5, w = 60, h = 24
  const pts = scores.map((s, i) => {
    const x = scores.length === 1 ? w/2 : (i / (scores.length-1)) * w
    const y = h - (s/max)*h
    return `${x},${y}`
  })
  return (
    <svg width={w} height={h} style={{ display:'inline-block', verticalAlign:'middle' }}>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--gold)" strokeWidth="1.5" strokeLinejoin="round"/>
      {scores.map((s, i) => {
        const x = scores.length === 1 ? w/2 : (i/(scores.length-1))*w
        const y = h - (s/max)*h
        return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--gold)"/>
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PerformanceAdminPanel({ employees, showMsg }) {
  const { currentUser } = useAuth()
  const [subTab, setSubTab] = useState('questions')
  const [loading, setLoading] = useState(false)

  // ── Questions/categories ──────────────────────────────────────────────────
  const [categories, setCategories] = useState([])
  const [questions, setQuestions]   = useState([])
  const [newCatName, setNewCatName] = useState('')
  const [newCatDesc, setNewCatDesc] = useState('')
  const [newQText, setNewQText]     = useState('')
  const [newQCatId, setNewQCatId]   = useState('')
  const [editingCat, setEditingCat] = useState(null)
  const [editingQ,   setEditingQ]   = useState(null)

  // ── Triggers ──────────────────────────────────────────────────────────────
  const [triggerEmpId,   setTriggerEmpId]   = useState('')
  const [triggerTeamId,  setTriggerTeamId]  = useState('')
  const [triggerForemanId, setTriggerForemanId] = useState('')
  const [triggerStart,   setTriggerStart]   = useState('')
  const [triggerEnd,     setTriggerEnd]     = useState('')
  const [triggerMode,    setTriggerMode]    = useState('employee') // 'employee' | 'team'
  // Due date defaults to 7 days from today
  const defaultDueDate = () => {
    const d = new Date(); d.setDate(d.getDate() + 7)
    return d.toISOString().split('T')[0]
  }
  const [triggerDueDate, setTriggerDueDate] = useState(defaultDueDate)
  const [teams, setTeams] = useState([])
  const [teamMembers, setTeamMembers] = useState([])  // { team_id, employee_id, employees{} }
  const [triggerLoading, setTriggerLoading] = useState(false)

  // ── Results / Reports ─────────────────────────────────────────────────────
  const [cycles, setCycles]       = useState([])
  const [answers, setAnswers]     = useState([])  // all answers
  const [profiles, setProfiles]   = useState([])
  const [gradeResponsibilities, setGradeResponsibilities] = useState([])  // { id, job_grade, responsibilities }
  const [sparkStats, setSparkStats] = useState({})  // { empId: { given, allotted, received, receivedByReason } }
  const [filterEmpId, setFilterEmpId] = useState('')
  const [editProfile, setEditProfile] = useState(null)  // { employee_id, responsibilities }
  const [profileText, setProfileText] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [editGradeResp, setEditGradeResp] = useState(null)  // { job_grade }
  const [gradeRespText, setGradeRespText] = useState('')
  const [gradeRespSaving, setGradeRespSaving] = useState(false)
  const [profilesSubTab, setProfilesSubTab] = useState('grades')  // 'grades' | 'employees'
  const [workdayOverride, setWorkdayOverride] = useState({})  // cycleId -> override value string
  const [systemGrades, setSystemGrades] = useState([])  // all grades from custom_lists in sort order

  // ── Grade compensation ────────────────────────────────────────────────────
  const [gradeCompensation, setGradeCompensation] = useState([])  // { job_grade, wage_type, wage_min, wage_max, target_bonus_pct, bonus_share_pct }
  const [editGradeComp, setEditGradeComp] = useState(null)  // { job_grade }
  const [gradeCompValues, setGradeCompValues] = useState({ wage_type:'hourly', wage_min:'', wage_max:'', target_bonus_pct:'', bonus_share_pct:'' })
  const [gradeCompSaving, setGradeCompSaving] = useState(false)

  // ── Load all data ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [
        { data: cats },
        { data: qs },
        { data: cycleRows },
        { data: ansRows },
        { data: profRows },
        { data: gradeRespRows },
        { data: gradeListRows },
        { data: gradeCompData },
        { data: teamsData },
        { data: membersData },
        { data: sparkTxns },
        { data: empAllocData },
      ] = await Promise.all([
        supabase.from('perf_categories').select('*').order('sort_order'),
        supabase.from('perf_questions').select('*').order('category_id').order('sort_order'),
        supabase.from('perf_cycles')
          .select('*, employee:employee_id(id,first_name,last_name,job_grade,job_title), foreman:foreman_id(id,first_name,last_name)')
          .order('triggered_at', { ascending:false }),
        supabase.from('perf_answers').select('*, question:question_id(category_id)'),
        supabase.from('perf_employee_profiles').select('*'),
        supabase.from('perf_grade_responsibilities').select('*').order('job_grade'),
        supabase.from('custom_lists').select('value, sort_order').eq('list_type', 'job_grade').order('sort_order'),
        supabase.from('perf_grade_compensation').select('*').order('job_grade'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('team_members').select('team_id, employee_id, employees(id,first_name,last_name,job_grade,job_title)'),
        supabase.from('spark_transactions').select('from_employee_id, to_employee_id, amount, reason, transaction_type').eq('transaction_type', 'assign'),
        supabase.from('employees').select('id, daily_sparks_remaining, daily_accrual'),
      ])
      setCategories(cats || [])
      setQuestions(qs || [])
      setCycles(cycleRows || [])
      setAnswers(ansRows || [])
      setProfiles(profRows || [])
      setGradeResponsibilities(gradeRespRows || [])
      setSystemGrades((gradeListRows || []).map(r => r.value))
      setGradeCompensation(gradeCompData || [])
      setTeams(teamsData || [])
      setTeamMembers(membersData || [])

      // ── Build per-employee sparks stats ──────────────────────────────────
      const txns = sparkTxns || []
      const allocMap = {}
      ;(empAllocData || []).forEach(e => { allocMap[e.id] = e })
      const stats = {}
      txns.forEach(t => {
        // Given
        if (t.from_employee_id) {
          if (!stats[t.from_employee_id]) stats[t.from_employee_id] = { given:0, allotted:0, received:0, receivedByReason:{} }
          stats[t.from_employee_id].given += t.amount
        }
        // Received
        if (t.to_employee_id) {
          if (!stats[t.to_employee_id]) stats[t.to_employee_id] = { given:0, allotted:0, received:0, receivedByReason:{} }
          stats[t.to_employee_id].received += t.amount
          const cat = (t.reason || '').split(':')[0].trim() || 'Unspecified'
          stats[t.to_employee_id].receivedByReason[cat] = (stats[t.to_employee_id].receivedByReason[cat] || 0) + t.amount
        }
      })
      // Allotted = accrual (what they earn per period, used as the denominator baseline)
      Object.keys(stats).forEach(id => {
        const emp = allocMap[id]
        stats[id].allotted = emp ? (emp.daily_accrual || 0) : 0
      })
      setSparkStats(stats)
    } catch (err) {
      console.error('PerformanceAdminPanel fetchAll error:', err)
      showMsg('Error loading performance data. Make sure the SQL migrations have been run in Supabase.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Category CRUD ─────────────────────────────────────────────────────────
  const addCategory = async () => {
    if (!newCatName.trim()) return
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)
    const { error } = await supabase.from('perf_categories').insert({
      name: newCatName.trim(), description: newCatDesc.trim() || null, sort_order: maxOrder + 1
    })
    if (error) { showMsg('Error adding category', 'error'); return }
    setNewCatName(''); setNewCatDesc('')
    showMsg('Category added')
    fetchAll()
  }
  const toggleCat = async (cat) => {
    await supabase.from('perf_categories').update({ active: !cat.active }).eq('id', cat.id)
    fetchAll()
  }
  const saveEditCat = async () => {
    if (!editingCat) return
    await supabase.from('perf_categories').update({ name: editingCat.name, description: editingCat.description }).eq('id', editingCat.id)
    setEditingCat(null); fetchAll()
  }

  // ── Question CRUD ─────────────────────────────────────────────────────────
  const addQuestion = async () => {
    if (!newQText.trim() || !newQCatId) return
    const catQs = questions.filter(q => q.category_id === newQCatId)
    const maxOrder = catQs.reduce((m, q) => Math.max(m, q.sort_order), 0)
    await supabase.from('perf_questions').insert({
      category_id: newQCatId, text: newQText.trim(), sort_order: maxOrder + 1
    })
    setNewQText(''); fetchAll()
  }
  const toggleQ = async (q) => {
    await supabase.from('perf_questions').update({ active: !q.active }).eq('id', q.id)
    fetchAll()
  }
  const saveEditQ = async () => {
    if (!editingQ) return
    await supabase.from('perf_questions').update({ text: editingQ.text }).eq('id', editingQ.id)
    setEditingQ(null); fetchAll()
  }

  // ── Trigger eval cycle ────────────────────────────────────────────────────
  const handleTrigger = async () => {
    if (!triggerStart || !triggerEnd) { showMsg('Select a date range', 'error'); return }
    if (triggerMode === 'employee' && !triggerEmpId) { showMsg('Select an employee', 'error'); return }
    if (triggerMode === 'team' && !triggerTeamId) { showMsg('Select a team', 'error'); return }
    if (!triggerForemanId) { showMsg('Select a foreman to conduct the evaluation', 'error'); return }
    setTriggerLoading(true)

    let empIds = []
    if (triggerMode === 'employee') {
      empIds = [triggerEmpId]
    } else {
      empIds = teamMembers
        .filter(m => m.team_id === triggerTeamId && m.employee_id !== triggerForemanId)
        .map(m => m.employee_id)
    }

    const dueDate = triggerDueDate || defaultDueDate()
    const dueDateFormatted = new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' })

    const rows = empIds.map(eid => ({
      employee_id: eid,
      foreman_id: triggerForemanId,
      start_date: triggerStart,
      end_date: triggerEnd,
      due_date: dueDate,
      triggered_by: currentUser.id,
      status: 'pending',
    }))

    const { error } = await supabase.from('perf_cycles').insert(rows)
    if (error) { showMsg('Error triggering evaluation: ' + error.message, 'error') }
    else {
      showMsg(`Evaluation triggered for ${empIds.length} employee${empIds.length !== 1 ? 's' : ''}`)
      // Send confirmation email to reviewer (foreman)
      try {
        const foreman = employees.find(e => e.id === triggerForemanId)
        const revieweeNames = empIds.map(eid => {
          const emp = employees.find(e => e.id === eid)
          return emp ? `${emp.first_name} ${emp.last_name}` : ''
        }).filter(Boolean)
        if (foreman?.email) {
          const appUrl = window.location.origin
          for (const name of revieweeNames) {
            await supabase.functions.invoke('send-notification', {
              body: {
                to: foreman.email,
                subject: `Performance Review Request — ${name}`,
                channel: 'email',
                html: `<!DOCTYPE html><html><body style="background:#112e1c;color:#fff;font-family:Georgia,serif;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#0d2118;border:1px solid rgba(240,192,64,0.3);border-radius:12px;overflow:hidden">
<div style="padding:28px;text-align:center;border-bottom:2px solid #F0C040">
  <div style="font-size:2rem">📋</div>
  <h1 style="color:#F0C040;font-size:1.3rem;margin:8px 0 0">Performance Review Request</h1>
</div>
<div style="padding:24px">
  <p style="margin:0 0 16px">Hi ${foreman.first_name},</p>
  <p style="margin:0 0 16px">You have been asked to complete a performance review for <strong style="color:#F0C040">${name}</strong>.</p>
  <p style="margin:0 0 24px">This review needs to be completed by <strong style="color:#F0C040">${dueDateFormatted}</strong>.</p>
  <div style="text-align:center;margin-bottom:24px">
    <a href="${appUrl}/performance" style="display:inline-block;background:#F0C040;color:#112e1c;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">
      Go to My Reviews →
    </a>
  </div>
  <p style="color:rgba(255,255,255,0.4);font-size:0.8rem;margin:0">If the button doesn't work, visit: ${appUrl}/performance</p>
</div>
<div style="padding:14px 20px;text-align:center;color:rgba(255,255,255,0.35);font-size:0.75rem;border-top:1px solid rgba(240,192,64,0.15)">DDE SPARKS Portal · D. DuBaldo Electric</div>
</div></body></html>`
              }
            })
          }
        }
      } catch(emailErr) {
        console.warn('Confirmation email failed:', emailErr)
        // Don't fail the whole trigger if email fails
      }
    }
    setTriggerLoading(false)
    fetchAll()
  }

  // ── Grade responsibilities ─────────────────────────────────────────────────
  const saveGradeResp = async () => {
    if (!editGradeResp) return
    setGradeRespSaving(true)
    await supabase.from('perf_grade_responsibilities').upsert({
      job_grade: editGradeResp.job_grade,
      responsibilities: gradeRespText,
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id,
    }, { onConflict: 'job_grade' })
    setGradeResponsibilities(prev => {
      const idx = prev.findIndex(r => r.job_grade === editGradeResp.job_grade)
      const updated = { ...editGradeResp, responsibilities: gradeRespText }
      return idx >= 0 ? prev.map((r, i) => i === idx ? updated : r) : [...prev, updated]
    })
    setEditGradeResp(null); setGradeRespText(''); setGradeRespSaving(false)
    showMsg('Grade responsibilities saved')
  }

  // ── Grade compensation ─────────────────────────────────────────────────────
  const saveGradeComp = async () => {
    if (!editGradeComp) return
    setGradeCompSaving(true)
    const payload = {
      job_grade: editGradeComp.job_grade,
      wage_type: gradeCompValues.wage_type || 'hourly',
      wage_min: parseFloat(gradeCompValues.wage_min) || 0,
      wage_max: parseFloat(gradeCompValues.wage_max) || 0,
      target_bonus_pct: parseFloat(gradeCompValues.target_bonus_pct) || 0,
      bonus_share_pct: parseFloat(gradeCompValues.bonus_share_pct) || 0,
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id,
    }
    await supabase.from('perf_grade_compensation').upsert(payload, { onConflict: 'job_grade' })
    setGradeCompensation(prev => {
      const idx = prev.findIndex(r => r.job_grade === editGradeComp.job_grade)
      return idx >= 0 ? prev.map((r, i) => i === idx ? payload : r) : [...prev, payload]
    })
    setEditGradeComp(null)
    setGradeCompValues({ wage_type:'hourly', wage_min:'', wage_max:'', target_bonus_pct:'', bonus_share_pct:'' })
    setGradeCompSaving(false)
    showMsg('Grade compensation saved')
  }

  // ── Profile (employee-specific responsibilities) ───────────────────────────
  const saveProfile = async () => {
    if (!editProfile) return
    setProfileSaving(true)
    await supabase.from('perf_employee_profiles').upsert({
      employee_id: editProfile.employee_id,
      responsibilities: profileText,
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id,
    }, { onConflict: 'employee_id' })
    setProfiles(prev => {
      const idx = prev.findIndex(p => p.employee_id === editProfile.employee_id)
      const updated = { ...editProfile, responsibilities: profileText }
      return idx >= 0 ? prev.map((p,i) => i===idx ? updated : p) : [...prev, updated]
    })
    setEditProfile(null); setProfileText(''); setProfileSaving(false)
    showMsg('Profile saved')
  }

  // ── Override workday ──────────────────────────────────────────────────────
  const saveWorkdayOverride = async (cycleId, val) => {
    const n = parseInt(val)
    if (isNaN(n) || n < 1) return
    await supabase.from('perf_cycles').update({ work_days_override: n }).eq('id', cycleId)
    setCycles(prev => prev.map(c => c.id === cycleId ? { ...c, work_days_override: n } : c))
    showMsg('Work day override saved')
  }

  // ── Compute weighted scores per employee ──────────────────────────────────
  const empScoreSummaries = useMemo(() => {
    const submitted = cycles.filter(c => c.status === 'submitted')
    const empMap = {}
    submitted.forEach(cycle => {
      const eid = cycle.employee_id
      if (!empMap[eid]) empMap[eid] = { employee: cycle.employee, cycles: [] }
      const cycleAnswers = answers.filter(a => a.cycle_id === cycle.id && a.score)
      const avgScore = cycleAnswers.length > 0
        ? cycleAnswers.reduce((s, a) => s + a.score, 0) / cycleAnswers.length
        : null
      const workdays = cycle.work_days_override || countWorkdays(cycle.start_date, cycle.end_date)
      empMap[eid].cycles.push({ ...cycle, avgScore, workdays })
    })
    // Compute weighted score
    const summaries = Object.values(empMap).map(({ employee, cycles }) => {
      const totalWorkdays = cycles.reduce((s, c) => s + c.workdays, 0)
      const weightedScore = totalWorkdays > 0
        ? cycles.reduce((s, c) => s + (c.avgScore || 0) * (c.workdays / totalWorkdays), 0)
        : null
      const scoreSeries = cycles.map(c => c.avgScore).filter(Boolean)
      return { employee, cycles, totalWorkdays, weightedScore, scoreSeries }
    })
    return summaries.sort((a,b) => {
      const na = `${a.employee?.last_name} ${a.employee?.first_name}`
      const nb = `${b.employee?.last_name} ${b.employee?.first_name}`
      return na.localeCompare(nb)
    })
  }, [cycles, answers])

  // ── Category breakdown for selected employee ──────────────────────────────
  const selectedEmpSummary = useMemo(() => {
    if (!filterEmpId) return null
    return empScoreSummaries.find(s => s.employee?.id === filterEmpId) || null
  }, [filterEmpId, empScoreSummaries])

  const categoryBreakdown = useMemo(() => {
    if (!filterEmpId) return []
    const empCycles = cycles.filter(c => c.employee_id === filterEmpId && c.status === 'submitted')
    return categories.map(cat => {
      const catQIds = questions.filter(q => q.category_id === cat.id).map(q => q.id)
      const catAnswers = answers.filter(a =>
        empCycles.some(c => c.id === a.cycle_id) && catQIds.includes(a.question_id) && a.score
      )
      const avg = catAnswers.length > 0
        ? catAnswers.reduce((s, a) => s + a.score, 0) / catAnswers.length
        : null
      return { cat, avg, count: catAnswers.length }
    })
  }, [filterEmpId, cycles, answers, categories, questions])

  // ── Peer comparison for selected employee ─────────────────────────────────
  const peerComparison = useMemo(() => {
    if (!filterEmpId) return null
    const target = empScoreSummaries.find(s => s.employee?.id === filterEmpId)
    if (!target || !target.employee) return null
    const grade = target.employee.job_grade
    const peerGroup = getPeerGroupLabel(grade)
    const peersInGroup = PEER_GROUPS[peerGroup] || []
    const peers = empScoreSummaries.filter(s =>
      s.employee && peersInGroup.includes(s.employee.job_grade) && s.weightedScore !== null
    )
    if (peers.length === 0) return null
    const allScores = peers.map(p => p.weightedScore).filter(Boolean).sort((a,b) => a-b)
    const rank = allScores.filter(s => s < (target.weightedScore || 0)).length + 1
    const groupAvg = allScores.reduce((s,x) => s+x, 0) / allScores.length
    const peerData = peers
      .filter(p => p.weightedScore !== null)
      .sort((a,b) => (b.weightedScore||0) - (a.weightedScore||0))
    return { peerGroup, rank, total: peers.length, groupAvg, peerData }
  }, [filterEmpId, empScoreSummaries])

  // ── Generate report HTML ──────────────────────────────────────────────────
  const generateReport = () => {
    const now = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})

    // Per-employee category breakdown helper
    const getCatBreakdown = (empId) => {
      const empCycles = cycles.filter(c => c.employee_id === empId && c.status === 'submitted')
      return categories.map(cat => {
        const catQIds = questions.filter(q => q.category_id === cat.id).map(q => q.id)
        const catAnswers = answers.filter(a =>
          empCycles.some(c => c.id === a.cycle_id) && catQIds.includes(a.question_id) && a.score
        )
        const avg = catAnswers.length > 0
          ? catAnswers.reduce((s, a) => s + a.score, 0) / catAnswers.length
          : null
        return { name: cat.name, avg }
      })
    }

    const scoreColor = (s) => s >= 4 ? '#1d9e75' : s >= 3 ? '#ba7517' : '#e24b4a'

    const summaryRows = empScoreSummaries.map(({ employee, cycles: empCycles, weightedScore, totalWorkdays }) => {
      const grade = employee?.job_grade || ''
      const peerGroup = getPeerGroupLabel(grade)
      const ss = sparkStats[employee?.id]
      const cycleDetail = empCycles.map(c =>
        `${c.foreman?.first_name||''} ${c.foreman?.last_name||''}: ${c.avgScore?.toFixed(1)||'—'} (${c.workdays} days)`
      ).join('<br/>')
      const catBreakdown = getCatBreakdown(employee?.id)
      const catCells = catBreakdown.map(({ name, avg }) =>
        `<td style="font-size:10px;text-align:center;color:${avg ? scoreColor(avg) : '#999'};font-weight:${avg ? 600 : 400}">
          ${avg ? avg.toFixed(1) : '—'}
        </td>`
      ).join('')
      const sparksGiven = ss ? `${ss.given}${ss.allotted > 0 ? ` / ${ss.allotted}` : ''}` : '—'
      const sparksReceived = ss ? ss.received : '—'
      const topReasons = ss
        ? Object.entries(ss.receivedByReason).sort((a,b)=>b[1]-a[1]).slice(0,3)
            .map(([r,n]) => `${r}: ${n}`).join('<br/>') || '—'
        : '—'
      return `
        <tr>
          <td>${employee?.last_name}, ${employee?.first_name}</td>
          <td>${grade}</td>
          <td>${peerGroup}</td>
          <td style="font-weight:600;color:${weightedScore ? scoreColor(weightedScore) : '#999'}">
            ${weightedScore?.toFixed(2)||'—'}/5
          </td>
          ${catCells}
          <td style="font-size:10px;">${sparksGiven}</td>
          <td style="font-size:10px;">${sparksReceived}</td>
          <td style="font-size:9px;color:#666">${topReasons}</td>
          <td style="font-size:9px;color:#666">${cycleDetail}</td>
        </tr>`
    }).join('')

    const catHeaderCells = categories.map(c =>
      `<th style="background:#26643F;color:#fff;padding:4px 5px;font-size:9px;text-align:center">${c.name}</th>`
    ).join('')

    const peerGroupBlocks = Object.entries(PEER_GROUPS).map(([group, grades]) => {
      const groupEmps = empScoreSummaries.filter(s =>
        s.employee && grades.includes(s.employee.job_grade) && s.weightedScore !== null
      ).sort((a,b) => (b.weightedScore||0)-(a.weightedScore||0))
      if (groupEmps.length === 0) return ''
      const rows = groupEmps.map(({ employee, weightedScore }, i) => {
        const catBreakdown = getCatBreakdown(employee?.id)
        const catCells = catBreakdown.map(({ name, avg }) =>
          `<td style="text-align:center;color:${avg ? scoreColor(avg) : '#999'};font-weight:${avg ? 600 : 400}">${avg ? avg.toFixed(1) : '—'}</td>`
        ).join('')
        const ss = sparkStats[employee?.id]
        return `
          <tr>
            <td>#${i+1}</td>
            <td>${employee?.last_name}, ${employee?.first_name}</td>
            <td>${employee?.job_grade}</td>
            <td style="font-weight:600;color:${scoreColor(weightedScore)}">${weightedScore?.toFixed(2)||'—'}/5</td>
            ${catCells}
            <td>${ss ? ss.given : '—'}</td>
            <td>${ss ? ss.received : '—'}</td>
          </tr>`
      }).join('')
      const catThs = categories.map(c =>
        `<th style="background:#3a7a50;color:#fff;padding:4px 5px;font-size:9px;text-align:center">${c.name}</th>`
      ).join('')
      return `
        <h3 style="color:#26643F;margin-top:20px">${group} Group</h3>
        <table>
          <thead><tr>
            <th>Rank</th><th>Employee</th><th>Grade</th><th>Score</th>
            ${catThs}
            <th>Given</th><th>Received</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Performance Report — ${now}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#222;padding:20px;font-size:11px}
        h1{color:#26643F;font-size:18px}h2{color:#26643F;font-size:14px;margin-top:24px}
        h3{color:#26643F;font-size:12px;margin-top:16px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th{background:#26643F;color:#fff;padding:5px 7px;text-align:left;font-size:10px}
        td{padding:4px 7px;border-bottom:1px solid #eee;font-size:10px;vertical-align:top}
        .subtitle{color:#666;font-size:10px;margin-bottom:16px}
        @media print{body{padding:0}}
      </style></head><body>
      <h1>DDE Performance Evaluation Report</h1>
      <p class="subtitle">Generated ${now} &nbsp;|&nbsp; ${empScoreSummaries.length} employees evaluated</p>

      <h2>Employee Summaries</h2>
      <table>
        <thead><tr>
          <th>Employee</th><th>Grade</th><th>Peer Group</th><th>Overall Score</th>
          ${catHeaderCells}
          <th>Sparks Given</th><th>Sparks Rcvd</th><th>Top Sparks Reasons</th><th>Cycle Detail</th>
        </tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>

      <h2>Peer Group Rankings (Sparks Report)</h2>
      <p class="subtitle">Employees ranked within their grade group. Scores are work-day-weighted averages across all submitted evaluation cycles.</p>
      ${peerGroupBlocks}
      </body></html>`

    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.print()
  }

  // ── Foreman options (management grade) ───────────────────────────────────
  const foremanOptions = employees.filter(e => {
    const g = (e.job_grade||'').toUpperCase()
    const t = (e.job_title||'').toLowerCase()
    return /^[FP]/.test(g) || g === 'OWNER' || t.includes('foreman') || t.includes('project manager')
  })

  // ── Team members for trigger ──────────────────────────────────────────────
  const triggerTeamEmps = useMemo(() => {
    if (!triggerTeamId) return []
    return teamMembers
      .filter(m => m.team_id === triggerTeamId)
      .map(m => m.employees)
      .filter(Boolean)
      .filter((e,i,arr) => arr.findIndex(x => x.id === e.id) === i)
  }, [triggerTeamId, teamMembers])

  const SUBTABS = [
    ['questions','📝 Questions'],
    ['trigger','⚡ Trigger Eval'],
    ['results','📊 Results'],
    ['profiles','👤 Profiles'],
    ['report','📄 Report'],
  ]

  return (
    <div>
      <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'20px' }}>
        {SUBTABS.map(([t,label]) => (
          <button key={t} className={`tab-btn${subTab===t?' active':''}`} onClick={() => setSubTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign:'center', padding:'40px' }}><div className="spark-loader" style={{ margin:'0 auto' }}></div></div>}

      {/* ── QUESTIONS TAB ── */}
      {!loading && subTab==='questions' && (
        <div style={{ display:'grid', gap:'20px' }}>
          {/* Add category */}
          <div className="card">
            <div className="card-title">Add Category</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
              <div>
                <label className="form-label">Category Name</label>
                <input className="form-input" value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="e.g. Safety Compliance"/>
              </div>
              <div>
                <label className="form-label">Description (shown to foreman)</label>
                <input className="form-input" value={newCatDesc} onChange={e=>setNewCatDesc(e.target.value)} placeholder="Brief description…"/>
              </div>
            </div>
            <button className="btn btn-gold btn-sm" onClick={addCategory}>+ Add Category</button>
          </div>

          {/* Add question */}
          <div className="card">
            <div className="card-title">Add Question</div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'12px', marginBottom:'12px' }}>
              <div>
                <label className="form-label">Question Text</label>
                <input className="form-input" value={newQText} onChange={e=>setNewQText(e.target.value)} placeholder="Enter question…"/>
              </div>
              <div>
                <label className="form-label">Category</label>
                <select className="form-select" value={newQCatId} onChange={e=>setNewQCatId(e.target.value)}>
                  <option value="">— Select —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-gold btn-sm" onClick={addQuestion}>+ Add Question</button>
          </div>

          {/* Category + question list */}
          {categories.map(cat => {
            const catQs = questions.filter(q => q.category_id === cat.id)
            return (
              <div key={cat.id} className="card" style={{ opacity: cat.active ? 1 : 0.5 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                  {editingCat?.id === cat.id ? (
                    <div style={{ display:'flex', gap:'8px', flex:1, marginRight:'12px' }}>
                      <input className="form-input" value={editingCat.name} onChange={e=>setEditingCat(p=>({...p,name:e.target.value}))} style={{ flex:1 }}/>
                      <input className="form-input" value={editingCat.description||''} onChange={e=>setEditingCat(p=>({...p,description:e.target.value}))} style={{ flex:1 }} placeholder="Description"/>
                      <button className="btn btn-gold btn-sm" onClick={saveEditCat}>Save</button>
                      <button className="btn btn-outline btn-sm" onClick={()=>setEditingCat(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div>
                      <span style={{ fontFamily:'var(--font-display)', color:'var(--gold)', fontSize:'0.9rem', letterSpacing:'0.05em' }}>
                        {cat.name}
                      </span>
                      {cat.description && <span style={{ color:'var(--white-dim)', fontSize:'0.78rem', marginLeft:'10px' }}>{cat.description}</span>}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:'6px' }}>
                    <button className="btn btn-outline btn-xs" onClick={()=>setEditingCat({...cat})}>Edit</button>
                    <button className="btn btn-outline btn-xs" onClick={()=>toggleCat(cat)}>
                      {cat.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                  {catQs.map((q, i) => (
                    <div key={q.id} style={{
                      display:'flex', alignItems:'center', gap:'10px',
                      padding:'10px 12px', borderRadius:'8px',
                      background:'rgba(0,0,0,0.2)', border:'1px solid rgba(255,255,255,0.06)',
                      opacity: q.active ? 1 : 0.5
                    }}>
                      {editingQ?.id === q.id ? (
                        <div style={{ display:'flex', gap:'8px', flex:1 }}>
                          <input className="form-input" value={editingQ.text} onChange={e=>setEditingQ(p=>({...p,text:e.target.value}))} style={{ flex:1 }}/>
                          <button className="btn btn-gold btn-xs" onClick={saveEditQ}>Save</button>
                          <button className="btn btn-outline btn-xs" onClick={()=>setEditingQ(null)}>×</button>
                        </div>
                      ) : (
                        <>
                          <span style={{ color:'var(--white-dim)', fontSize:'0.75rem', minWidth:'24px' }}>Q{i+1}</span>
                          <span style={{ flex:1, fontSize:'0.85rem', color:'var(--white-soft)' }}>{q.text}</span>
                          <div style={{ display:'flex', gap:'4px' }}>
                            <button className="btn btn-outline btn-xs" onClick={()=>setEditingQ({...q})}>Edit</button>
                            <button className="btn btn-outline btn-xs" onClick={()=>toggleQ(q)}>
                              {q.active ? 'Off' : 'On'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {catQs.length === 0 && <p style={{ color:'var(--white-dim)', fontSize:'0.8rem', padding:'8px 0' }}>No questions yet.</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── TRIGGER TAB ── */}
      {!loading && subTab==='trigger' && (
        <div style={{ display:'grid', gap:'16px', maxWidth:'600px' }}>
          <div className="card">
            <div className="card-title">⚡ Trigger Evaluation Cycle</div>

            <div style={{ marginBottom:'14px' }}>
              <label className="form-label">Trigger Mode</label>
              <div style={{ display:'flex', gap:'10px' }}>
                {[['employee','Single Employee'],['team','Entire Team']].map(([v,l]) => (
                  <button key={v} className={`btn ${triggerMode===v?'btn-gold':'btn-outline'} btn-sm`}
                    onClick={()=>setTriggerMode(v)}>{l}</button>
                ))}
              </div>
            </div>

            {triggerMode==='employee' && (
              <div style={{ marginBottom:'12px' }}>
                <label className="form-label">Employee</label>
                <select className="form-select" value={triggerEmpId} onChange={e=>setTriggerEmpId(e.target.value)}>
                  <option value="">— Select Employee —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.last_name}, {e.first_name} {e.job_grade ? `(${e.job_grade})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {triggerMode==='team' && (
              <div style={{ marginBottom:'12px' }}>
                <label className="form-label">Team</label>
                <select className="form-select" value={triggerTeamId} onChange={e=>setTriggerTeamId(e.target.value)}>
                  <option value="">— Select Team —</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {triggerTeamId && triggerTeamEmps.length > 0 && (
                  <div style={{ marginTop:'8px', padding:'10px', borderRadius:'8px', background:'rgba(0,0,0,0.2)', fontSize:'0.8rem', color:'var(--white-dim)' }}>
                    Will trigger evals for: {triggerTeamEmps.map(e=>`${e.first_name} ${e.last_name}`).join(', ')}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom:'12px' }}>
              <label className="form-label">Foreman Conducting Evaluation</label>
              <select className="form-select" value={triggerForemanId} onChange={e=>setTriggerForemanId(e.target.value)}>
                <option value="">— Select Foreman —</option>
                {foremanOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.last_name}, {e.first_name} ({e.job_grade})</option>
                ))}
              </select>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'16px' }}>
              <div>
                <label className="form-label">Start Date</label>
                <input type="date" className="form-input" value={triggerStart} onChange={e=>setTriggerStart(e.target.value)}/>
              </div>
              <div>
                <label className="form-label">End Date</label>
                <input type="date" className="form-input" value={triggerEnd} onChange={e=>setTriggerEnd(e.target.value)}/>
              </div>
              <div style={{ gridColumn:'1 / -1' }}>
                <label className="form-label">Due Date <span style={{ color:'var(--white-dim)', fontWeight:400, fontSize:'0.75rem' }}>(defaults to 7 days from today — editable)</span></label>
                <input type="date" className="form-input"
                  value={triggerDueDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setTriggerDueDate(e.target.value)}
                  style={{ maxWidth:'220px' }}
                />
                <div style={{ fontSize:'0.72rem', color:'var(--white-dim)', marginTop:'4px' }}>
                  A reminder email will be sent to the reviewer 2 days before this date (if not yet completed), then every 24 hours until submitted.
                </div>
              </div>
            </div>

            {triggerStart && triggerEnd && (
              <p style={{ fontSize:'0.8rem', color:'var(--white-dim)', marginBottom:'14px' }}>
                Work days in range: <strong style={{ color:'var(--gold)' }}>{countWorkdays(triggerStart, triggerEnd)}</strong>
              </p>
            )}

            <button className="btn btn-gold" disabled={triggerLoading} onClick={handleTrigger}>
              {triggerLoading ? 'Triggering…' : '⚡ Trigger Evaluation'}
            </button>
          </div>

          {/* Recent triggers */}
          <div className="card">
            <div className="card-title">Recent Cycles</div>
            {cycles.length === 0 && <p style={{ color:'var(--white-dim)', fontSize:'0.85rem' }}>No cycles yet.</p>}
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {cycles.slice(0,10).map(c => (
                <div key={c.id} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'10px 12px', borderRadius:'8px',
                  background:'rgba(0,0,0,0.2)', border:'1px solid rgba(255,255,255,0.06)'
                }}>
                  <div>
                    <span style={{ fontSize:'0.85rem', color:'var(--white-soft)' }}>
                      {c.employee?.first_name} {c.employee?.last_name}
                    </span>
                    <span style={{ fontSize:'0.75rem', color:'var(--white-dim)', marginLeft:'8px' }}>
                      {c.employee?.job_grade}
                    </span>
                    <div style={{ fontSize:'0.75rem', color:'var(--white-dim)', marginTop:'2px' }}>
                      {c.start_date} → {c.end_date} &nbsp;|&nbsp; Foreman: {c.foreman?.first_name} {c.foreman?.last_name}
                      {c.due_date && <span style={{ marginLeft:'6px', color: new Date(c.due_date) < new Date() && c.status !== 'submitted' ? 'var(--red)' : 'var(--gold)' }}>Due: {new Date(c.due_date + 'T00:00:00').toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})}</span>}
                    </div>
                  </div>
                  <span style={{
                    fontSize:'0.72rem', padding:'3px 10px', borderRadius:'20px',
                    background: c.status==='submitted' ? 'rgba(94,232,138,0.15)' : c.status==='in_progress' ? 'rgba(240,192,64,0.15)' : 'rgba(255,255,255,0.08)',
                    color: c.status==='submitted' ? 'var(--green-bright)' : c.status==='in_progress' ? 'var(--gold)' : 'var(--white-dim)',
                    border: `1px solid ${c.status==='submitted' ? 'rgba(94,232,138,0.3)' : c.status==='in_progress' ? 'rgba(240,192,64,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── RESULTS TAB ── */}
      {!loading && subTab==='results' && (
        <div>
          <div style={{ marginBottom:'16px', display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
            <select className="form-select" style={{ maxWidth:'280px' }} value={filterEmpId} onChange={e=>setFilterEmpId(e.target.value)}>
              <option value="">— All Employees —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name} ({e.job_grade})</option>)}
            </select>
            {filterEmpId && <button className="btn btn-outline btn-sm" onClick={()=>setFilterEmpId('')}>Clear</button>}
          </div>

          {!filterEmpId && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Grade</th>
                    <th>Peer Group</th>
                    <th>Weighted Score</th>
                    <th>Sparks Given</th>
                    <th>Sparks Received</th>
                    <th>Cycles</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {empScoreSummaries.map(({ employee, cycles, weightedScore, scoreSeries }) => {
                    const ss = sparkStats[employee?.id]
                    return (
                    <tr key={employee?.id} style={{ cursor:'pointer' }}
                      onClick={() => setFilterEmpId(employee?.id)}>
                      <td style={{ color:'var(--white-soft)' }}>{employee?.last_name}, {employee?.first_name}</td>
                      <td><span style={{ color:'var(--gold)', fontSize:'0.82rem' }}>{employee?.job_grade}</span></td>
                      <td style={{ fontSize:'0.8rem', color:'var(--white-dim)' }}>{getPeerGroupLabel(employee?.job_grade)}</td>
                      <td><ScoreBadge score={weightedScore}/></td>
                      <td style={{ fontSize:'0.82rem', color:'var(--gold)' }}>{ss ? `${ss.given}${ss.allotted > 0 ? ` / ${ss.allotted}` : ''}` : '—'}</td>
                      <td style={{ fontSize:'0.82rem', color:'var(--green-bright)' }}>{ss ? ss.received : '—'}</td>
                      <td style={{ fontSize:'0.8rem', color:'var(--white-dim)' }}>{cycles.filter(c=>c.status==='submitted').length} submitted</td>
                      <td><Sparkline scores={scoreSeries}/></td>
                    </tr>
                    )
                  })}
                  {empScoreSummaries.length === 0 && (
                    <tr><td colSpan={6} style={{ color:'var(--white-dim)', textAlign:'center', padding:'24px' }}>No submitted evaluations yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Drill-down for selected employee */}
          {filterEmpId && selectedEmpSummary && (
            <div style={{ display:'grid', gap:'16px' }}>
              {/* Header */}
              <div className="card" style={{ borderColor:'rgba(240,192,64,0.4)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'12px' }}>
                  <div>
                    <h2 style={{ fontFamily:'var(--font-display)', color:'var(--gold)', fontSize:'1.1rem', letterSpacing:'0.06em', marginBottom:'4px' }}>
                      {selectedEmpSummary.employee?.first_name} {selectedEmpSummary.employee?.last_name}
                    </h2>
                    <span style={{ color:'var(--white-dim)', fontSize:'0.85rem' }}>
                      {selectedEmpSummary.employee?.job_grade} · {getPeerGroupLabel(selectedEmpSummary.employee?.job_grade)}
                    </span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:'0.78rem', color:'var(--white-dim)', marginBottom:'4px' }}>Weighted Overall Score</div>
                    <ScoreBadge score={selectedEmpSummary.weightedScore}/>
                  </div>
                </div>
              </div>

              {/* ── Sparks usage ── */}
              {(() => {
                const ss = sparkStats[filterEmpId]
                if (!ss) return null
                const sortedReasons = Object.entries(ss.receivedByReason)
                  .sort((a, b) => b[1] - a[1])
                const topReceived = sortedReasons.slice(0, 5)
                return (
                  <div className="card">
                    <div className="card-title">⚡ Sparks Activity</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'10px', marginBottom:'20px' }}>
                      {[
                        { label:'Sparks Given', value: ss.given, sub: ss.allotted > 0 ? `of ${ss.allotted}/period allotted` : null, color:'var(--gold)' },
                        { label:'Sparks Received', value: ss.received, sub:'all time', color:'var(--green-bright)' },
                      ].map(({ label, value, sub, color }) => (
                        <div key={label} style={{
                          padding:'14px', borderRadius:'8px',
                          background:'rgba(0,0,0,0.25)', border:'1px solid rgba(255,255,255,0.08)',
                          textAlign:'center'
                        }}>
                          <div style={{ fontSize:'1.6rem', fontWeight:700, color, fontFamily:'var(--font-display)', letterSpacing:'0.04em' }}>
                            {value}
                          </div>
                          <div style={{ fontSize:'0.78rem', color:'var(--white-soft)', marginTop:'4px' }}>{label}</div>
                          {sub && <div style={{ fontSize:'0.7rem', color:'var(--white-dim)', marginTop:'2px' }}>{sub}</div>}
                        </div>
                      ))}
                    </div>

                    {topReceived.length > 0 && (
                      <div>
                        <div style={{ fontSize:'0.78rem', color:'var(--white-dim)', letterSpacing:'0.05em', marginBottom:'10px' }}>
                          SPARKS RECEIVED BY REASON
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                          {topReceived.map(([reason, count]) => {
                            const pct = ss.received > 0 ? (count / ss.received) * 100 : 0
                            return (
                              <div key={reason} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                                <span style={{ flex:'0 0 180px', fontSize:'0.82rem', color:'var(--white-soft)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                  {reason}
                                </span>
                                <div style={{ flex:1, height:'7px', background:'rgba(255,255,255,0.08)', borderRadius:'4px', overflow:'hidden' }}>
                                  <div style={{ width:`${pct}%`, height:'100%', background:'var(--gold)', borderRadius:'4px', transition:'width 0.5s ease' }}/>
                                </div>
                                <span style={{ fontSize:'0.8rem', color:'var(--gold)', minWidth:'32px', textAlign:'right' }}>
                                  {count}
                                </span>
                              </div>
                            )
                          })}
                          {sortedReasons.length > 5 && (
                            <div style={{ fontSize:'0.75rem', color:'var(--white-dim)', paddingTop:'4px' }}>
                              +{sortedReasons.length - 5} more categories
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── Category breakdown ── */}
              <div className="card">
                <div className="card-title">Score by Category</div>
                <div style={{ display:'grid', gap:'12px' }}>
                  {categoryBreakdown.map(({ cat, avg }) => (
                    <div key={cat.id} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                      <span style={{ flex:'0 0 160px', fontSize:'0.85rem', color:'var(--white-soft)' }}>{cat.name}</span>
                      <div style={{ flex:1, height:'8px', background:'rgba(255,255,255,0.1)', borderRadius:'4px', overflow:'hidden' }}>
                        <div style={{
                          width:`${avg ? (avg/5)*100 : 0}%`, height:'100%', borderRadius:'4px',
                          background: avg >= 4 ? 'var(--green-bright)' : avg >= 3 ? 'var(--gold)' : 'var(--red)',
                          transition:'width 0.6s ease'
                        }}/>
                      </div>
                      <ScoreBadge score={avg}/>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cycle detail with workday overrides */}
              <div className="card">
                <div className="card-title">Evaluation Cycles</div>
                {selectedEmpSummary.cycles.map(c => {
                  const wd = c.work_days_override || countWorkdays(c.start_date, c.end_date)
                  const totalWd = selectedEmpSummary.cycles.reduce((s, cx) =>
                    s + (cx.work_days_override || countWorkdays(cx.start_date, cx.end_date)), 0)
                  const pct = totalWd > 0 ? ((wd/totalWd)*100).toFixed(1) : 0
                  return (
                    <div key={c.id} style={{
                      marginBottom:'12px', padding:'12px', borderRadius:'8px',
                      background:'rgba(0,0,0,0.2)', border:'1px solid rgba(255,255,255,0.06)'
                    }}>
                      <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
                        <div>
                          <span style={{ color:'var(--white-soft)', fontSize:'0.88rem' }}>
                            {c.foreman?.first_name} {c.foreman?.last_name}
                          </span>
                          <span style={{ color:'var(--white-dim)', fontSize:'0.78rem', marginLeft:'8px' }}>
                            {c.start_date} → {c.end_date}
                          </span>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                          <ScoreBadge score={c.avgScore}/>
                          <span style={{ fontSize:'0.75rem', color:'var(--gold)' }}>{pct}% weight</span>
                        </div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'10px' }}>
                        <span style={{ fontSize:'0.75rem', color:'var(--white-dim)' }}>Work days:</span>
                        <input
                          type="number" min="1"
                          className="form-input"
                          style={{ width:'80px', padding:'4px 8px', fontSize:'0.8rem' }}
                          value={workdayOverride[c.id] !== undefined ? workdayOverride[c.id] : (c.work_days_override || wd)}
                          onChange={e => setWorkdayOverride(p => ({...p, [c.id]: e.target.value}))}
                        />
                        <button className="btn btn-outline btn-xs"
                          onClick={() => saveWorkdayOverride(c.id, workdayOverride[c.id] !== undefined ? workdayOverride[c.id] : wd)}>
                          Override
                        </button>
                        {!c.work_days_override && (
                          <span style={{ fontSize:'0.72rem', color:'var(--white-dim)' }}>auto (Mon–Fri)</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Peer comparison sparkline */}
              {peerComparison && (
                <div className="card">
                  <div className="card-title">⚡ Peer Comparison — {peerComparison.peerGroup} Group</div>
                  <p style={{ fontSize:'0.85rem', color:'var(--white-dim)', marginBottom:'16px' }}>
                    Ranked <strong style={{ color:'var(--gold)' }}>#{peerComparison.rank}</strong> of {peerComparison.total} in peer group &nbsp;·&nbsp;
                    Group avg: <strong style={{ color:'var(--gold)' }}>{peerComparison.groupAvg.toFixed(2)}/5</strong>
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Rank</th><th>Employee</th><th>Grade</th><th>Score</th><th>vs Group Avg</th></tr></thead>
                      <tbody>
                        {peerComparison.peerData.map(({ employee, weightedScore }, i) => {
                          const isTarget = employee?.id === filterEmpId
                          const delta = weightedScore - peerComparison.groupAvg
                          return (
                            <tr key={employee?.id} style={{ background: isTarget ? 'rgba(240,192,64,0.08)' : 'transparent' }}>
                              <td style={{ color: i===0 ? 'var(--gold)' : 'var(--white-dim)' }}>#{i+1}</td>
                              <td style={{ color: isTarget ? 'var(--gold)' : 'var(--white-soft)', fontWeight: isTarget ? 600 : 400 }}>
                                {employee?.last_name}, {employee?.first_name}
                                {isTarget && ' ← you'}
                              </td>
                              <td style={{ color:'var(--white-dim)', fontSize:'0.8rem' }}>{employee?.job_grade}</td>
                              <td><ScoreBadge score={weightedScore}/></td>
                              <td style={{ fontSize:'0.82rem', color: delta >= 0 ? 'var(--green-bright)' : 'var(--red)' }}>
                                {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
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

          {filterEmpId && !selectedEmpSummary && (
            <div className="card" style={{ textAlign:'center', padding:'40px' }}>
              <p style={{ color:'var(--white-dim)' }}>No submitted evaluations found for this employee.</p>
            </div>
          )}
        </div>
      )}

      {/* ── PROFILES TAB ── */}
      {!loading && subTab==='profiles' && (
        <div>
          {/* Sub-tab switcher */}
          <div style={{ display:'flex', gap:'6px', marginBottom:'20px' }}>
            {[['grades','📋 By Job Grade'],['employees','👤 By Employee']].map(([t,label]) => (
              <button
                key={t}
                className={`btn ${profilesSubTab===t ? 'btn-gold' : 'btn-outline'} btn-sm`}
                onClick={() => { setProfilesSubTab(t); setEditProfile(null); setEditGradeResp(null); setProfileText(''); setGradeRespText('') }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── BY JOB GRADE ── */}
          {profilesSubTab === 'grades' && (
            <div>
              <p style={{ color:'var(--white-dim)', fontSize:'0.85rem', marginBottom:'16px', lineHeight:1.6 }}>
                Set standard responsibilities and compensation ranges for each job grade.
              </p>

              {/* ── Edit responsibilities form ── */}
              {editGradeResp && (
                <div className="card" style={{ maxWidth:'640px', marginBottom:'16px' }}>
                  <div className="card-title">
                    Edit Responsibilities — Grade <span style={{ color:'var(--gold)' }}>{editGradeResp.job_grade}</span>
                  </div>
                  <p style={{ fontSize:'0.8rem', color:'var(--white-dim)', marginBottom:'12px' }}>
                    These responsibilities apply to <strong style={{ color:'var(--white-soft)' }}>all employees</strong> with grade {editGradeResp.job_grade}. Use one responsibility per line for best readability.
                  </p>
                  <label className="form-label">Responsibilities</label>
                  <textarea
                    className="form-textarea"
                    style={{ height:'220px', width:'100%', fontFamily:'monospace', fontSize:'0.84rem' }}
                    value={gradeRespText}
                    onChange={e => setGradeRespText(e.target.value)}
                    placeholder={'• Follow all safety protocols and PPE requirements\n• Complete assigned work to specification\n• Report to foreman at start and end of shift\n...'}
                  />
                  <div style={{ display:'flex', gap:'10px', marginTop:'12px' }}>
                    <button className="btn btn-gold btn-sm" disabled={gradeRespSaving} onClick={saveGradeResp}>
                      {gradeRespSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => { setEditGradeResp(null); setGradeRespText('') }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* ── Edit compensation form ── */}
              {editGradeComp && (
                <div className="card" style={{ maxWidth:'640px', marginBottom:'16px' }}>
                  <div className="card-title">
                    Edit Compensation — Grade <span style={{ color:'var(--gold)' }}>{editGradeComp.job_grade}</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
                    <div>
                      <label className="form-label">Wage Type</label>
                      <select className="form-select" value={gradeCompValues.wage_type}
                        onChange={e => setGradeCompValues(v => ({ ...v, wage_type: e.target.value }))}>
                        <option value="hourly">Hourly</option>
                        <option value="salary">Salary (Annual)</option>
                      </select>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                      <div>
                        <label className="form-label">
                          {gradeCompValues.wage_type === 'hourly' ? 'Min ($/hr)' : 'Min ($/yr)'}
                        </label>
                        <input type="number" min="0" step="0.01" className="form-input"
                          value={gradeCompValues.wage_min}
                          onChange={e => setGradeCompValues(v => ({ ...v, wage_min: e.target.value }))}
                          placeholder="0.00" />
                      </div>
                      <div>
                        <label className="form-label">
                          {gradeCompValues.wage_type === 'hourly' ? 'Max ($/hr)' : 'Max ($/yr)'}
                        </label>
                        <input type="number" min="0" step="0.01" className="form-input"
                          value={gradeCompValues.wage_max}
                          onChange={e => setGradeCompValues(v => ({ ...v, wage_max: e.target.value }))}
                          placeholder="0.00" />
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Target Bonus %</label>
                      <input type="number" min="0" max="100" step="0.1" className="form-input"
                        value={gradeCompValues.target_bonus_pct}
                        onChange={e => setGradeCompValues(v => ({ ...v, target_bonus_pct: e.target.value }))}
                        placeholder="0" />
                    </div>
                    <div>
                      <label className="form-label">Bonus Share %</label>
                      <input type="number" min="0" max="100" step="0.1" className="form-input"
                        value={gradeCompValues.bonus_share_pct}
                        onChange={e => setGradeCompValues(v => ({ ...v, bonus_share_pct: e.target.value }))}
                        placeholder="0" />
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:'10px', marginTop:'4px' }}>
                    <button className="btn btn-gold btn-sm" disabled={gradeCompSaving} onClick={saveGradeComp}>
                      {gradeCompSaving ? 'Saving…' : 'Save Compensation'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => { setEditGradeComp(null) }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* ── Grade cards (list) ── */}
              {!editGradeResp && !editGradeComp && (
                <div>
                  {(() => {
                    const allGrades = systemGrades.length > 0
                      ? systemGrades
                      : [...new Set(employees.map(e => e.job_grade).filter(Boolean))].sort()
                    if (allGrades.length === 0) return (
                      <div className="card" style={{ textAlign:'center', padding:'32px' }}>
                        <p style={{ color:'var(--white-dim)' }}>No job grades found in the system lists. Add grades under Admin → Lists first.</p>
                      </div>
                    )
                    return (
                      <div style={{ display:'grid', gap:'10px' }}>
                        {allGrades.map(grade => {
                          const gradeResp = gradeResponsibilities.find(r => r.job_grade === grade)
                          const gradeComp = gradeCompensation.find(r => r.job_grade === grade)
                          const empCount = employees.filter(e => e.job_grade === grade).length
                          const hasComp = gradeComp && (gradeComp.wage_min > 0 || gradeComp.wage_max > 0)
                          return (
                            <div key={grade} className="card" style={{
                              gap:'16px', flexWrap:'wrap',
                              borderColor: gradeResp?.responsibilities ? 'rgba(240,192,64,0.25)' : 'rgba(255,255,255,0.08)'
                            }}>
                              {/* Header row */}
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'10px' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                                  <span style={{
                                    fontFamily:'var(--font-display)', fontSize:'0.95rem',
                                    color:'var(--gold)', letterSpacing:'0.06em'
                                  }}>{grade}</span>
                                  <span style={{ fontSize:'0.75rem', color:'var(--white-dim)' }}>
                                    {empCount} employee{empCount !== 1 ? 's' : ''}
                                  </span>
                                  {gradeResp?.responsibilities
                                    ? <span style={{ fontSize:'0.7rem', padding:'2px 8px', borderRadius:'20px', background:'rgba(94,232,138,0.1)', color:'var(--green-bright)', border:'1px solid rgba(94,232,138,0.3)' }}>✓ Resp</span>
                                    : <span style={{ fontSize:'0.7rem', padding:'2px 8px', borderRadius:'20px', background:'rgba(255,255,255,0.05)', color:'var(--white-dim)', border:'1px solid rgba(255,255,255,0.1)' }}>No Resp</span>
                                  }
                                  {hasComp
                                    ? <span style={{ fontSize:'0.7rem', padding:'2px 8px', borderRadius:'20px', background:'rgba(240,192,64,0.1)', color:'var(--gold)', border:'1px solid rgba(240,192,64,0.3)' }}>✓ Comp</span>
                                    : <span style={{ fontSize:'0.7rem', padding:'2px 8px', borderRadius:'20px', background:'rgba(255,255,255,0.05)', color:'var(--white-dim)', border:'1px solid rgba(255,255,255,0.1)' }}>No Comp</span>
                                  }
                                </div>
                                <div style={{ display:'flex', gap:'6px' }}>
                                  <button className="btn btn-outline btn-sm" onClick={() => {
                                    setEditGradeResp({ job_grade: grade })
                                    setGradeRespText(gradeResp?.responsibilities || '')
                                  }}>
                                    {gradeResp?.responsibilities ? '✏️ Resp' : '+ Resp'}
                                  </button>
                                  <button className="btn btn-outline btn-sm" onClick={() => {
                                    setEditGradeComp({ job_grade: grade })
                                    setGradeCompValues({
                                      wage_type: gradeComp?.wage_type || 'hourly',
                                      wage_min: gradeComp?.wage_min ?? '',
                                      wage_max: gradeComp?.wage_max ?? '',
                                      target_bonus_pct: gradeComp?.target_bonus_pct ?? '',
                                      bonus_share_pct: gradeComp?.bonus_share_pct ?? '',
                                    })
                                  }}>
                                    {hasComp ? '✏️ Comp' : '+ Comp'}
                                  </button>
                                </div>
                              </div>

                              {/* Responsibilities preview */}
                              {gradeResp?.responsibilities && (
                                <div style={{
                                  fontSize:'0.8rem', color:'var(--white-dim)', lineHeight:1.6,
                                  whiteSpace:'pre-wrap', marginTop:'8px',
                                  overflow:'hidden', maxHeight:'4.8em',
                                  maskImage:'linear-gradient(to bottom, black 60%, transparent 100%)',
                                  WebkitMaskImage:'linear-gradient(to bottom, black 60%, transparent 100%)'
                                }}>
                                  {gradeResp.responsibilities}
                                </div>
                              )}

                              {/* Compensation summary */}
                              {hasComp && (
                                <div style={{
                                  marginTop:'8px', display:'flex', gap:'16px', flexWrap:'wrap',
                                  padding:'10px 14px', borderRadius:'8px',
                                  background:'rgba(240,192,64,0.06)', border:'1px solid rgba(240,192,64,0.15)'
                                }}>
                                  <div>
                                    <span style={{ fontSize:'0.72rem', color:'var(--white-dim)' }}>Type</span>
                                    <div style={{ fontSize:'0.85rem', color:'var(--gold)', fontWeight:600 }}>
                                      {gradeComp.wage_type === 'hourly' ? 'Hourly' : 'Salary'}
                                    </div>
                                  </div>
                                  <div>
                                    <span style={{ fontSize:'0.72rem', color:'var(--white-dim)' }}>Range</span>
                                    <div style={{ fontSize:'0.85rem', color:'var(--white-soft)', fontWeight:600 }}>
                                      {gradeComp.wage_type === 'hourly'
                                        ? `$${gradeComp.wage_min}/hr – $${gradeComp.wage_max}/hr`
                                        : `$${Number(gradeComp.wage_min).toLocaleString()} – $${Number(gradeComp.wage_max).toLocaleString()}/yr`}
                                    </div>
                                  </div>
                                  {gradeComp.target_bonus_pct > 0 && (
                                    <div>
                                      <span style={{ fontSize:'0.72rem', color:'var(--white-dim)' }}>Target Bonus</span>
                                      <div style={{ fontSize:'0.85rem', color:'var(--green-bright)', fontWeight:600 }}>{gradeComp.target_bonus_pct}%</div>
                                    </div>
                                  )}
                                  {gradeComp.bonus_share_pct > 0 && (
                                    <div>
                                      <span style={{ fontSize:'0.72rem', color:'var(--white-dim)' }}>Bonus Share</span>
                                      <div style={{ fontSize:'0.85rem', color:'var(--green-bright)', fontWeight:600 }}>{gradeComp.bonus_share_pct}%</div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── BY EMPLOYEE ── */}
          {profilesSubTab === 'employees' && (
            <div>
              <p style={{ color:'var(--white-dim)', fontSize:'0.85rem', marginBottom:'16px', lineHeight:1.6 }}>
                Add employee-specific responsibilities that are <strong style={{ color:'var(--white-soft)' }}>in addition to</strong> their grade-level responsibilities. Both will be shown to the foreman during evaluation.
              </p>

              {editProfile ? (
                <div className="card" style={{ maxWidth:'640px' }}>
                  <div className="card-title">
                    Additional Responsibilities — {employees.find(e=>e.id===editProfile.employee_id)?.first_name} {employees.find(e=>e.id===editProfile.employee_id)?.last_name}
                    <span style={{ fontSize:'0.78rem', color:'var(--gold)', marginLeft:'8px', fontFamily:'var(--font-body)', fontWeight:400 }}>
                      ({employees.find(e=>e.id===editProfile.employee_id)?.job_grade})
                    </span>
                  </div>

                  {/* Show the grade-level responsibilities for context */}
                  {(() => {
                    const empGrade = employees.find(e=>e.id===editProfile.employee_id)?.job_grade
                    const gradeResp = gradeResponsibilities.find(r => r.job_grade === empGrade)
                    if (!gradeResp?.responsibilities) return null
                    return (
                      <div style={{
                        marginBottom:'16px', padding:'12px', borderRadius:'8px',
                        background:'rgba(240,192,64,0.06)', border:'1px solid rgba(240,192,64,0.15)'
                      }}>
                        <div style={{ fontSize:'0.75rem', color:'var(--gold)', marginBottom:'6px', letterSpacing:'0.04em' }}>
                          GRADE {empGrade} STANDARD RESPONSIBILITIES (already included automatically)
                        </div>
                        <div style={{ fontSize:'0.78rem', color:'var(--white-dim)', lineHeight:1.6, whiteSpace:'pre-wrap' }}>
                          {gradeResp.responsibilities}
                        </div>
                      </div>
                    )
                  })()}

                  <label className="form-label">Additional / Individual Responsibilities</label>
                  <textarea
                    className="form-textarea"
                    style={{ height:'200px', width:'100%', fontFamily:'monospace', fontSize:'0.84rem' }}
                    value={profileText}
                    onChange={e => setProfileText(e.target.value)}
                    placeholder={'• Serves as crew lead on building 3\n• Responsible for equipment sign-out\n• Training new A1 hire starting Q2\n...'}
                  />
                  <div style={{ display:'flex', gap:'10px', marginTop:'12px' }}>
                    <button className="btn btn-gold btn-sm" disabled={profileSaving} onClick={saveProfile}>
                      {profileSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => { setEditProfile(null); setProfileText('') }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Grade</th>
                        <th>Title</th>
                        <th>Grade Resp.</th>
                        <th>Individual Resp.</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(e => {
                        const prof = profiles.find(p => p.employee_id === e.id)
                        const gradeResp = gradeResponsibilities.find(r => r.job_grade === e.job_grade)
                        return (
                          <tr key={e.id}>
                            <td style={{ color:'var(--white-soft)' }}>{e.last_name}, {e.first_name}</td>
                            <td style={{ color:'var(--gold)', fontSize:'0.82rem' }}>{e.job_grade || '—'}</td>
                            <td style={{ color:'var(--white-dim)', fontSize:'0.82rem' }}>{e.job_title || '—'}</td>
                            <td>
                              <span style={{
                                fontSize:'0.72rem', padding:'2px 7px', borderRadius:'20px',
                                background: gradeResp ? 'rgba(240,192,64,0.1)' : 'rgba(255,255,255,0.05)',
                                color: gradeResp ? 'var(--gold)' : 'var(--white-dim)',
                                border: `1px solid ${gradeResp ? 'rgba(240,192,64,0.3)' : 'rgba(255,255,255,0.08)'}`,
                              }}>
                                {gradeResp ? '✓ Set' : 'None'}
                              </span>
                            </td>
                            <td>
                              <span style={{
                                fontSize:'0.72rem', padding:'2px 7px', borderRadius:'20px',
                                background: prof ? 'rgba(94,232,138,0.1)' : 'rgba(255,255,255,0.05)',
                                color: prof ? 'var(--green-bright)' : 'var(--white-dim)',
                                border: `1px solid ${prof ? 'rgba(94,232,138,0.3)' : 'rgba(255,255,255,0.08)'}`,
                              }}>
                                {prof ? '✓ Added' : 'None'}
                              </span>
                            </td>
                            <td>
                              <button className="btn btn-outline btn-xs" onClick={() => {
                                setEditProfile({ employee_id: e.id })
                                setProfileText(prof?.responsibilities || '')
                              }}>
                                {prof ? 'Edit' : 'Add'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── REPORT TAB ── */}
      {!loading && subTab==='report' && (
        <div style={{ display:'grid', gap:'16px', maxWidth:'700px' }}>
          <div className="card">
            <div className="card-title">📄 Generate & Push Report</div>
            <p style={{ color:'var(--white-dim)', fontSize:'0.88rem', marginBottom:'16px', lineHeight:1.6 }}>
              Generate a full performance report for all evaluated employees. Includes individual summaries with weighted scores, category breakdowns, and peer-group rankings (Sparks Report). Print or share as PDF.
            </p>

            <div style={{ marginBottom:'16px', padding:'12px', borderRadius:'8px', background:'rgba(240,192,64,0.06)', border:'1px solid rgba(240,192,64,0.2)' }}>
              <div style={{ fontSize:'0.82rem', color:'var(--white-dim)', marginBottom:'8px' }}>Report will include:</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                {[
                  `${empScoreSummaries.length} employees with submitted evals`,
                  `${categories.length} evaluation categories`,
                  'Work-day-weighted scoring',
                  'Cycle-by-cycle breakdown',
                  'Peer group rankings',
                  'Overall weighted scores',
                ].map((item,i) => (
                  <div key={i} style={{ fontSize:'0.8rem', color:'var(--white-soft)', display:'flex', gap:'6px', alignItems:'center' }}>
                    <span style={{ color:'var(--gold)' }}>✓</span> {item}
                  </div>
                ))}
              </div>
            </div>

            <button className="btn btn-gold" onClick={generateReport} disabled={empScoreSummaries.length===0}>
              📄 Generate & Print Report
            </button>
            {empScoreSummaries.length === 0 && (
              <p style={{ fontSize:'0.78rem', color:'var(--white-dim)', marginTop:'8px' }}>
                No submitted evaluations available to report on yet.
              </p>
            )}
          </div>

          {/* Summary preview */}
          <div className="card">
            <div className="card-title">Preview — Employee Summaries</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Grade</th>
                    <th>Score</th>
                    {categories.map(c => <th key={c.id} style={{ fontSize:'0.7rem', whiteSpace:'nowrap' }}>{c.name}</th>)}
                    <th>Given</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {empScoreSummaries.map(({ employee, weightedScore }) => {
                    const empCycles = cycles.filter(c => c.employee_id === employee?.id && c.status === 'submitted')
                    const catScores = categories.map(cat => {
                      const catQIds = questions.filter(q => q.category_id === cat.id).map(q => q.id)
                      const catAnswers = answers.filter(a =>
                        empCycles.some(c => c.id === a.cycle_id) && catQIds.includes(a.question_id) && a.score
                      )
                      return catAnswers.length > 0
                        ? catAnswers.reduce((s, a) => s + a.score, 0) / catAnswers.length
                        : null
                    })
                    const ss = sparkStats[employee?.id]
                    return (
                      <tr key={employee?.id}>
                        <td style={{ color:'var(--white-soft)' }}>{employee?.last_name}, {employee?.first_name}</td>
                        <td style={{ color:'var(--gold)', fontSize:'0.82rem' }}>{employee?.job_grade}</td>
                        <td><ScoreBadge score={weightedScore}/></td>
                        {catScores.map((avg, i) => (
                          <td key={i} style={{ textAlign:'center' }}>
                            {avg !== null
                              ? <span style={{ fontSize:'0.8rem', fontWeight:600, color: avg>=4?'var(--green-bright)':avg>=3?'var(--gold)':'var(--red)' }}>{avg.toFixed(1)}</span>
                              : <span style={{ color:'var(--white-dim)', fontSize:'0.78rem' }}>—</span>}
                          </td>
                        ))}
                        <td style={{ fontSize:'0.82rem', color:'var(--gold)' }}>
                          {ss ? `${ss.given}${ss.allotted > 0 ? ` / ${ss.allotted}` : ''}` : '—'}
                        </td>
                        <td style={{ fontSize:'0.82rem', color:'var(--green-bright)' }}>
                          {ss ? ss.received : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {empScoreSummaries.length === 0 && (
                    <tr><td colSpan={5 + categories.length} style={{ color:'var(--white-dim)', textAlign:'center', padding:'20px' }}>No data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Peer group preview */}
          {Object.entries(PEER_GROUPS).map(([group, grades]) => {
            const groupEmps = empScoreSummaries
              .filter(s => s.employee && grades.includes(s.employee.job_grade) && s.weightedScore !== null)
              .sort((a,b) => (b.weightedScore||0)-(a.weightedScore||0))
            if (groupEmps.length === 0) return null
            return (
              <div key={group} className="card">
                <div className="card-title">⚡ Sparks Report — {group}</div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Rank</th><th>Employee</th><th>Grade</th><th>Score</th></tr></thead>
                    <tbody>
                      {groupEmps.map(({ employee, weightedScore }, i) => (
                        <tr key={employee?.id}>
                          <td style={{ color: i===0 ? 'var(--gold)' : 'var(--white-dim)' }}>
                            {i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `#${i+1}`}
                          </td>
                          <td style={{ color:'var(--white-soft)' }}>{employee?.last_name}, {employee?.first_name}</td>
                          <td style={{ color:'var(--gold)', fontSize:'0.82rem' }}>{employee?.job_grade}</td>
                          <td><ScoreBadge score={weightedScore}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
