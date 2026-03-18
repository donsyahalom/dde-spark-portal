import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ── Helpers ────────────────────────────────────────────────────────────────────
function isExcluded(emp) { return emp.is_optional === true }

function fmt$(n, sparkValue) {
  return '$' + (n * parseFloat(sparkValue || 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Combined Bar + Line chart ─────────────────────────────────────────────────
// Bars = spark count (gold), Line = utilization % (blue), dual axis, no scroll.
// Labels stagger: bar count sits inside/top of bar; % label sits on the line dot.
// Hover tooltip shows full values.
function ComboChart({ data, showDollar, sparkValue }) {
  const [tooltip, setTooltip] = useState(null) // { x, y, label, sparks, util }
  if (!data || data.length === 0) return (
    <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>No data</div>
  )

  // Fixed viewBox: chart always fills container width, no horizontal scroll
  const VW = 500, BAR_AREA_H = 160, X_LABEL_H = 28, UTIL_LABEL_H = 18, TOP_PAD = 8
  const TOTAL_H = TOP_PAD + UTIL_LABEL_H + BAR_AREA_H + X_LABEL_H
  const n = data.length
  const slotW = VW / n
  const barW = Math.max(8, Math.min(48, slotW * 0.55))
  const maxBar = Math.max(...data.map(d => d.sparks), 1)

  // Bar Y within BAR_AREA (top = TOP_PAD + UTIL_LABEL_H, bottom = TOP_PAD + UTIL_LABEL_H + BAR_AREA_H)
  const barTop = TOP_PAD + UTIL_LABEL_H
  const barBot = barTop + BAR_AREA_H

  // Util line maps 0–100% onto BAR_AREA (so it overlays the bars)
  const utilY = (pct) => barBot - (Math.min(pct, 110) / 100) * BAR_AREA_H

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${VW} ${TOTAL_H}`} style={{ width: '100%', display: 'block' }}>
        {/* Grid lines at 25/50/75/100% mapped onto bar area */}
        {[25, 50, 75, 100].map(pct => {
          const y = utilY(pct)
          return (
            <g key={pct}>
              <line x1={0} y1={y} x2={VW} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="3,4" />
              <text x={VW - 2} y={y - 2} textAnchor="end" fill="rgba(128,196,255,0.4)" fontSize={7}>{pct}%</text>
            </g>
          )
        })}

        {data.map((d, i) => {
          const cx = (i + 0.5) * slotW
          const barH = Math.max(4, Math.round((d.sparks / maxBar) * BAR_AREA_H))
          const barY = barBot - barH
          const barX = cx - barW / 2
          const labelVal = showDollar ? fmt$(d.sparks, sparkValue) : String(d.sparks)
          // Bar label: inside bar if tall enough, otherwise just above
          const insideBar = barH > 22
          const barLabelY = insideBar ? barY + 13 : barY - 3

          return (
            <g key={i}
              onMouseEnter={e => setTooltip({ svgX: cx, svgY: barY, label: d.label, sparks: d.sparks, util: d.util, dollar: showDollar ? fmt$(d.sparks, sparkValue) : null })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'default' }}>
              {/* Bar */}
              <rect x={barX} y={barY} width={barW} height={barH}
                fill="var(--gold)" opacity={0.82} rx={2} />
              {/* Spark count label — gold, on/in bar */}
              <text x={cx} y={barLabelY} textAnchor="middle"
                fill={insideBar ? 'rgba(0,0,0,0.75)' : 'var(--gold)'} fontSize={8} fontWeight={700}>{labelVal}</text>
              {/* X-axis label */}
              <text x={cx} y={barBot + X_LABEL_H - 4} textAnchor="middle"
                fill="rgba(255,255,255,0.45)" fontSize={8}>
                {d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label}
              </text>
            </g>
          )
        })}

        {/* Utilization line + dots + % labels (staggered above dots, above bar area) */}
        {n >= 1 && (() => {
          const pts = data.map((d, i) => ({ x: (i + 0.5) * slotW, y: utilY(d.util), util: d.util }))
          const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ')
          return (
            <g>
              {n >= 2 && <polyline points={polyPts} fill="none" stroke="#80c4ff" strokeWidth={1.5} strokeLinejoin="round" />}
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={3.5} fill="#80c4ff" />
                  {/* % label — sits at TOP_PAD + 2 above the util line dot, blue, never overlaps bar label */}
                  <text x={p.x} y={TOP_PAD + UTIL_LABEL_H - 3} textAnchor="middle"
                    fill="#80c4ff" fontSize={8} fontWeight={700}>{p.util}%</text>
                </g>
              ))}
            </g>
          )
        })()}
      </svg>

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(17,46,28,0.97)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '8px 12px', pointerEvents: 'none', zIndex: 20,
          fontSize: '0.75rem', minWidth: '140px', textAlign: 'center'
        }}>
          <div style={{ fontWeight: 700, color: 'var(--white-soft)', marginBottom: '4px' }}>{tooltip.label}</div>
          <div style={{ color: 'var(--gold)' }}>✨ {tooltip.sparks} sparks{tooltip.dollar ? \` (${tooltip.dollar})\` : ''}</div>
          <div style={{ color: '#80c4ff' }}>Utilization: {tooltip.util}%</div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.68rem', color: 'var(--gold)' }}>
          <div style={{ width: 12, height: 10, background: 'var(--gold)', borderRadius: 2, opacity: 0.82 }} />
          Sparks Received
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.68rem', color: '#80c4ff' }}>
          <div style={{ width: 18, height: 2, background: '#80c4ff', borderRadius: 1 }} />
          Utilization %
        </div>
      </div>
    </div>
  )
}

// ── Trend Chart with grouping selector ────────────────────────────────────────
function TrendChart({ transactions, dateFrom, dateTo, dayCount, showDollar, sparkValue, employees }) {
  const [groupBy, setGroupBy] = useState('auto')   // auto | day | week | month
  const [filterBy, setFilterBy] = useState('all')  // all | incl | excl | title:<val>

  // Build title list for filter
  const titleList = useMemo(() => {
    const s = new Set()
    transactions.forEach(t => { if (t.to_emp?.job_title) s.add(t.to_emp.job_title) })
    return [...s].sort()
  }, [transactions])

  const empMap = useMemo(() => {
    const m = {}
    ;(employees || []).forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const effectiveGroup = groupBy === 'auto'
    ? (dayCount <= 14 ? 'day' : dayCount <= 90 ? 'week' : 'month')
    : groupBy

  const data = useMemo(() => {
    const buckets = {}
    transactions.forEach(t => {
      // Apply filter
      if (filterBy === 'incl') { /* include all */ }
      else if (filterBy === 'excl') {
        const fromEmp = empMap[t.from_employee_id]
        const toEmp = empMap[t.to_employee_id]
        if ((fromEmp && isExcluded(fromEmp)) || (toEmp && isExcluded(toEmp))) return
      } else if (filterBy.startsWith('title:')) {
        const title = filterBy.slice(6)
        if (t.to_emp?.job_title !== title) return
      }

      const d = new Date(t.created_at)
      let key
      if (effectiveGroup === 'day') {
        key = d.toISOString().split('T')[0]
      } else if (effectiveGroup === 'week') {
        const wk = new Date(d); wk.setDate(d.getDate() - d.getDay()); key = wk.toISOString().split('T')[0]
      } else {
        key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      }
      buckets[key] = (buckets[key] || 0) + (t.amount || 0)
    })
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
      let label
      if (effectiveGroup === 'month') {
        const [yr, mo] = k.split('-')
        label = new Date(+yr, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      } else {
        label = new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }
      return { label, value: v, key: k }
    })
  }, [transactions, filterBy, effectiveGroup, empMap])

  if (data.length === 0) return (
    <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>No data in range</div>
  )

  const max = Math.max(...data.map(d => d.value), 1)
  const total = data.reduce((s, d) => s + d.value, 0)
  const avg = data.length > 0 ? (total / data.length).toFixed(1) : 0
  const w = 500, h = 120

  const pts = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * (w - 30) + 15
    const y = h - 20 - ((d.value / max) * (h - 30))
    return { x, y, ...d }
  })

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--white-dim)', alignSelf: 'center', marginRight: '2px' }}>Group:</span>
          {[['auto','Auto'],['day','Day'],['week','Week'],['month','Month']].map(([v, l]) => (
            <button key={v} onClick={() => setGroupBy(v)}
              className={`btn btn-xs ${groupBy === v ? 'btn-gold' : 'btn-outline'}`}
              style={{ fontSize: '0.65rem' }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--white-dim)', alignSelf: 'center', marginRight: '2px' }}>Filter:</span>
          <button onClick={() => setFilterBy('all')} className={`btn btn-xs ${filterBy === 'all' ? 'btn-gold' : 'btn-outline'}`} style={{ fontSize: '0.65rem' }}>All</button>
          {showDollar && <button onClick={() => setFilterBy('incl')} className={`btn btn-xs ${filterBy === 'incl' ? 'btn-gold' : 'btn-outline'}`} style={{ fontSize: '0.65rem' }}>Incl Optional</button>}
          <button onClick={() => setFilterBy('excl')} className={`btn btn-xs ${filterBy === 'excl' ? 'btn-gold' : 'btn-outline'}`} style={{ fontSize: '0.65rem' }}>Excl Optional</button>
          {titleList.map(t => (
            <button key={t} onClick={() => setFilterBy('title:' + t)}
              className={`btn btn-xs ${filterBy === 'title:' + t ? 'btn-gold' : 'btn-outline'}`}
              style={{ fontSize: '0.65rem' }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Summary context */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--white-dim)' }}>
          Total: <strong style={{ color: 'var(--gold)' }}>{total} sparks</strong>
          {showDollar && <span style={{ color: 'var(--white-dim)' }}> ({fmt$(total, sparkValue)})</span>}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--white-dim)' }}>
          Avg per {effectiveGroup}: <strong style={{ color: 'var(--white-soft)' }}>{avg}</strong>
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--white-dim)' }}>
          Peak: <strong style={{ color: 'var(--green-bright)' }}>{max}</strong>
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--white-dim)', textTransform: 'capitalize' }}>
          Grouping: {effectiveGroup}{groupBy === 'auto' ? ' (auto)' : ''}
          {filterBy !== 'all' && <span style={{ color: 'var(--gold)', marginLeft: '6px' }}>· {filterBy.startsWith('title:') ? filterBy.slice(6) : filterBy}</span>}
        </span>
      </div>

      {/* Line chart */}
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', minWidth: '300px', height: `${h}px` }}>
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map(f => {
            const y = h - 20 - f * (h - 30)
            const val = Math.round(max * f)
            return (
              <g key={f}>
                <line x1={15} y1={y} x2={w - 10} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <text x={12} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize={7}>{val}</text>
              </g>
            )
          })}
          {/* Line */}
          <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke="var(--gold)" strokeWidth={2} strokeLinejoin="round" />
          {/* Points + labels */}
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={3} fill="var(--gold)" />
              {/* Value above */}
              <text x={p.x} y={p.y - 6} textAnchor="middle" fill="var(--gold)" fontSize={8} fontWeight={700}>{p.value}</text>
              {/* Date below */}
              <text x={p.x} y={h - 4} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={7}>{p.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ── Utilization Gauge ─────────────────────────────────────────────────────────
function UtilGauge({ used, total, label, color = '#5ee88a' }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const r = 36, cx = 44, cy = 44, circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={88} height={88} viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4}
          strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s' }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={13} fontWeight={700}>{pct}%</text>
      </svg>
      <div style={{ fontSize: '0.7rem', color: 'var(--white-dim)', marginTop: '4px' }}>{label}</div>
      <div style={{ fontSize: '0.65rem', color: 'var(--white-dim)' }}>{used} / {total}</div>
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
  return (
    <div className="stat-card" style={{ minWidth: '110px' }}>
      <div className="stat-value" style={color ? { color, fontSize: '1.3rem' } : { fontSize: '1.3rem' }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function SectionHeader({ icon, title, sub }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', color: 'var(--gold)', letterSpacing: '0.1em', marginBottom: '2px' }}>{icon} {title}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)' }}>{sub}</div>}
    </div>
  )
}

// ── Main DashboardTab ─────────────────────────────────────────────────────────
export default function DashboardTab({ showDollar = true, limitToTeamIds = null }) {
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])
  const [transactions, setTransactions] = useState([])
  const [teams, setTeams] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [settings, setSettings] = useState({})
  const [sparkValue, setSparkValue] = useState('1.00')
  const [titleOrder, setTitleOrder] = useState([])

  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] }
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [rangePreset, setRangePreset] = useState('30d')

  const setPreset = (p) => {
    setRangePreset(p)
    const now = new Date(), from = new Date()
    if (p === '7d') from.setDate(now.getDate() - 7)
    else if (p === '30d') from.setDate(now.getDate() - 30)
    else if (p === '90d') from.setDate(now.getDate() - 90)
    else if (p === 'ytd') from.setMonth(0, 1)
    else if (p === 'all') { setDateFrom('2020-01-01'); setDateTo(now.toISOString().split('T')[0]); return }
    setDateFrom(from.toISOString().split('T')[0])
    setDateTo(now.toISOString().split('T')[0])
  }

  useEffect(() => { fetchAll() }, [dateFrom, dateTo])

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: emps }, { data: txns }, { data: teamsData }, { data: membersData }, { data: settingsData }, { data: listsData }] = await Promise.all([
      supabase.from('employees').select('*').eq('is_admin', false),
      supabase.from('spark_transactions')
        .select('*, from_emp:from_employee_id(id,first_name,last_name,job_title,job_grade,is_optional), to_emp:to_employee_id(id,first_name,last_name,job_title,job_grade,is_optional)')
        .eq('transaction_type', 'assign')
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: true }),
      supabase.from('teams').select('*').order('sort_order').order('name'),
      supabase.from('team_members').select('*'),
      supabase.from('settings').select('*'),
      supabase.from('custom_lists').select('value').eq('list_type', 'job_title').order('sort_order'),
    ])
    setEmployees(emps || [])
    setTransactions(txns || [])
    setTeams(teamsData || [])
    setTeamMembers(membersData || [])
    const sObj = {}; (settingsData || []).forEach(s => { sObj[s.key] = s.value })
    setSettings(sObj)
    setSparkValue(sObj.spark_value || '1.00')
    setTitleOrder((listsData || []).map(r => r.value))
    setLoading(false)
  }

  const sv = parseFloat(sparkValue || 1)

  const allowedEmpIds = useMemo(() => {
    if (!limitToTeamIds) return null
    const ids = new Set()
    teamMembers.filter(m => limitToTeamIds.includes(m.team_id)).forEach(m => ids.add(m.employee_id))
    return ids
  }, [limitToTeamIds, teamMembers])

  const filteredEmps = useMemo(() =>
    allowedEmpIds ? employees.filter(e => allowedEmpIds.has(e.id)) : employees
  , [employees, allowedEmpIds])

  const filteredTxns = useMemo(() =>
    allowedEmpIds
      ? transactions.filter(t => allowedEmpIds.has(t.from_employee_id) || allowedEmpIds.has(t.to_employee_id))
      : transactions
  , [transactions, allowedEmpIds])

  const empsAll = filteredEmps
  const empsExcl = filteredEmps.filter(e => !isExcluded(e))

  const excludedEmpIds = useMemo(() =>
    new Set(filteredEmps.filter(e => isExcluded(e)).map(e => e.id))
  , [filteredEmps])

  const freq = settings.spark_frequency || 'daily'
  const goLive = settings.go_live_date || null
  const periodsPerYear = freq === 'daily' ? 260 : freq === 'weekly' ? 52 : freq === 'biweekly' ? 26 : 12
  const annualizedAll = empsAll.reduce((s, e) => s + (e.daily_accrual || 0) * periodsPerYear, 0)
  const annualizedExcl = empsExcl.reduce((s, e) => s + (e.daily_accrual || 0) * periodsPerYear, 0)

  const sparksGivenAll = filteredTxns.reduce((s, t) => s + (t.amount || 0), 0)
  const sparksGivenExcl = filteredTxns
    .filter(t => !excludedEmpIds.has(t.from_employee_id) && !excludedEmpIds.has(t.to_employee_id))
    .reduce((s, t) => s + (t.amount || 0), 0)

  const dayCount = Math.max(1, Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1)
  const workDays = Math.round(dayCount * 5 / 7)
  const periods = freq === 'daily' ? workDays : freq === 'weekly' ? Math.max(1, Math.round(dayCount / 7)) : freq === 'biweekly' ? Math.max(1, Math.round(dayCount / 14)) : Math.max(1, Math.round(dayCount / 30))

  const allocatedAll = empsAll.reduce((s, e) => s + (e.daily_accrual || 0) * periods, 0)
  const allocatedExcl = empsExcl.reduce((s, e) => s + (e.daily_accrual || 0) * periods, 0)

  const utilAll = allocatedAll > 0 ? Math.round((sparksGivenAll / allocatedAll) * 100) : 0
  const utilExcl = allocatedExcl > 0 ? Math.round((sparksGivenExcl / allocatedExcl) * 100) : 0

  const sortByTitleOrder = (items) => {
    if (!titleOrder.length) return items
    return [...items].sort((a, b) => {
      const ai = titleOrder.indexOf(a.label), bi = titleOrder.indexOf(b.label)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  // Combined title data: sparks received count + utilization %
  const byTitleCombo = useMemo(() => {
    const sparksMap = {}, accrMap = {}, givenMap = {}
    filteredTxns.forEach(t => {
      const title = t.to_emp?.job_title || 'Unknown'
      sparksMap[title] = (sparksMap[title] || 0) + (t.amount || 0)
    })
    empsAll.forEach(e => {
      const t = e.job_title || 'Unknown'
      accrMap[t] = (accrMap[t] || 0) + (e.daily_accrual || 0) * periods
    })
    filteredTxns.forEach(t => {
      const title = t.from_emp?.job_title || 'Unknown'
      givenMap[title] = (givenMap[title] || 0) + (t.amount || 0)
    })
    const allTitles = new Set([...Object.keys(sparksMap), ...Object.keys(accrMap)])
    const items = [...allTitles].map(label => ({
      label,
      sparks: sparksMap[label] || 0,
      util: accrMap[label] > 0 ? Math.round(((givenMap[label] || 0) / accrMap[label]) * 100) : 0,
    }))
    return sortByTitleOrder(items)
  }, [filteredTxns, empsAll, periods, titleOrder])

  // Combined team data: sparks received + utilization
  const byTeamCombo = useMemo(() => {
    const visibleTeams = limitToTeamIds ? teams.filter(t => limitToTeamIds.includes(t.id)) : teams
    return visibleTeams.map(team => {
      const memberIds = new Set(teamMembers.filter(m => m.team_id === team.id).map(m => m.employee_id))
      const given = filteredTxns.filter(t => memberIds.has(t.to_employee_id)).reduce((s, t) => s + (t.amount || 0), 0)
      const allocated = filteredEmps.filter(e => memberIds.has(e.id)).reduce((s, e) => s + (e.daily_accrual || 0) * periods, 0)
      const util = allocated > 0 ? Math.round((given / allocated) * 100) : 0
      return { label: team.name, sparks: given, util, allocated }
    }).filter(t => t.allocated > 0 || t.sparks > 0)
  }, [teams, teamMembers, filteredTxns, filteredEmps, periods, limitToTeamIds])

  const topGivers = useMemo(() => {
    const map = {}
    filteredTxns.forEach(t => {
      const key = t.from_employee_id; if (!key) return
      if (!map[key]) map[key] = { name: t.from_emp ? `${t.from_emp.first_name} ${t.from_emp.last_name}` : 'Unknown', value: 0, title: t.from_emp?.job_title || '' }
      map[key].value += t.amount || 0
    })
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [filteredTxns])

  const topReceivers = useMemo(() => {
    const map = {}
    filteredTxns.forEach(t => {
      const key = t.to_employee_id; if (!key) return
      if (!map[key]) map[key] = { name: t.to_emp ? `${t.to_emp.first_name} ${t.to_emp.last_name}` : 'Unknown', value: 0, title: t.to_emp?.job_title || '' }
      map[key].value += t.amount || 0
    })
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [filteredTxns])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--white-dim)' }}>Loading dashboard…</div>

  return (
    <div>
      {/* ── Date Range Controls ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[['7d','7 Days'],['30d','30 Days'],['90d','90 Days'],['ytd','YTD'],['all','All Time']].map(([p, lbl]) => (
              <button key={p} onClick={() => setPreset(p)}
                className={`btn btn-sm ${rangePreset === p ? 'btn-gold' : 'btn-outline'}`}
                style={{ fontSize: '0.72rem' }}>{lbl}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" className="form-input" style={{ width: 'auto', fontSize: '0.8rem' }} value={dateFrom} onChange={e => { setDateFrom(e.target.value); setRangePreset('custom') }} />
            <span style={{ color: 'var(--white-dim)', fontSize: '0.8rem' }}>to</span>
            <input type="date" className="form-input" style={{ width: 'auto', fontSize: '0.8rem' }} value={dateTo} onChange={e => { setDateTo(e.target.value); setRangePreset('custom') }} />
          </div>
          <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--white-dim)', alignSelf: 'center' }}>
            {fmtDate(dateFrom)} — {fmtDate(dateTo)} · {dayCount} days
            {goLive && <span style={{ marginLeft: '8px', color: 'var(--gold)' }}>Go-live: {fmtDate(goLive)}</span>}
          </div>
        </div>
      </div>

      {/* ── Annualized Budget + Company Utilization (top) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: showDollar ? '1fr 1fr' : '1fr', gap: '16px', marginBottom: '16px', alignItems: 'start' }}>
        <div className="card">
          <SectionHeader icon="📈" title="ANNUALIZED SPARK BUDGET"
            sub={showDollar ? `${freq} accrual × ${periodsPerYear} periods/yr · $${sv}/spark` : `${freq} accrual × ${periodsPerYear} periods/yr`} />
          {showDollar ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Row 1: Including Optional — sparks + $ side by side */}
              <div>
                <div style={{ fontSize: '0.62rem', color: 'var(--gold)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '6px' }}>INCLUDING OPTIONAL</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <StatCard label="Annual Sparks" value={annualizedAll.toLocaleString()} color="var(--gold)" />
                  <StatCard label="Annual $" value={`$${(annualizedAll * sv).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color="var(--gold)" />
                </div>
              </div>
              {/* Row 2: Excluding Optional — sparks + $ side by side */}
              <div>
                <div style={{ fontSize: '0.62rem', color: 'var(--green-bright)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '6px' }}>EXCLUDING OPTIONAL</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <StatCard label="Annual Sparks" value={annualizedExcl.toLocaleString()} color="var(--green-bright)" />
                  <StatCard label="Annual $" value={`$${(annualizedExcl * sv).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color="var(--green-bright)" />
                </div>
              </div>
            </div>
          ) : (
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))' }}>
              <StatCard label="Annual Sparks" value={annualizedExcl.toLocaleString()} color="var(--green-bright)" />
            </div>
          )}
        </div>

        {showDollar && (
          <div className="card">
            <SectionHeader icon="🏢" title="COMPANY-WIDE UTILIZATION" sub="Period spark usage vs allocation" />
            {/* Two rows aligned: gauge + $ spend. Row 1 = Incl, Row 2 = Excl */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Row 1: Including Optional */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <UtilGauge used={sparksGivenAll} total={allocatedAll} label={`Incl Optional · ${utilAll}%`} color="var(--gold)" />
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--white-dim)', marginBottom: '2px' }}>$ Spend (Incl Optional)</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--gold)' }}>{fmt$(sparksGivenAll, sparkValue)}</div>
                </div>
              </div>
              {/* Row 2: Excluding Optional */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <UtilGauge used={sparksGivenExcl} total={allocatedExcl} label={`Excl Optional · ${utilExcl}%`} color="var(--green-bright)" />
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--white-dim)', marginBottom: '2px' }}>$ Spend (Excl Optional)</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--green-bright)' }}>{fmt$(sparksGivenExcl, sparkValue)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Period Activity — 4 + 4 layout ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <SectionHeader icon="⚡" title="PERIOD ACTIVITY"
          sub={`${fmtDate(dateFrom)} – ${fmtDate(dateTo)} · ~${periods} ${freq} period${periods !== 1 ? 's' : ''}`} />

        {showDollar ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Incl Optional — 4 stats + gauge */}
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--gold)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '8px' }}>INCLUDING OPTIONAL</div>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginBottom: '12px' }}>
                <StatCard label="Allocated" value={allocatedAll} color="var(--white-soft)" />
                <StatCard label="Given" value={sparksGivenAll} color="var(--gold)" />
                <StatCard label="Remaining" value={Math.max(0, allocatedAll - sparksGivenAll)} color="var(--white-dim)" />
                <StatCard label="$ Spend" value={fmt$(sparksGivenAll, sparkValue)} color="var(--gold)" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <UtilGauge used={sparksGivenAll} total={allocatedAll} label="Utilization" color="var(--gold)" />
              </div>
            </div>
            {/* Excl Optional — 4 stats + gauge */}
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--green-bright)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '8px' }}>EXCLUDING OPTIONAL</div>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginBottom: '12px' }}>
                <StatCard label="Allocated" value={allocatedExcl} color="var(--white-soft)" />
                <StatCard label="Given" value={sparksGivenExcl} color="var(--green-bright)" />
                <StatCard label="Remaining" value={Math.max(0, allocatedExcl - sparksGivenExcl)} color="var(--white-dim)" />
                <StatCard label="$ Spend" value={fmt$(sparksGivenExcl, sparkValue)} color="var(--green-bright)" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <UtilGauge used={sparksGivenExcl} total={allocatedExcl} label="Utilization" color="var(--green-bright)" />
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginBottom: '12px', maxWidth: '320px' }}>
              <StatCard label="Allocated" value={allocatedExcl} color="var(--white-soft)" />
              <StatCard label="Given" value={sparksGivenExcl} color="var(--green-bright)" />
              <StatCard label="Remaining" value={Math.max(0, allocatedExcl - sparksGivenExcl)} color="var(--white-dim)" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <UtilGauge used={sparksGivenExcl} total={allocatedExcl} label="Utilization" color="var(--green-bright)" />
            </div>
          </div>
        )}

        {/* Team gauges underneath */}
        {byTeamCombo.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '16px', paddingTop: '14px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '10px' }}>TEAM UTILIZATION</div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {byTeamCombo.map(t => (
                <UtilGauge key={t.label} used={t.sparks} total={t.allocated} label={t.label} color="#80c4ff" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Sparks Given Over Time ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <SectionHeader icon="📉" title="SPARKS GIVEN OVER TIME" />
        <TrendChart
          transactions={filteredTxns}
          dateFrom={dateFrom}
          dateTo={dateTo}
          dayCount={dayCount}
          showDollar={showDollar}
          sparkValue={sparkValue}
          employees={filteredEmps}
        />
      </div>

      {/* ── Combined Charts by Title — full width row ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <SectionHeader icon="🧑‍🔧" title="SPARKS RECEIVED + UTILIZATION BY TITLE"
          sub="Bars = spark count  ·  Line = utilization %  ·  Hover for details" />
        <ComboChart data={byTitleCombo} showDollar={showDollar} sparkValue={sparkValue} />
      </div>

      {/* ── Combined Charts by Team — full width row ── */}
      {byTeamCombo.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <SectionHeader icon="👷" title="SPARKS RECEIVED + UTILIZATION BY TEAM"
            sub="Bars = spark count  ·  Line = utilization %  ·  Hover for details" />
          <ComboChart data={byTeamCombo} showDollar={showDollar} sparkValue={sparkValue} />
        </div>
      )}

      {/* ── Top 10 Givers / Receivers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div className="card">
          <SectionHeader icon="🎁" title="TOP 10 GIVERS" />
          {topGivers.length === 0
            ? <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem' }}>No data</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {topGivers.map((g, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--white-dim)', width: '18px', textAlign: 'right', flexShrink: 0 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)' }}>{g.title}</div>
                    </div>
                    <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.88rem', flexShrink: 0 }}>✨ {g.value}</span>
                    {showDollar && <span style={{ color: 'var(--white-dim)', fontSize: '0.72rem', flexShrink: 0 }}>{fmt$(g.value, sparkValue)}</span>}
                  </div>
                ))}
              </div>
          }
        </div>
        <div className="card">
          <SectionHeader icon="🏆" title="TOP 10 RECEIVERS" />
          {topReceivers.length === 0
            ? <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem' }}>No data</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {topReceivers.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--white-dim)', width: '18px', textAlign: 'right', flexShrink: 0 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)' }}>{r.title}</div>
                    </div>
                    <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.88rem', flexShrink: 0 }}>✨ {r.value}</span>
                    {showDollar && <span style={{ color: 'var(--white-dim)', fontSize: '0.72rem', flexShrink: 0 }}>{fmt$(r.value, sparkValue)}</span>}
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
    </div>
  )
}
