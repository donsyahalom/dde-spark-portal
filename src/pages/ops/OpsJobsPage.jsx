import { useMemo, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import {
  useOpsData,
  buildWeekly,
  jobProductivity,
  companyProductivity,
} from '../../hooks/useOpsData'
import { useOpsViewState } from '../../context/OpsViewStateContext'
import { fmt, fmtK, pct } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'

// ─────────────────────────────────────────────────────────────────────
// UAT / mock fallback dates keyed by job number.
// Live data: ops.jobs view now exposes startDate and completeDate
// (sourced from sage.jobs.start_date / actual_start_date /
//  complete_date / actual_complete_date).  These mock dates are only
// used when a job has no date fields — i.e. on UAT with fixture data.
// ─────────────────────────────────────────────────────────────────────
const JOB_DATES_FALLBACK = {
  '2430':      { start: '2024-03-01', end: '2026-09-30' },
  '2512':      { start: '2024-07-15', end: '2026-12-31' },
  '2544':      { start: '2024-09-01', end: '2027-06-30' },
  '2580':      { start: '2025-01-10', end: '2026-08-31' },
  '2601':      { start: '2025-06-01', end: '2027-03-31' },
  '2622':      { start: '2026-01-15', end: '2028-06-30' },
  'SV-DDE-01': { start: '2024-01-01', end: null },
  'SV-DDE-02': { start: '2023-10-01', end: null },
  'D101':      { start: '2024-05-01', end: '2026-11-30' },
  'D118':      { start: '2024-08-01', end: '2026-07-31' },
  'D132':      { start: '2025-02-01', end: '2027-01-31' },
  'SV-DCM-01': { start: '2024-01-01', end: null },
  'S204':      { start: '2024-11-01', end: '2026-06-30' },
  'S212':      { start: '2025-03-01', end: '2026-10-31' },
  'SV-SILK-01':{ start: '2023-06-01', end: null },
}

// ─────────────────────────────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────────────────────────────
const CONTRACT_COLUMNS = [
  { key: 'num',          label: 'Job #',        type: 'str',
    tooltip: 'Sage short_name for the job.' },
  { key: 'name',         label: 'Name',         type: 'str',
    tooltip: 'Sage job name.' },
  { key: 'customer',     label: 'Customer',     type: 'str',
    tooltip: 'Client / owner on record.' },
  { key: 'contract',     label: 'Contract',     type: 'money', align: 'right',
    tooltip: 'Original contract amount (does not include COs unless booked).' },
  { key: 'revenue',      label: 'Revenue',      type: 'money', align: 'right',
    tooltip: 'Sum of all AR invoice totals booked to this job (billed-to-date).' },
  { key: 'directCost',   label: 'Direct Cost',  type: 'money', align: 'right',
    tooltip: 'Labor + Material + Subs + Equipment + Bonds + Permits + Other. Hover for breakdown.' },
  { key: 'gpDol',        label: 'GP $',         type: 'money', align: 'right',
    tooltip: 'Gross Profit = Revenue − Direct Cost.' },
  { key: 'gpPct',        label: 'GP %',         type: 'pct',   align: 'right',
    tooltip: 'Gross Profit % = (GP $ ÷ Revenue) × 100.' },
  { key: 'pctCmp',       label: '% Cmp',        type: 'pct',   align: 'right',
    tooltip: 'PM override if set, otherwise (cost-to-date ÷ budget) × 100.' },
  { key: 'productivity', label: 'Productivity', type: 'prod',  align: 'right',
    tooltip: 'Earned-value productivity = (budget hrs × % complete) ÷ actual hrs. 1.00 = on plan.' },
  { key: 'status',       label: 'Status',       type: 'str',
    tooltip: 'Active, On Hold, or Closed.' },
]

const SERVICE_COLUMNS = [
  { key: 'num',       label: 'Job #',       type: 'str' },
  { key: 'name',      label: 'Name',        type: 'str' },
  { key: 'customer',  label: 'Customer',    type: 'str' },
  { key: 'revenue',   label: 'T&M Revenue', type: 'money', align: 'right',
    tooltip: 'Sum of all SR invoice totals billed to date.' },
  { key: 'directCost',label: 'Direct Cost', type: 'money', align: 'right',
    tooltip: 'Direct cost buckets. Hover for breakdown + top 10 WOs.' },
  { key: 'hours',     label: 'Hours',       type: 'hrs',   align: 'right',
    tooltip: 'Total hours from all work orders.' },
  { key: 'avgRate',   label: 'Avg $/hr',    type: 'money', align: 'right',
    tooltip: 'Total billed ÷ total hours across all WOs.' },
  { key: 'openWos',   label: 'Open WOs',    type: 'num',   align: 'right',
    tooltip: 'Work orders with status = open.' },
  { key: 'status',    label: 'Status',      type: 'str' },
]

const COST_BUCKETS = [
  { key: 'labor',     label: 'Labor',     color: PALETTE.blue },
  { key: 'material',  label: 'Material',  color: PALETTE.amber },
  { key: 'subs',      label: 'Subs',      color: PALETTE.red },
  { key: 'equipment', label: 'Equipment', color: PALETTE.purple },
  { key: 'bonds',     label: 'Bonds',     color: PALETTE.green },
  { key: 'permits',   label: 'Permits',   color: '#E879F9' },
  { key: 'other',     label: 'Other',     color: 'rgba(255,255,255,0.45)' },
]

// ─────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────
function fmtProductivity(p) {
  if (p == null) return '—'
  const cls = p >= 1 ? 'ops-text-pos' : p >= 0.9 ? '' : 'ops-text-neg'
  return <span className={cls}>{p.toFixed(2)}</span>
}

function prodColor(p) {
  return p == null ? 'var(--white)'
    : p >= 1.0 ? 'var(--pos)'
    : p >= 0.9 ? 'var(--gold)'
    : 'var(--neg)'
}

function serviceProductivity(serviceJobs, workOrders) {
  const svcNums = new Set(serviceJobs.map((j) => j.num))
  const rev = serviceJobs.reduce((s, j) => s + j.revenue, 0)
  const hrs = workOrders.filter((w) => svcNums.has(w.jobNum)).reduce((s, w) => s + w.hours, 0)
  return {
    revenue: rev,
    hours: hrs,
    revenuePerHour: hrs ? +(rev / hrs).toFixed(2) : null,
    jobCount: serviceJobs.length,
  }
}

function runSum(arr) {
  let s = 0
  return arr.map((v) => (s += v))
}

// ─────────────────────────────────────────────────────────────────────
// Sortable column header
// ─────────────────────────────────────────────────────────────────────
function ColumnHeader({ col, sortKey, sortDir, onSort }) {
  const active = sortKey === col.key
  const arrow  = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  return (
    <th
      onClick={() => onSort(col.key)}
      className={col.align === 'right' ? 'right' : ''}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        background: active ? 'rgba(240,192,64,0.08)' : undefined,
      }}
      title={col.tooltip || ''}
    >
      {col.label}
      {col.tooltip && (
        <span
          style={{ display: 'inline-block', marginLeft: 3, fontSize: '0.75em', opacity: 0.5, cursor: 'help' }}
          title={col.tooltip}
        >ⓘ</span>
      )}
      <span style={{ marginLeft: 3, color: active ? 'var(--gold)' : 'transparent', fontSize: '0.7em' }}>
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
      </span>
    </th>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Direct-cost hover tooltip — shared by contract AND service rows.
// Shows bucket breakdown + top-10 cost line items.
// For contract jobs the "top 10 items" are the cost buckets sorted by $.
// For service jobs the top 10 are work orders sorted by billed $.
// ─────────────────────────────────────────────────────────────────────
function DirectCostCell({ job, workOrders, isService }) {
  const [open, setOpen] = useState(false)
  const costTot = job.directCost || 0

  // Contract: top-10 items = buckets sorted desc
  // Service:  top-10 items = work orders sorted by billed desc
  const top10 = useMemo(() => {
    if (isService) {
      return (workOrders || [])
        .filter((w) => w.jobNum === job.num)
        .sort((a, b) => b.billed - a.billed)
        .slice(0, 10)
    }
    // For contract, the "items" are the cost buckets
    return COST_BUCKETS
      .map((b) => ({ ...b, amount: job[b.key] || 0 }))
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }, [isService, workOrders, job])

  const allWos = isService ? (workOrders || []).filter((w) => w.jobNum === job.num) : []

  if (!costTot) {
    return <td className="right ops-text-dim">—</td>
  }

  return (
    <td
      className="right"
      style={{ position: 'relative', cursor: 'help', fontWeight: 600 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {fmt(costTot)}
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 80,
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 340,
            maxWidth: 440,
            background: '#16191f',
            border: '1px solid rgba(240,192,64,0.3)',
            borderRadius: 8,
            padding: '10px 12px',
            boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
            textAlign: 'left',
            fontWeight: 400,
            fontSize: '0.78rem',
            color: 'var(--white)',
            pointerEvents: 'none',
          }}
        >
          {/* ── Cost buckets ── */}
          <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 5, letterSpacing: '0.06em', fontSize: '0.7rem' }}>
            DIRECT COST BREAKDOWN
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <tbody>
              {COST_BUCKETS.filter((b) => (job[b.key] || 0) > 0).map((b) => (
                <tr key={b.key}>
                  <td style={{ padding: '1px 3px' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: b.color, borderRadius: 2, marginRight: 5 }} />
                    {b.label}
                  </td>
                  <td style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 600 }}>{fmt(job[b.key] || 0)}</td>
                  <td style={{ textAlign: 'right', padding: '1px 3px', color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem' }}>
                    {pct(((job[b.key] || 0) / costTot) * 100, 0)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid rgba(255,255,255,0.15)', fontWeight: 700 }}>
                <td style={{ padding: '3px 3px' }}>Total</td>
                <td style={{ textAlign: 'right', padding: '3px 3px' }}>{fmt(costTot)}</td>
                <td style={{ textAlign: 'right', padding: '3px 3px', color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem' }}>100%</td>
              </tr>
            </tbody>
          </table>

          {/* ── Top 10 items ── */}
          {isService && top10.length > 0 && (
            <>
              <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 5, marginTop: 4, letterSpacing: '0.06em', fontSize: '0.7rem' }}>
                TOP {top10.length} WORK ORDERS BY BILLED
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '1px 3px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.7rem' }}>WO #</th>
                    <th style={{ textAlign: 'left', padding: '1px 3px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.7rem' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '1px 3px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.7rem' }}>Billed</th>
                    <th style={{ textAlign: 'right', padding: '1px 3px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.7rem' }}>Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((w, i) => (
                    <tr key={w.wo} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ padding: '2px 3px', color: 'rgba(255,255,255,0.5)' }}>{w.wo}</td>
                      <td style={{ padding: '2px 3px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description || '—'}</td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>{fmt(w.billed)}</td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', color: 'rgba(255,255,255,0.5)' }}>{w.hours}</td>
                    </tr>
                  ))}
                  {allWos.length > 10 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '3px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', fontSize: '0.7rem' }}>
                        + {allWos.length - 10} more — expand row for full list
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {/* Contract: top buckets already shown above; show top-10 PO-style cost items */}
          {!isService && (
            <>
              <div style={{ color: 'var(--gold)', fontWeight: 700, marginTop: 6, marginBottom: 5, letterSpacing: '0.06em', fontSize: '0.7rem' }}>
                TOP COST ITEMS (BUCKETS)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {top10.map((b, i) => (
                    <tr key={b.key} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ padding: '2px 3px' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, background: b.color, borderRadius: 2, marginRight: 5 }} />
                        <span style={{ fontWeight: 600 }}>#{i + 1}</span> {b.label}
                      </td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 700 }}>{fmt(b.amount)}</td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>
                        {pct((b.amount / costTot) * 100, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 5, fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
                Expand row to see cost chart, POs, weekly curve & retainage
              </div>
            </>
          )}
        </div>
      )}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Job-type reclassification control
