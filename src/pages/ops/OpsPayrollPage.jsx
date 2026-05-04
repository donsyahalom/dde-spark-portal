import { useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import { useOpsData, computePayroll } from '../../hooks/useOpsData'
import { fmt } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'

// Fields we sum when grouping.  Every numeric line comes through here
// so "by employee" and "by job" stay in sync — adding a new burden
// component only means: add it to computePayroll() + list it here.
const SUM_FIELDS = [
  'regHrs','otHrs','sickHrs','vacHrs','holHrs',
  'regPay','otPay','sickPay','vacPay','holPay','wages',
  'fica','futa','suta','wc','liability','retirement','health',
  'totalBurden','totalCost',
]

// COLUMNS_EMP: includes sick/vac/hol — employee view merges job-coded +
//              non-job time so all hour types roll up per employee.
// COLUMNS_JOB: reg + OT only — sick/vac/hol carry NULL job_recnum in Sage
//              (pay_type 4/5/6) so they cannot appear in a per-job breakdown.
//              They show in By Employee view via the (Non-Job) synthetic row.
const COLUMNS_BASE = [
  { k:'wages',      h:'Gross wages', unit:'$' },
  { k:'fica',       h:'FICA',        unit:'$' },
  { k:'futa',       h:'FUTA',        unit:'$' },
  { k:'suta',       h:'SUTA',        unit:'$' },
  { k:'wc',         h:'WC',          unit:'$' },
  { k:'liability',  h:'GL',          unit:'$' },
  { k:'retirement', h:'Retire',      unit:'$' },
  { k:'health',     h:'Health',      unit:'$' },
  { k:'totalBurden',h:'Burden tot',  unit:'$' },
  { k:'totalCost',  h:'True cost',   unit:'$' },
]

const COLUMNS_EMP = [
  { k:'regHrs',  h:'Reg hrs',  unit:'hrs' },
  { k:'otHrs',   h:'OT hrs',   unit:'hrs' },
  { k:'sickHrs', h:'Sick hrs', unit:'hrs' },
  { k:'vacHrs',  h:'Vac hrs',  unit:'hrs' },
  { k:'holHrs',  h:'Hol hrs',  unit:'hrs' },
  ...COLUMNS_BASE,
]

const COLUMNS_JOB = [
  { k:'regHrs', h:'Reg hrs', unit:'hrs' },
  { k:'otHrs',  h:'OT hrs',  unit:'hrs' },
  ...COLUMNS_BASE,
]

function emptyTotals() {
  const o = {}
  SUM_FIELDS.forEach((f) => (o[f] = 0))
  return o
}

function addInto(target, row) {
  SUM_FIELDS.forEach((f) => (target[f] += row[f] || 0))
}

// Aggregate payroll lines by the provided `keyFn` which returns a
// string group key — e.g. row.emp for by-employee, row.job for by-job.
// Returns an ordered array of groups with stable metadata + summed
// SUM_FIELDS.  Unknown/empty keys are grouped as "—".
function aggregate(lines, keyFn, labelFn) {
  const map = new Map()
  for (const raw of lines) {
    const line = computePayroll(raw)
    const key  = keyFn(line) || '—'
    if (!map.has(key)) {
      map.set(key, { key, label: labelFn(line), sub: '', ...emptyTotals(), lines: [] })
    }
    const grp = map.get(key)
    addInto(grp, line)
    grp.lines.push(line)
  }
  // Fill `sub` — for employees this is the (first) trade; for jobs it's
  // the job name.  Derived once all lines are collected.
  for (const grp of map.values()) {
    grp.sub = grp.lines[0]?.trade || grp.lines[0]?.jobName || ''
  }
  return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost)
}

function fmtCell(val, unit) {
  if (unit === 'hrs') return val ? val.toFixed(0) : '—'
  if (unit === '$')   return val ? fmt(val) : '—'
  return String(val)
}

