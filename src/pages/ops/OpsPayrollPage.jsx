import { useMemo, useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData, computePayroll } from '../../hooks/useOpsData'
import { fmt } from '../../lib/opsFormat'

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
  const { payrollLines } = useOpsData()
  const [mode, setMode]     = useState('employee') // 'employee' | 'job'
  const [q, setQ]           = useState('')
  const [weekFilter, setWf] = useState('all')

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