// ─────────────────────────────────────────────────────────────────────
function JobTypeToggle({ job, currentType, onToggle }) {
  const target = currentType === 'contract' ? 'service' : 'contract'
  const isOverridden = !!job._typeOverridden
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      <span className="ops-small ops-text-dim">Classified as:</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700,
        background: currentType === 'contract' ? 'rgba(111,168,255,0.15)' : 'rgba(240,192,64,0.15)',
        border: `1px solid ${currentType === 'contract' ? 'rgba(111,168,255,0.4)' : 'rgba(240,192,64,0.4)'}`,
        color: currentType === 'contract' ? PALETTE.blue : PALETTE.amber,
      }}>
        {currentType === 'contract' ? 'Contract' : 'Service'}
        {isOverridden && <span style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 400 }}>(overridden)</span>}
      </span>
      <button
        className="ops-btn ghost"
        style={{ padding: '3px 10px', fontSize: '0.78rem' }}
        onClick={(e) => { e.stopPropagation(); onToggle(job.num, target) }}
        title={`Move to ${target} — updates Jobs P&L and A/R reports`}
      >
        → Move to {target === 'contract' ? 'Contract' : 'Service'}
      </button>
      {isOverridden && (
        <button
          className="ops-btn ghost"
          style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.65 }}
          onClick={(e) => { e.stopPropagation(); onToggle(job.num, job.type === 'contract' ? 'service' : 'contract') }}
          title="Restore original Sage classification"
        >↺ Reset</button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Contract job row — expand panel with chart, buckets, POs, retainage