export default function OpsPayrollPage() {
  const { payrollLines, jobs, loading: _opsLoading } = useOpsData()
  const [mode, setMode] = useState('employee') // 'employee' | 'job'
  const [q, setQ]       = useState('')

  // Date range — defaults to YTD (Jan 1 current year → today)
  const today    = new Date()
  const thisYear = today.getFullYear()
  const ytdFrom  = `${thisYear}-01-01`
  const ytdTo    = today.toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(ytdFrom)
  const [dateTo,   setDateTo]   = useState(ytdTo)
  const isYtd = dateFrom === ytdFrom && dateTo === ytdTo
  // Time-series viz — which contract job to slice by ("all" aggregates
  // across every contract job in view).
  const [tsJob, setTsJob]   = useState('all')

  // Set of contract-job numbers — used to filter non-reg payroll dollars
  // into the time-series chart.  Service jobs are excluded because the
  // user asked specifically for contract-job curves.
  const contractJobNums = useMemo(() => {
    return new Set(jobs.filter((j) => j.type === 'contract').map((j) => j.num))
  }, [jobs])

  // Job option list for the selector — only contract jobs that actually
  // appear in payroll data this period.
  const contractJobOptions = useMemo(() => {
    const seen = new Map()
    for (const l of payrollLines) {
      if (!contractJobNums.has(l.job)) continue
      if (!seen.has(l.job)) seen.set(l.job, l.jobName)
    }
    return Array.from(seen.entries()).map(([num, name]) => ({ num, name }))
  }, [payrollLines, contractJobNums])

  // Build the weekly rollup of non-regular payroll $ for the chart.
  // Series: OT / Sick / Vacation / Holiday (all in wage dollars).
  // Regular pay is explicitly excluded per the product request — this
  // chart is about exception / leave spending patterns.
  const tsData = useMemo(() => {
    const byWeek = new Map() // week → {ot, sick, vac, hol}
    for (const raw of payrollLines) {
      if (!contractJobNums.has(raw.job)) continue
      if (raw.week < dateFrom || raw.week > dateTo) continue
      if (tsJob !== 'all' && raw.job !== tsJob) continue
      const p = computePayroll(raw)
      if (!byWeek.has(p.week)) byWeek.set(p.week, { ot: 0, sick: 0, vac: 0, hol: 0 })
      const w = byWeek.get(p.week)
      w.ot   += p.otPay
      w.sick += p.sickPay
      w.vac  += p.vacPay
      w.hol  += p.holPay
    }
    const weeks = Array.from(byWeek.keys()).sort()
    return {
      labels: weeks,
      datasets: [
        { label: 'OT $',       data: weeks.map((w) => Math.round(byWeek.get(w).ot)),
          borderColor: PALETTE.red,    backgroundColor: 'rgba(224,85,85,0.10)',
          fill: false, tension: 0.3, borderWidth: 2 },
        { label: 'Sick $',     data: weeks.map((w) => Math.round(byWeek.get(w).sick)),
          borderColor: PALETTE.amber,  backgroundColor: 'transparent',
          fill: false, tension: 0.3, borderWidth: 2 },
        { label: 'Vacation $', data: weeks.map((w) => Math.round(byWeek.get(w).vac)),
          borderColor: PALETTE.blue,   backgroundColor: 'transparent',
          fill: false, tension: 0.3, borderWidth: 2 },
        { label: 'Holiday $',  data: weeks.map((w) => Math.round(byWeek.get(w).hol)),
          borderColor: PALETTE.gold,   backgroundColor: 'transparent',
          fill: false, tension: 0.3, borderWidth: 2 },
      ],
    }
  }, [payrollLines, contractJobNums, tsJob, dateFrom, dateTo])

  const tsOpts = useMemo(() => moneyLineOpts(), [])

  // Filter raw lines first — search is against employee name / trade
  // when in employee mode, or job # / job name when in job mode, so the
  // visible rows match the user's intent.
  const visibleLines = useMemo(() => {
    let rows = payrollLines
    // Date filter: include weeks whose week-ending date falls within the range
    rows = rows.filter((l) => l.week >= dateFrom && l.week <= dateTo)
    if (q.trim()) {
      const needle = q.toLowerCase()
      rows = rows.filter((l) => (
        mode === 'employee'
          ? ((l.emp || '').toLowerCase().includes(needle) || (l.trade || '').toLowerCase().includes(needle))
          : ((l.job || '').toLowerCase().includes(needle) || (l.jobName || '').toLowerCase().includes(needle))
      ))
    }
    return rows
  }, [payrollLines, dateFrom, dateTo, q, mode])

  const groups = useMemo(() => {
    return mode === 'employee'
      ? aggregate(visibleLines, (l) => l.emp, (l) => l.emp)
      : aggregate(visibleLines, (l) => l.job, (l) => `${l.job} — ${l.jobName}`)
  }, [visibleLines, mode])

  const totals = useMemo(() => {
    const t = emptyTotals()
    groups.forEach((g) => addInto(t, g))
    return t
  }, [groups])

  // Single identity column — employee name or job name (no secondary column)
  const primaryHeader = mode === 'employee' ? 'Employee' : 'Job'
  const COLUMNS       = mode === 'employee' ? COLUMNS_EMP : COLUMNS_JOB


  if (_opsLoading) return <div style={{ padding: '40px 20px', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', textAlign: 'center' }}>Loading data…</div>

  return (
    <div>
      {/* Date range filter bar */}
      <div className="ops-filter-bar" style={{ marginBottom: 16 }}>
        <span className="ops-small" style={{ color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {isYtd ? 'YTD Filter' : 'Date Range Filter'}
        </span>
        <span className="ops-small ops-text-dim">based on week-ending date</span>
        <input type="date" className="ops-input" value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ width: 148 }} />
        <span className="ops-small ops-text-dim">→</span>
        <input type="date" className="ops-input" value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{ width: 148 }} />
        <button className="ops-btn ghost" style={{ fontSize: '0.78rem', padding: '3px 10px' }}
          onClick={() => { setDateFrom(ytdFrom); setDateTo(ytdTo) }}
          title="Reset to Year-to-Date">↺ YTD</button>
        <span className="ops-small ops-text-dim">
          {visibleLines.length} rows in range
        </span>
      </div>

      {/* Summary cards — quick read on total field cost + burden share. */}
      <div className="ops-grid-3">
        <OpsSectionCard title="Gross wages">
          <div className="ops-kpi-value">{fmt(totals.wages)}</div>
          <div className="ops-small ops-text-dim">
            {totals.regHrs.toFixed(0)} reg · {totals.otHrs.toFixed(0)} OT · {(totals.sickHrs + totals.vacHrs + totals.holHrs).toFixed(0)} paid leave
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Burden total">
          <div className="ops-kpi-value">{fmt(totals.totalBurden)}</div>
          <div className="ops-small ops-text-dim">
            {totals.wages ? ((totals.totalBurden / totals.wages) * 100).toFixed(1) : 0}% on wages
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="True labor cost">
          <div className="ops-kpi-value">{fmt(totals.totalCost)}</div>
          <div className="ops-small ops-text-dim">wages + burden</div>
        </OpsSectionCard>
      </div>

      {/* ── Non-regular payroll $ over time — by contract job ────── */}
      <OpsSectionCard
        title="Non-regular payroll $ over time"
        subtitle="OT, Sick, Vacation and Holiday wage dollars by week. Regular pay excluded so exception-spending patterns stand out. Scoped to contract jobs."
        right={
          <select
            className="ops-select"
            value={tsJob}
            onChange={(e) => setTsJob(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="all">All contract jobs</option>
            {contractJobOptions.map((j) => (
              <option key={j.num} value={j.num}>{j.num} — {j.name}</option>
            ))}
          </select>
        }
      >
        {tsData.labels.length === 0 ? (
          <div className="ops-small ops-text-dim" style={{ padding: '12px 0' }}>
            No contract-job payroll data for the current selection.
          </div>
        ) : (
          <OpsChartBox size="lg">
            <Line data={tsData} options={tsOpts} />
          </OpsChartBox>
        )}
      </OpsSectionCard>

      <OpsSectionCard
        title="Payroll register"
        subtitle={mode === 'employee'
          ? 'By employee — includes job-coded time plus sick/vac/holiday via Non-Job row. Burden = FICA, FUTA, SUTA, WC, GL, retirement, health.'
          : 'By job — reg and OT only. Sick/vacation/holiday carry no job code in Sage so they only appear in the By Employee view.'}
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle">
              <button onClick={() => setMode('employee')} className={mode === 'employee' ? 'active' : ''}>By employee</button>
              <button onClick={() => setMode('job')}      className={mode === 'job'      ? 'active' : ''}>By job</button>
            </div>
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === 'employee' ? 'Search name or trade' : 'Search job # or name'}
              style={{ width: 200 }}
            />
          </div>
        }
      >
        {/* Top mirror scrollbar */}
        <div
          id="pr-top-scroll"
          style={{ overflowX: 'auto', height: 16, marginBottom: 2 }}
          onScroll={(e) => {
            const main = document.getElementById('pr-main-scroll')
            if (main) main.scrollLeft = e.target.scrollLeft
          }}
        >
          <div id="pr-top-inner" style={{ height: 1 }} />
        </div>
        <div
          id="pr-main-scroll"
          style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '72vh' }}
          onScroll={(e) => {
            const top = document.getElementById('pr-top-scroll')
            if (top) top.scrollLeft = e.target.scrollLeft
            const inner = document.getElementById('pr-top-inner')
            if (inner) inner.style.width = e.target.scrollWidth + 'px'
          }}
        >
          <table
            className="ops-table"
            style={{ width: 'max-content', minWidth: '100%' }}
            ref={(el) => {
              if (el) {
                const inner = document.getElementById('pr-top-inner')
                if (inner) inner.style.width = el.scrollWidth + 'px'
              }
            }}
          >
            <thead>
              <tr>
                <th style={{
                  position: 'sticky', top: 0, left: 0, zIndex: 4,
                  background: 'rgba(18,22,28,0.98)',
                  boxShadow: '0 1px 0 rgba(240,192,64,0.2)',
                }}>{primaryHeader}</th>
                {COLUMNS.map((c) => (
                  <th key={c.k} className="right" style={{
                    position: 'sticky', top: 0, zIndex: 3,
                    background: 'rgba(18,22,28,0.98)',
                    boxShadow: '0 1px 0 rgba(240,192,64,0.2)',
                    whiteSpace: 'nowrap',
                  }}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td style={{
                    fontWeight: 600, position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--bg-card)', whiteSpace: 'nowrap',
                    maxWidth: 240,
                  }}>{g.label}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.k} className="right" style={{ whiteSpace: 'nowrap' }}>{fmtCell(g[c.k], c.unit)}</td>
                  ))}
                </tr>
              ))}
              {!groups.length && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                    No payroll rows match the current filters.
                  </td>
                </tr>
              )}
              {groups.length > 0 && (
                <tr style={{ borderTop: '2px solid var(--border-bright)', fontWeight: 700 }}>
                  <td style={{
                    position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--bg-card)', whiteSpace: 'nowrap',
                  }}>Total — {groups.length} {mode === 'employee' ? 'people' : 'jobs'}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.k} className="right" style={{ whiteSpace: 'nowrap' }}>{fmtCell(totals[c.k], c.unit)}</td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </OpsSectionCard>
    </div>
  )
}
