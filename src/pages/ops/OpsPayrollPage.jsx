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
  'regHrs','otHrs','sickHrs','vacHrs','holHrs','perDiem',
  'regPay','otPay','sickPay','vacPay','holPay','wages',
  'fica','futa','suta','wc','liability','retirement','health',
  'totalBurden','totalCost',
]

// Columns render left-to-right in this order.  `k` is the aggregated
// field key, `h` is the header label, `unit` controls formatting.
const COLUMNS = [
  { k:'regHrs',     h:'Reg hrs',   unit:'hrs' },
  { k:'otHrs',      h:'OT',        unit:'hrs' },
  { k:'sickHrs',    h:'Sick',      unit:'hrs' },
  { k:'vacHrs',     h:'Vac',       unit:'hrs' },
  { k:'holHrs',     h:'Hol',       unit:'hrs' },
  { k:'perDiem',    h:'Per diem',  unit:'$'   },
  { k:'wages',      h:'Gross wages', unit:'$' },
  { k:'fica',       h:'FICA',      unit:'$'   },
  { k:'futa',       h:'FUTA',      unit:'$'   },
  { k:'suta',       h:'SUTA',      unit:'$'   },
  { k:'wc',         h:'WC',        unit:'$'   },
  { k:'liability',  h:'GL',        unit:'$'   },
  { k:'retirement', h:'Retire',    unit:'$'   },
  { k:'health',     h:'Health',    unit:'$'   },
  { k:'totalBurden',h:'Burden tot',unit:'$'   },
  { k:'totalCost',  h:'True cost', unit:'$'   },
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
  const { payrollLines, jobs } = useOpsData()
  const [mode, setMode]     = useState('employee') // 'employee' | 'job'
  const [q, setQ]           = useState('')
  const [weekFilter, setWf] = useState('all')
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
  }, [payrollLines, contractJobNums, tsJob])

  const tsOpts = useMemo(() => moneyLineOpts(), [])

  const weeks = useMemo(
    () => Array.from(new Set(payrollLines.map((l) => l.week))).sort(),
    [payrollLines],
  )

  // Filter raw lines first — search is against employee name / trade
  // when in employee mode, or job # / job name when in job mode, so the
  // visible rows match the user's intent.
  const visibleLines = useMemo(() => {
    let rows = payrollLines
    if (weekFilter !== 'all') rows = rows.filter((l) => l.week === weekFilter)
    if (q.trim()) {
      const needle = q.toLowerCase()
      rows = rows.filter((l) => (
        mode === 'employee'
          ? (l.emp.toLowerCase().includes(needle) || l.trade.toLowerCase().includes(needle))
          : (l.job.toLowerCase().includes(needle) || l.jobName.toLowerCase().includes(needle))
      ))
    }
    return rows
  }, [payrollLines, weekFilter, q, mode])

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

  const primaryHeader = mode === 'employee' ? 'Employee' : 'Job'
  const secondaryHeader = mode === 'employee' ? 'Trade'    : 'Job name'

  return (
    <div>
      {/* Summary cards — quick read on total field cost + burden share. */}
      <div className="ops-grid-4">
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
        <OpsSectionCard title="Per diem">
          <div className="ops-kpi-value">{fmt(totals.perDiem)}</div>
          <div className="ops-small ops-text-dim">non-burdened, carried through as-is</div>
        </OpsSectionCard>
        <OpsSectionCard title="True labor cost">
          <div className="ops-kpi-value">{fmt(totals.totalCost)}</div>
          <div className="ops-small ops-text-dim">wages + burden + per diem</div>
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
        subtitle={`Aggregated by ${mode === 'employee' ? 'employee (grouping all jobs they worked)' : 'job (grouping all crew on that job)'}. Burden includes FICA, FUTA, SUTA, workers comp, liability, retirement match, health.`}
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle">
              <button onClick={() => setMode('employee')} className={mode === 'employee' ? 'active' : ''}>By employee</button>
              <button onClick={() => setMode('job')}      className={mode === 'job'      ? 'active' : ''}>By job</button>
            </div>
            <select className="ops-select" value={weekFilter} onChange={(e) => setWf(e.target.value)}>
              <option value="all">All weeks</option>
              {weeks.map((w) => <option key={w} value={w}>Wk ending {w}</option>)}
            </select>
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === 'employee' ? 'Search name or trade' : 'Search job # or name'}
              style={{ width: 220 }}
            />
          </div>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>{primaryHeader}</th>
                <th>{secondaryHeader}</th>
                {COLUMNS.map((c) => <th key={c.k} className="right">{c.h}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ fontWeight: 600 }}>{g.label}</td>
                  <td className="ops-text-dim">{g.sub}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.k} className="right">{fmtCell(g[c.k], c.unit)}</td>
                  ))}
                </tr>
              ))}
              {!groups.length && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                    No payroll rows match the current filters.
                  </td>
                </tr>
              )}
              {groups.length > 0 && (
                <tr style={{ borderTop: '2px solid var(--border-bright)', fontWeight: 700 }}>
                  <td>Total</td>
                  <td className="ops-text-dim">{groups.length} {mode === 'employee' ? 'people' : 'jobs'}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.k} className="right">{fmtCell(totals[c.k], c.unit)}</td>
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