// NOTE: No hooks after conditional returns — all hooks are at the top.
// ─────────────────────────────────────────────────────────────────────
function ContractJobRow({ job, purchaseOrders, workOrders, expanded, onToggle, fmtCell, columns, mode, onReclassify }) {
  // ALL hooks first — before any conditional returns
  const costTot = job.directCost || 0
  const weekly  = useMemo(() => buildWeekly(job.revenue || 0, costTot), [job.revenue, costTot])
  const series  = useMemo(() => {
    if (mode === 'accumulated') {
      return { revenue: runSum(weekly.revenue), cogs: runSum(weekly.cogs), gp: runSum(weekly.gp) }
    }
    return { revenue: weekly.revenue, cogs: weekly.cogs, gp: weekly.gp }
  }, [weekly, mode])
  const { productivity, earnedHrs } = useMemo(() => jobProductivity(job), [job])

  const lineData = useMemo(() => ({
    labels: weekly.labels,
    datasets: [
      { label: 'Revenue',     data: series.revenue, borderColor: PALETTE.blue,  backgroundColor: 'rgba(111,168,255,0.10)', fill: true, tension: 0.3, borderWidth: 2 },
      { label: 'Direct Cost', data: series.cogs,    borderColor: PALETTE.red,   backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'GP',          data: series.gp,      borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
    ],
  }), [series, weekly.labels])

  const bucketValues = useMemo(() => COST_BUCKETS.map((b) => job[b.key] || 0), [job])
  const bucketData   = useMemo(() => ({
    labels: COST_BUCKETS.map((b) => b.label),
    datasets: [{ label: 'Direct cost ($)', data: bucketValues, backgroundColor: COST_BUCKETS.map((b) => b.color), borderWidth: 0 }],
  }), [bucketValues])

  const bucketOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed.y)} (${pct(costTot ? (ctx.parsed.y / costTot) * 100 : 0, 0)})` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.82)', font: { size: 10 } } },
      y: { grid: { color: 'rgba(240,192,64,0.14)' }, ticks: { color: 'rgba(255,255,255,0.82)', font: { size: 10 }, callback: (v) => fmtK(Number(v)) } },
    },
  }), [costTot])

  const jobPOs = useMemo(() => purchaseOrders.filter((p) => p.jobNum === job.num), [purchaseOrders, job.num])
  const poBilledTot      = useMemo(() => jobPOs.reduce((s, p) => s + p.billed, 0), [jobPOs])
  const poOutstandingTot = useMemo(() => jobPOs.reduce((s, p) => s + (p.amount - p.billed), 0), [jobPOs])

  // Now safe to do conditional rendering (no hooks after this point)
  if (job.isRollup) {
    const chipCls2 = 'active'
    return (
      <tr style={{ fontStyle: 'italic', borderTop: '1px dashed var(--border-bright)' }}>
        <td style={{ width: 28 }}></td>
        {columns.map((c) => (
          <td key={c.key} className={c.align === 'right' ? 'right' : ''} style={{ whiteSpace: 'nowrap' }}>
            {c.key === 'status' ? <span className={`chip ${chipCls2}`}>T&amp;M</span> : fmtCell(job, c)}
          </td>
        ))}
      </tr>
    )
  }

  const chipCls = job.status === 'Closed' ? 'closed' : job.status === 'Hold' ? 'hold' : 'active'
  const dates   = job.startDate || job.completeDate
    ? { start: job.startDate, end: job.completeDate }
    : JOB_DATES_FALLBACK[job.num] || null

  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 28, textAlign: 'center' }}>{expanded ? '▾' : '▸'}</td>
        {columns.map((c) => {
          if (c.key === 'directCost') {
            return <DirectCostCell key="dc" job={job} workOrders={workOrders} isService={false} />
          }
          return (
            <td key={c.key} className={c.align === 'right' ? 'right' : ''} style={{ whiteSpace: c.type === 'str' ? 'normal' : 'nowrap' }}>
              {c.key === 'status' ? <span className={`chip ${chipCls}`}>{job.status}</span> : fmtCell(job, c)}
            </td>
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="ops-row-expand">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--white)' }}>{job.name}</div>
                <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                  Rev {fmtK(job.revenue)} · Direct Cost {fmtK(costTot)} · GP {fmtK(job.revenue - costTot)} ({pct(job.gpPct, 1)})
                  {dates && <> · <span>{dates.start} → {dates.end || 'ongoing'}</span></>}
                </div>
                <JobTypeToggle job={job} currentType={job.type} onToggle={onReclassify} />
              </div>
              <div className="ops-small ops-text-dim" style={{ textAlign: 'right' }}>
                <div>Budget: {job.budgetLaborHrs?.toLocaleString()} hrs · Actual: {job.actualLaborHrs?.toLocaleString()} hrs</div>
                <div>Earned: {Math.round(earnedHrs).toLocaleString()} hrs · Productivity: {productivity == null ? '—' : productivity.toFixed(2)}</div>
              </div>
            </div>

            {/* Cost breakdown + chart */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Direct cost breakdown</div>
                <OpsChartBox size="sm"><Bar data={bucketData} options={bucketOpts} /></OpsChartBox>
              </div>
              <div>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Buckets ($)</div>
                <table className="ops-table" style={{ fontSize: '0.8rem' }}>
                  <tbody>
                    {COST_BUCKETS.map((b, i) => (
                      <tr key={b.key}>
                        <td><span style={{ display: 'inline-block', width: 10, height: 10, background: b.color, borderRadius: 2, marginRight: 6 }} />{b.label}</td>
                        <td className="right">{fmt(bucketValues[i])}</td>
                        <td className="right ops-text-dim">{costTot ? pct((bucketValues[i] / costTot) * 100, 0) : '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid var(--border-bright)', fontWeight: 700 }}>
                      <td>Direct Cost</td>
                      <td className="right">{fmt(costTot)}</td>
                      <td className="right ops-text-dim">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Weekly curve */}
            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>
                Weekly curve <span className="ops-text-dim" style={{ fontWeight: 400 }}>({mode === 'accumulated' ? 'accumulated' : 'actual'})</span>
              </div>
              <OpsChartBox size="md"><Line data={lineData} options={moneyLineOpts()} /></OpsChartBox>
            </div>

            {/* POs */}
            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>
                Purchase orders
              </div>
              {jobPOs.length === 0 ? (
                <div className="ops-small ops-text-dim">No POs on file.</div>
              ) : (
                <table className="ops-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>PO #</th><th>Vendor</th><th>Description</th>
                      <th className="right">Amount</th><th className="right">Billed</th>
                      <th className="right">Outstanding</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobPOs.map((p) => {
                      const out = p.amount - p.billed
                      return (
                        <tr key={p.po}>
                          <td>{p.po}</td><td>{p.vendor}</td><td className="ops-text-dim">{p.desc}</td>
                          <td className="right">{fmt(p.amount)}</td>
                          <td className="right">{fmt(p.billed)}</td>
                          <td className={`right ${out > 0 ? 'ops-text-neg' : ''}`}>{fmt(out)}</td>
                          <td><span className={`chip ${p.status === 'closed' ? 'closed' : 'active'}`}>{p.status}</span></td>
                        </tr>
                      )
                    })}
                    <tr style={{ borderTop: '1px solid var(--border-bright)', fontWeight: 700 }}>
                      <td colSpan={3}>Total</td>
                      <td className="right">{fmt(jobPOs.reduce((s, p) => s + p.amount, 0))}</td>
                      <td className="right">{fmt(poBilledTot)}</td>
                      <td className="right ops-text-neg">{fmt(poOutstandingTot)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Retainage */}
            <div>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 6 }}>Retainage</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                {[
                  ['Contract retention rate', pct(job.retainagePct, 0)],
                  ['Contracted retention $', fmt(job.contractedRetention)],
                  ['Held to date', fmt(job.retainageHeld || 0)],
                  ['% complete', pct(job.pctCmp, 0)],
                ].map(([label, val]) => (
                  <div key={label} className="ops-stat-box">
                    <div className="ops-small ops-text-dim">{label}</div>
                    <div style={{ fontWeight: 700, color: 'var(--white)' }}>{val}</div>
                  </div>
                ))}
              </div>
              {job.releaseSchedule?.length > 0 && (
                <table className="ops-table" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Trigger (% cmp)</th><th className="right">Release %</th><th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.releaseSchedule.map((r) => {
                      const hit = job.pctCmp >= r.atPctCmp
                      return (
                        <tr key={r.atPctCmp}>
                          <td>{r.atPctCmp}%</td>
                          <td className="right">{r.releasePct}%</td>
                          <td className={hit ? 'ops-text-pos' : 'ops-text-dim'}>
                            {hit ? '✓ eligible · ' : '◦ pending · '}{r.note}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Service job row
// ─────────────────────────────────────────────────────────────────────
function ServiceJobRow({ job, workOrders, expanded, onToggle, fmtCell, columns, onReclassify }) {
  const chipCls = job.status === 'Closed' ? 'closed' : job.status === 'Hold' ? 'hold' : 'active'
  const dates   = job.startDate || job.completeDate
    ? { start: job.startDate, end: job.completeDate }
    : JOB_DATES_FALLBACK[job.num] || null
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 28, textAlign: 'center' }}>{expanded ? '▾' : '▸'}</td>
        {columns.map((c) => {
          if (c.key === 'directCost') {
            return <DirectCostCell key="dc" job={job} workOrders={workOrders} isService />
          }
          return (
            <td key={c.key} className={c.align === 'right' ? 'right' : ''} style={{ whiteSpace: c.type === 'str' ? 'normal' : 'nowrap' }}>
              {c.key === 'status' ? <span className={`chip ${chipCls}`}>{job.status}</span> : fmtCell(job, c)}
            </td>
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="ops-row-expand">
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--white)' }}>{job.name} · work orders</div>
              {dates && (
                <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                  {dates.start} → {dates.end || 'ongoing'}
                </div>
              )}
              <JobTypeToggle job={job} currentType={job.type} onToggle={onReclassify} />
            </div>
            {(!job.workOrders || job.workOrders.length === 0) ? (
              <div className="ops-small ops-text-dim">No work orders on file.</div>
            ) : (
              <table className="ops-table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>WO #</th><th>Opened</th><th>Closed</th><th>Description</th>
                    <th className="right">Hours</th><th className="right">Rate</th>
                    <th className="right">Billed</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {job.workOrders.map((w) => (
                    <tr key={w.wo}>
                      <td>{w.wo}</td>
                      <td className="ops-text-dim">{w.opened}</td>
                      <td className="ops-text-dim">{w.closed || '—'}</td>
                      <td>{w.description}</td>
                      <td className="right">{w.hours}</td>
                      <td className="right">${w.rate}</td>
                      <td className="right">{fmt(w.billed)}</td>
                      <td><span className={`chip ${w.status === 'invoiced' ? 'closed' : 'active'}`}>{w.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
export default function OpsJobsPage() {
  const { jobs, purchaseOrders, workOrders } = useOpsData()
  const { setJobTypeOverride, applyJobTypeOverrides } = useOpsViewState()

  const [view, setView]         = useState('contract')
  const [q, setQ]               = useState('')
  const [status, setStatus]     = useState('all')
  const [sortKey, setSortKey]   = useState('revenue')
  const [sortDir, setSortDir]   = useState('desc')
  const [expanded, setExpanded] = useState(null)
  const [mode, setMode]         = useState('actual')

  // Date range filter — default to current calendar year
  const thisYear = new Date().getFullYear()
  const [dateFrom, setDateFrom] = useState(`${thisYear - 1}-01-01`)
  const [dateTo,   setDateTo]   = useState(`${thisYear + 2}-12-31`)
  const [dateFilterOn, setDateFilterOn] = useState(false)

  // Apply type overrides
  const effectiveJobs = useMemo(() => applyJobTypeOverrides(jobs), [jobs, applyJobTypeOverrides])

  const contractJobs = useMemo(() => effectiveJobs.filter((j) => j.type === 'contract'), [effectiveJobs])
  const serviceJobs  = useMemo(() => effectiveJobs.filter((j) => j.type === 'service'),  [effectiveJobs])

  // Metrics (use all jobs, not date-filtered, so cards are stable)
  const contractProd = useMemo(() => companyProductivity(contractJobs), [contractJobs])
  const svcProd      = useMemo(() => serviceProductivity(serviceJobs, workOrders), [serviceJobs, workOrders])

  // T&M rollup row for contract view footer
  const tmRollup = useMemo(() => {
    if (!serviceJobs.length) return null
    const rev  = serviceJobs.reduce((s, j) => s + j.revenue, 0)
    const cost = serviceJobs.reduce((s, j) => s + j.directCost, 0)
    const hrs  = workOrders.reduce((s, w) => s + w.hours, 0)
    const openWos = workOrders.filter((w) => w.status === 'open').length
    return {
      num: 'T&M', name: 'Time & Material (service rollup)',
      contract: null, revenue: rev, directCost: cost,
      gpDol: rev - cost, gpPct: rev ? +(((rev - cost) / rev) * 100).toFixed(1) : 0,
      pctCmp: null, productivity: null, status: 'Active', isRollup: true, hrs, openWos,
    }
  }, [serviceJobs, workOrders])

  // Service rows enriched with WO stats
  const serviceRows = useMemo(() =>
    serviceJobs.map((j) => {
      const wos  = workOrders.filter((w) => w.jobNum === j.num)
      const hrs  = wos.reduce((s, w) => s + w.hours, 0)
      const bill = wos.reduce((s, w) => s + w.billed, 0)
      return {
        ...j,
        hours:   hrs,
        avgRate: hrs ? +(bill / hrs).toFixed(0) : 0,
        openWos: wos.filter((w) => w.status === 'open').length,
        workOrders: wos,
      }
    }),
    [serviceJobs, workOrders],
  )

  // ── Row pipeline: source → date filter → text/status filter → sort ──
  const rows = useMemo(() => {
    const source = view === 'contract'
      ? [...contractJobs.map((j) => ({ ...j, productivity: jobProductivity(j).productivity })), ...(tmRollup ? [tmRollup] : [])]
      : serviceRows

    let filtered = source.slice()

    // Date range filter (skip rollup rows)
    if (dateFilterOn) {
      filtered = filtered.filter((j) => {
        if (j.isRollup) return true
        // Prefer live Sage dates (startDate/completeDate on the job object),
        // fall back to UAT mock dates map, then show the job if no data.
        const jobStart = j.startDate || JOB_DATES_FALLBACK[j.num]?.start || null
        const jobEnd   = j.completeDate || JOB_DATES_FALLBACK[j.num]?.end || null
        if (!jobStart) return true  // no date data → always show
        const endStr = jobEnd || '9999-12-31'
        // Show job if its date range overlaps the filter window
        return endStr >= dateFrom && jobStart <= dateTo
      })
    }

    // Text search
    if (q.trim()) {
      const needle = q.toLowerCase()
      filtered = filtered.filter((j) =>
        j.name.toLowerCase().includes(needle) ||
        String(j.num).toLowerCase().includes(needle) ||
        (j.customer || '').toLowerCase().includes(needle),
      )
    }

    // Status filter
    if (status !== 'all') {
      filtered = filtered.filter((j) => j.isRollup || j.status === status)
    }

    // ── Group by name: merge rows with identical job name ──
    // Each Sage sub-job (e.g. 2430-A, 2430-B) with the same display name
    // gets collapsed into one row.  We keep the first job's metadata and
    // sum all numeric fields.
    const nameMap = new Map()
    for (const j of filtered) {
      if (j.isRollup) { nameMap.set('__rollup__', j); continue }
      const key = j.name.trim().toLowerCase()
      if (!nameMap.has(key)) {
        nameMap.set(key, { ...j, _grouped: [j] })
      } else {
        const existing = nameMap.get(key)
        // Sum financials, keep first job's identity fields
        const NUM_KEYS = ['contract', 'revenue', 'directCost', 'gpDol',
          'retainageHeld', 'contractedRetention', 'budgetLaborHrs', 'actualLaborHrs',
          'labor', 'material', 'subs', 'equipment', 'bonds', 'permits', 'other',
          'hours', 'openWos',
        ]
        for (const k of NUM_KEYS) {
          if (typeof existing[k] === 'number') existing[k] += (j[k] || 0)
        }
        // Weighted-average pctCmp
        const totalRev = existing.revenue
        existing.pctCmp = totalRev
          ? (existing._grouped.reduce((s, g) => s + (g.pctCmp || 0) * g.revenue, 0) + (j.pctCmp || 0) * j.revenue) / totalRev
          : existing.pctCmp
        // Recompute GP%
        existing.gpPct = existing.revenue ? +((existing.gpDol / existing.revenue) * 100).toFixed(1) : 0
        // Recompute productivity from summed hours
        existing.productivity = existing.budgetLaborHrs && existing.pctCmp && existing.actualLaborHrs
          ? +((existing.budgetLaborHrs * (existing.pctCmp / 100)) / existing.actualLaborHrs).toFixed(2)
          : null
        // Track job nums for display
        existing.num = existing._grouped.map((g) => g.num).concat(j.num).join(', ')
        existing._grouped.push(j)
      }
    }

    // Flatten back to array, rollup always last
    const rollup = nameMap.get('__rollup__')
    const result = [...nameMap.values()].filter((j) => !j.isRollup)

    // Sort
    result.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })

    if (rollup) result.push(rollup)
    return result
  }, [view, contractJobs, serviceRows, tmRollup, q, status, sortKey, sortDir, dateFilterOn, dateFrom, dateTo])

  const columns = view === 'contract' ? CONTRACT_COLUMNS : SERVICE_COLUMNS

  const toggleSort = (k) => {
    // Reset expanded row when sort changes to avoid stale expanded state
    setExpanded(null)
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const fmtCell = (j, col) => {
    const v = j[col.key]
    if (col.type === 'money') return v == null ? '—' : fmt(v)
    if (col.type === 'pct')   return v == null ? '—' : pct(Number(v), 0)
    if (col.type === 'hrs')   return v == null ? '—' : `${Number(v).toFixed(0)}`
    if (col.type === 'num')   return v == null ? '—' : String(v)
    if (col.type === 'prod')  return fmtProductivity(v)
    return v == null ? '—' : String(v)
  }

  return (
    <div>
      {/* ══════════════════════════════════════════════════════
          TOP CARDS — Row 1: Contract, Row 2: Service
      ══════════════════════════════════════════════════════ */}

      {/* Row 1 — Contract */}
      <div className="ops-grid-3" style={{ marginBottom: 12 }}>
        <OpsSectionCard title="Contract productivity" subtitle="Earned-value across contract jobs">
          <div className="ops-kpi-value" style={{ color: prodColor(contractProd.productivity) }}>
            {contractProd.productivity == null ? '—' : contractProd.productivity.toFixed(2)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {contractProd.earnedHrs.toLocaleString()} earned ÷ {contractProd.actualHrs.toLocaleString()} actual hrs
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            1.00 = on plan · {contractProd.jobCount} jobs
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Contract rev / field hour" subtitle="Contract revenue ÷ actual labor hrs">
          <div className="ops-kpi-value">
            {contractProd.revenuePerHour == null ? '—' : `$${contractProd.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Revenue booked ÷ actual hours worked
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Retainage held (contract)" subtitle="Per-job detail in expanded row">
          <div className="ops-kpi-value">
            {fmtK(contractJobs.reduce((s, j) => s + (j.retainageHeld || 0), 0))}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Contracted: {fmtK(contractJobs.reduce((s, j) => s + (j.contractedRetention || 0), 0))}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Releases at 95% / 100% complete.
          </div>
        </OpsSectionCard>
      </div>

      {/* Row 2 — Service */}
      <div className="ops-grid-3" style={{ marginBottom: 20 }}>
        <OpsSectionCard title="Service productivity" subtitle="T&M revenue ÷ work-order hours">
          <div className="ops-kpi-value">
            {svcProd.revenuePerHour == null ? '—' : `$${svcProd.revenuePerHour.toFixed(0)}`}
            <span className="ops-small ops-text-dim" style={{ fontSize: '0.8rem', fontWeight: 400, marginLeft: 6 }}>/hr</span>
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {fmtK(svcProd.revenue)} billed · {svcProd.hours.toLocaleString()} hrs · {svcProd.jobCount} jobs
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Service rev / field hour" subtitle="T&M revenue ÷ work-order hours">
          <div className="ops-kpi-value">
            {svcProd.revenuePerHour == null ? '—' : `$${svcProd.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Avg billing rate across all service jobs
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="How we measure" subtitle="Earned value for contract; rev/hr for service">
          <div className="ops-small" style={{ lineHeight: 1.6 }}>
            <div style={{ color: 'var(--white)', fontWeight: 600 }}>
              productivity = (budget hrs × % cmp) ÷ actual hrs
            </div>
            <div className="ops-text-dim" style={{ marginTop: 4 }}>1.00 = on plan · {'>'}1.00 ahead · {'<'}1.00 behind</div>
            <div className="ops-text-dim" style={{ marginTop: 4 }}>Service jobs show revenue per field hour instead.</div>
          </div>
        </OpsSectionCard>
      </div>

      {/* ══════════════════════════════════════════════════════
          JOBS TABLE CARD
      ══════════════════════════════════════════════════════ */}
      <OpsSectionCard
        title={view === 'contract' ? 'Jobs P&L — Contract' : 'Jobs P&L — Service (T&M)'}
        subtitle="Click a row to expand. Hover Direct Cost for breakdown + top items. Sort by clicking column headers."
        right={
          <div className="ops-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            {/* Contract / Service toggle */}
            <div className="ops-toggle">
              <button onClick={() => { setView('contract'); setExpanded(null); setSortKey('revenue'); setSortDir('desc') }} className={view === 'contract' ? 'active' : ''}>Contract</button>
              <button onClick={() => { setView('service');  setExpanded(null); setSortKey('revenue'); setSortDir('desc') }} className={view === 'service'  ? 'active' : ''}>Service</button>
            </div>

            {/* Actual / Accumulated (contract only) */}
            {view === 'contract' && (
              <div className="ops-toggle">
                <button onClick={() => setMode('actual')}      className={mode === 'actual'      ? 'active' : ''}>Actual</button>
                <button onClick={() => setMode('accumulated')} className={mode === 'accumulated' ? 'active' : ''}>Accumulated</button>
              </div>
            )}

            {/* Search */}
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, #, or customer"
              style={{ width: 210 }}
            />

            {/* Status */}
            <select className="ops-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="Active">Active</option>
              <option value="Hold">On hold</option>
              <option value="Closed">Closed</option>
            </select>

            {/* Date range toggle + inputs */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--white)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={dateFilterOn}
                onChange={(e) => setDateFilterOn(e.target.checked)}
                style={{ accentColor: 'var(--gold)' }}
              />
              Date filter
            </label>
            {dateFilterOn && (
              <>
                <input
                  type="date"
                  className="ops-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ width: 140 }}
                  title="Show jobs starting on or after this date"
                />
                <span className="ops-small ops-text-dim">–</span>
                <input
                  type="date"
                  className="ops-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ width: 140 }}
                  title="Show jobs ending on or before this date"
                />
              </>
            )}
          </div>
        }
      >
        {/* Horizontal scroll wrapper — explicit min-width forces scrollbar when needed */}
        <div style={{ overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' }}>
          <table className="ops-table" style={{ minWidth: 900, tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                {columns.map((c) => (
                  <ColumnHeader
                    key={c.key}
                    col={c}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((j) =>
                view === 'contract' ? (
                  <ContractJobRow
                    key={j.num}
                    job={j}
                    purchaseOrders={purchaseOrders}
                    workOrders={workOrders}
                    expanded={expanded === j.num}
                    onToggle={() => setExpanded(expanded === j.num ? null : j.num)}
                    fmtCell={fmtCell}
                    columns={columns}
                    mode={mode}
                    onReclassify={setJobTypeOverride}
                  />
                ) : (
                  <ServiceJobRow
                    key={j.num}
                    job={j}
                    workOrders={workOrders}
                    expanded={expanded === j.num}
                    onToggle={() => setExpanded(expanded === j.num ? null : j.num)}
                    fmtCell={fmtCell}
                    columns={columns}
                    onReclassify={setJobTypeOverride}
                  />
                ),
              )}
              {!rows.length && (
                <tr>
                  <td colSpan={columns.length + 1} className="center ops-text-dim" style={{ padding: '28px 0' }}>
                    No jobs match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </OpsSectionCard>
    </div>
  )
}
