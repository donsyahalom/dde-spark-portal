import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ── Helpers ────────────────────────────────────────────────────────────────────
// Exclusion is determined solely by the is_optional flag on the employee record.
// Job grade and title are not considered here.
function isExcluded(emp) {
  return emp.is_optional === true
}

function fmt$(n, sparkValue) {
  return '$' + (n * parseFloat(sparkValue || 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Mini SVG Bar Chart ────────────────────────────────────────────────────────
function BarChart({ data, color = '#f0c040', showDollar, sparkValue, height = 160 }) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>No data</div>
  const max = Math.max(...data.map(d => d.value), 1)
  const barW = Math.max(20, Math.min(60, Math.floor(400 / data.length) - 8))
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', minHeight: `${height}px`, padding: '0 4px 0 4px' }}>
        {data.map((d, i) => {
          const pct = d.value / max
          const barH = Math.max(4, Math.round(pct * (height - 36)))
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: '0 0 auto', width: `${barW}px` }}>
              <div style={{ fontSize: '0.6rem', color: color, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {showDollar ? fmt$(d.value, sparkValue) : d.value}
              </div>
              <div style={{ width: '100%', height: `${barH}px`, background: color, borderRadius: '4px 4px 0 0', opacity: 0.85, transition: 'height 0.3s' }} title={`${d.label}: ${d.value}`} />
              <div style={{ fontSize: '0.58rem', color: 'var(--white-dim)', textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: `${barW}px` }}>{d.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Utilization Gauge ─────────────────────────────────────────────────────────
function UtilGauge({ used, total, label, color = '#5ee88a' }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const r = 36, cx = 44, cy = 44
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={88} height={88} viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s' }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={13} fontWeight={700}>{pct}%</text>
      </svg>
      <div style={{ fontSize: '0.7rem', color: 'var(--white-dim)', marginTop: '4px' }}>{label}</div>
      <div style={{ fontSize: '0.65rem', color: 'var(--white-dim)' }}>{used} / {total}</div>
    </div>
  )
}

// ── Line/Trend Chart ──────────────────────────────────────────────────────────
function TrendChart({ data, color = '#f0c040', height = 100 }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 400, h = height
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (w - 20) + 10
    const y = h - 10 - ((d.value / max) * (h - 20))
    return `${x},${y}`
  }).join(' ')
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', minWidth: '260px', height: `${height}px` }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * (w - 20) + 10
          const y = h - 10 - ((d.value / max) * (h - 20))
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={3} fill={color} />
              <text x={x} y={h - 1} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={8}>{d.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card" style={{ minWidth: '120px' }}>
      <div className="stat-value" style={color ? { color, fontSize: '1.4rem' } : { fontSize: '1.4rem' }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: 'var(--white-dim)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

// ── Section Header ────────────────────────────────────────────────────────────
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

  // Date range — default: last 30 days
  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] }
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [rangePreset, setRangePreset] = useState('30d')

  const setPreset = (p) => {
    setRangePreset(p)
    const now = new Date()
    const from = new Date()
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
    const [{ data: emps }, { data: txns }, { data: teamsData }, { data: membersData }, { data: settingsData }] = await Promise.all([
      supabase.from('employees').select('*').eq('is_admin', false),
      supabase.from('spark_transactions')
        .select('*, from_emp:from_employee_id(id,first_name,last_name,job_title,job_grade), to_emp:to_employee_id(id,first_name,last_name,job_title,job_grade)')
        .eq('transaction_type', 'assign')
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: true }),
      supabase.from('teams').select('*'),
      supabase.from('team_members').select('*'),
      supabase.from('settings').select('*'),
    ])
    setEmployees(emps || [])
    setTransactions(txns || [])
    setTeams(teamsData || [])
    setTeamMembers(membersData || [])
    const sObj = {}; (settingsData || []).forEach(s => { sObj[s.key] = s.value })
    setSettings(sObj)
    setSparkValue(sObj.spark_value || '1.00')
    setLoading(false)
  }

  // ── Derived data ────────────────────────────────────────────────────────────
  const sv = parseFloat(sparkValue || 1)

  // Filter employees by team if limitToTeamIds is set
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

  // Split incl/excl optional
  const empsAll = filteredEmps
  const empsExcl = filteredEmps.filter(e => !isExcluded(e))

  // Build a Set of excluded employee IDs from the full employee records
  // (transaction join objects don't carry is_optional, so we must use the emp list)
  const excludedEmpIds = useMemo(() =>
    new Set(filteredEmps.filter(e => isExcluded(e)).map(e => e.id))
  , [filteredEmps])

  // Frequency / period helpers
  const freq = settings.spark_frequency || 'daily'
  const goLive = settings.go_live_date || null

  // Total allocated sparks (annualized)
  // Daily = 5 workdays × 52 weeks = 260 periods/year
  // Weekly = 52, biweekly = 26, monthly = 12
  const periodsPerYear = freq === 'daily' ? 260 : freq === 'weekly' ? 52 : freq === 'biweekly' ? 26 : 12
  const annualizedAll = empsAll.reduce((s, e) => s + (e.daily_accrual || 0) * periodsPerYear, 0)
  const annualizedExcl = empsExcl.reduce((s, e) => s + (e.daily_accrual || 0) * periodsPerYear, 0)

  // Sparks given in period
  // For excl: exclude any transaction where either party is in the excluded set.
  // We use excludedEmpIds (derived from full employee records) — not the lean join
  // objects on transactions, which don't carry is_optional.
  const sparksGivenAll = filteredTxns.reduce((s, t) => s + (t.amount || 0), 0)
  const sparksGivenExcl = filteredTxns
    .filter(t => !excludedEmpIds.has(t.from_employee_id) && !excludedEmpIds.has(t.to_employee_id))
    .reduce((s, t) => s + (t.amount || 0), 0)

  // Allocated for period (not annualized — proportional to date range)
  const dayCount = Math.max(1, Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1)
  const workDays = Math.round(dayCount * 5 / 7)
  const periods = freq === 'daily' ? workDays : freq === 'weekly' ? Math.max(1, Math.round(dayCount / 7)) : freq === 'biweekly' ? Math.max(1, Math.round(dayCount / 14)) : Math.max(1, Math.round(dayCount / 30))

  const allocatedAll = empsAll.reduce((s, e) => s + (e.daily_accrual || 0) * periods, 0)
  const allocatedExcl = empsExcl.reduce((s, e) => s + (e.daily_accrual || 0) * periods, 0)

  // Utilization
  const utilAll = allocatedAll > 0 ? Math.round((sparksGivenAll / allocatedAll) * 100) : 0
  const utilExcl = allocatedExcl > 0 ? Math.round((sparksGivenExcl / allocatedExcl) * 100) : 0

  // By job title
  const byTitle = useMemo(() => {
    const map = {}
    filteredTxns.forEach(t => {
      const title = t.to_emp?.job_title || 'Unknown'
      map[title] = (map[title] || 0) + (t.amount || 0)
    })
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [filteredTxns])

  // Utilization by job title
  const utilByTitle = useMemo(() => {
    const accrMap = {}, givenMap = {}
    empsAll.forEach(e => { const t = e.job_title || 'Unknown'; accrMap[t] = (accrMap[t] || 0) + (e.daily_accrual || 0) * periods })
    filteredTxns.forEach(t => { const title = t.from_emp?.job_title || 'Unknown'; givenMap[title] = (givenMap[title] || 0) + (t.amount || 0) })
    return Object.keys(accrMap).map(label => ({
      label,
      value: accrMap[label] > 0 ? Math.round((givenMap[label] || 0) / accrMap[label] * 100) : 0
    })).sort((a, b) => b.value - a.value)
  }, [empsAll, filteredTxns, periods])

  // By team
  const byTeam = useMemo(() => {
    const visibleTeams = limitToTeamIds ? teams.filter(t => limitToTeamIds.includes(t.id)) : teams
    return visibleTeams.map(team => {
      const memberIds = new Set(teamMembers.filter(m => m.team_id === team.id).map(m => m.employee_id))
      const given = filteredTxns.filter(t => memberIds.has(t.to_employee_id)).reduce((s, t) => s + (t.amount || 0), 0)
      const allocated = filteredEmps.filter(e => memberIds.has(e.id)).reduce((s, e) => s + (e.daily_accrual || 0) * periods, 0)
      const util = allocated > 0 ? Math.round((given / allocated) * 100) : 0
      return { label: team.name, value: given, allocated, util }
    }).filter(t => t.allocated > 0 || t.value > 0).sort((a, b) => b.value - a.value)
  }, [teams, teamMembers, filteredTxns, filteredEmps, periods, limitToTeamIds])

  // Trend over time (group by week or day)
  const trendData = useMemo(() => {
    const buckets = {}
    filteredTxns.forEach(t => {
      const d = new Date(t.created_at)
      let key
      if (dayCount <= 14) key = d.toISOString().split('T')[0]
      else { const wk = new Date(d); wk.setDate(d.getDate() - d.getDay()); key = wk.toISOString().split('T')[0] }
      buckets[key] = (buckets[key] || 0) + (t.amount || 0)
    })
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
      label: new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: v
    }))
  }, [filteredTxns, dayCount])

  // Top givers / receivers
  const topGivers = useMemo(() => {
    const map = {}
    filteredTxns.forEach(t => {
      const key = t.from_employee_id
      if (!key) return
      if (!map[key]) map[key] = { name: t.from_emp ? `${t.from_emp.first_name} ${t.from_emp.last_name}` : 'Unknown', value: 0, title: t.from_emp?.job_title || '' }
      map[key].value += t.amount || 0
    })
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [filteredTxns])

  const topReceivers = useMemo(() => {
    const map = {}
    filteredTxns.forEach(t => {
      const key = t.to_employee_id
      if (!key) return
      if (!map[key]) map[key] = { name: t.to_emp ? `${t.to_emp.first_name} ${t.to_emp.last_name}` : 'Unknown', value: 0, title: t.to_emp?.job_title || '' }
      map[key].value += t.amount || 0
    })
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 8)
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

      {/* ── Annualized Totals ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <SectionHeader icon="📈" title="ANNUALIZED SPARK BUDGET"
          sub={showDollar
            ? `Based on ${freq} accrual × ${periodsPerYear} periods/year · $${sv}/spark`
            : `Based on ${freq} accrual × ${periodsPerYear} periods/year`} />
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
          {showDollar && <StatCard label="Annual Sparks (Incl Optional)" value={annualizedAll.toLocaleString()} color="var(--gold)" />}
          {showDollar && <StatCard label="Annual $ (Incl Optional)" value={`$${(annualizedAll * sv).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color="var(--gold)" />}
          <StatCard label={showDollar ? "Annual Sparks (Excl Optional)" : "Annual Sparks"} value={annualizedExcl.toLocaleString()} color="var(--green-bright)" />
          {showDollar && <StatCard label="Annual $ (Excl Optional)" value={`$${(annualizedExcl * sv).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color="var(--green-bright)" />}
        </div>
      </div>

      {/* ── Period Stats ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <SectionHeader icon="⚡" title="PERIOD ACTIVITY" sub={`${fmtDate(dateFrom)} – ${fmtDate(dateTo)} · ~${periods} ${freq} period${periods !== 1 ? 's' : ''}`} />

        {showDollar ? (
          /* Full view: two-column incl/excl PM4 split */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--gold)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '10px' }}>INCLUDING OPTIONAL</div>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', marginBottom: '14px' }}>
                <StatCard label="Allocated" value={allocatedAll} color="var(--white-soft)" />
                <StatCard label="Given" value={sparksGivenAll} color="var(--gold)" />
                <StatCard label="Remaining" value={Math.max(0, allocatedAll - sparksGivenAll)} color="var(--white-dim)" />
                <StatCard label="$ Spend" value={fmt$(sparksGivenAll, sparkValue)} color="var(--gold)" />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--green-bright)', fontFamily: 'var(--font-display)', letterSpacing: '0.07em', marginBottom: '10px' }}>EXCLUDING OPTIONAL</div>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', marginBottom: '14px' }}>
                <StatCard label="Allocated" value={allocatedExcl} color="var(--white-soft)" />
                <StatCard label="Given" value={sparksGivenExcl} color="var(--green-bright)" />
                <StatCard label="Remaining" value={Math.max(0, allocatedExcl - sparksGivenExcl)} color="var(--white-dim)" />
                <StatCard label="$ Spend" value={fmt$(sparksGivenExcl, sparkValue)} color="var(--green-bright)" />
              </div>
            </div>
          </div>
        ) : (
          /* Team / no-$ view: excl PM4/Owner numbers only, no label */
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', marginBottom: '14px' }}>
            <StatCard label="Allocated" value={allocatedExcl} color="var(--white-soft)" />
            <StatCard label="Given" value={sparksGivenExcl} color="var(--green-bright)" />
            <StatCard label="Remaining" value={Math.max(0, allocatedExcl - sparksGivenExcl)} color="var(--white-dim)" />
          </div>
        )}

        {/* Utilization Gauges */}
        <div style={{ display: 'flex', gap: '32px', justifyContent: 'center', flexWrap: 'wrap', padding: '16px 0 4px' }}>
          {showDollar && <UtilGauge used={sparksGivenAll} total={allocatedAll} label="Utilization (Incl Optional)" color="var(--gold)" />}
          <UtilGauge used={sparksGivenExcl} total={allocatedExcl} label={showDollar ? "Utilization (Excl Optional)" : "Utilization"} color="var(--green-bright)" />
          {byTeam.map(t => <UtilGauge key={t.label} used={t.value} total={t.allocated} label={t.label} color="#80c4ff" />)}
        </div>
      </div>

      {/* ── Trend Chart ── */}
      {trendData.length >= 2 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <SectionHeader icon="📉" title="SPARKS GIVEN OVER TIME" sub={dayCount <= 14 ? 'by day' : 'by week'} />
          <TrendChart data={trendData} />
        </div>
      )}

      {/* ── Charts Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* By Job Title — sparks given */}
        <div className="card">
          <SectionHeader icon="🧑‍🔧" title="SPARKS RECEIVED BY TITLE" />
          <BarChart data={byTitle} color="var(--gold)" showDollar={showDollar} sparkValue={sparkValue} />
        </div>

        {/* Utilization by Title */}
        <div className="card">
          <SectionHeader icon="📊" title="UTILIZATION BY TITLE" sub="% of allocated given" />
          <BarChart data={utilByTitle} color="#80c4ff" />
        </div>

        {/* By Team */}
        {byTeam.length > 0 && (
          <div className="card">
            <SectionHeader icon="👷" title="SPARKS BY TEAM" />
            <BarChart data={byTeam} color="var(--green-bright)" showDollar={showDollar} sparkValue={sparkValue} />
          </div>
        )}

        {/* Utilization by Team */}
        {byTeam.length > 0 && (
          <div className="card">
            <SectionHeader icon="📊" title="TEAM UTILIZATION %" sub="% of period allocation used" />
            <BarChart data={byTeam.map(t => ({ label: t.label, value: t.util }))} color="#c084fc" />
          </div>
        )}
      </div>

      {/* ── Company-wide Utilization ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <SectionHeader icon="🏢" title="COMPANY-WIDE UTILIZATION" sub={showDollar ? "All employees combined" : "Excludes optional employees"} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center' }}>
          {showDollar && <UtilGauge used={sparksGivenAll} total={allocatedAll} label={`Company (Incl Optional) · ${utilAll}%`} color="var(--gold)" />}
          <UtilGauge used={sparksGivenExcl} total={allocatedExcl} label={showDollar ? `Company (Excl Optional) · ${utilExcl}%` : `Company · ${utilExcl}%`} color="var(--green-bright)" />
          {showDollar && (
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)', marginBottom: '4px' }}>$ Spend (period, Incl Optional)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--gold)' }}>{fmt$(sparksGivenAll, sparkValue)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)', marginBottom: '4px' }}>$ Spend (period, Excl Optional)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--green-bright)' }}>{fmt$(sparksGivenExcl, sparkValue)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Top Givers / Receivers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div className="card">
          <SectionHeader icon="🎁" title="TOP GIVERS" />
          {topGivers.length === 0 ? <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem' }}>No data</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {topGivers.map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--white-dim)', width: '16px' }}>#{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{g.name}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)' }}>{g.title}</div>
                  </div>
                  <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.88rem' }}>✨ {g.value}</span>
                  {showDollar && <span style={{ color: 'var(--white-dim)', fontSize: '0.72rem' }}>{fmt$(g.value, sparkValue)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <SectionHeader icon="🏆" title="TOP RECEIVERS" />
          {topReceivers.length === 0 ? <div style={{ color: 'var(--white-dim)', fontSize: '0.8rem' }}>No data</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {topReceivers.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--white-dim)', width: '16px' }}>#{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--white-dim)' }}>{r.title}</div>
                  </div>
                  <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.88rem' }}>✨ {r.value}</span>
                  {showDollar && <span style={{ color: 'var(--white-dim)', fontSize: '0.72rem' }}>{fmt$(r.value, sparkValue)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
