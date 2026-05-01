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

// Contract-job table columns.
const CONTRACT_COLUMNS = [
  { key: 'num',          label: 'Job #',        type: 'str',
    tooltip: 'Sage short_name for the job, used as the public job number.' },
  { key: 'name',         label: 'Name',         type: 'str',
    tooltip: 'Sage job name (sage.jobs.job_name).' },
  { key: 'contract',     label: 'Contract',     type: 'money', align: 'right',
    tooltip: 'Original contract amount (sage.jobs.contract_amount).' },
  { key: 'revenue',      label: 'Revenue',      type: 'money', align: 'right',
    tooltip: 'Sum of all AR invoice totals booked to this job (billed-to-date).' },
  { key: 'directCost',   label: 'Direct Cost',  type: 'money', align: 'right',
    tooltip: 'Labor + Material + Subs + Equipment + Bonds + Permits + Other.' },
  { key: 'gpDol',        label: 'GP $',         type: 'money', align: 'right',
    tooltip: 'Gross Profit = Revenue − Direct Cost.' },
  { key: 'gpPct',        label: 'GP %',         type: 'pct',   align: 'right',
    tooltip: 'Gross Profit % = (GP $ ÷ Revenue) × 100.' },
  { key: 'pctCmp',       label: '% Cmp',        type: 'pct',   align: 'right',
    tooltip: 'Manual override from sage.jobs.percent_complete if a PM has set it. Otherwise computed: (cost-to-date ÷ total budget) × 100.' },
  { key: 'productivity', label: 'Productivity', type: 'prod',  align: 'right',
    tooltip: 'Earned-value productivity = (budget hrs × % complete) ÷ actual hrs. 1.00 = on plan.' },
  { key: 'status',       label: 'Status',       type: 'str',
    tooltip: 'Active, On Hold, or Closed.' },
]

const SERVICE_COLUMNS = [
  { key: 'num',       label: 'Job #',        type: 'str',
    tooltip: 'Sage short_name for the service job.' },
  { key: 'name',      label: 'Name',         type: 'str',
    tooltip: 'Service job name.' },
  { key: 'customer',  label: 'Customer',     type: 'str',
    tooltip: 'Job contact (sage.jobs.contact), falling back to job name if blank.' },
  { key: 'revenue',   label: 'T&M Revenue',  type: 'money', align: 'right',
    tooltip: 'Sum of all AR invoice totals booked to this service job.' },
  { key: 'hours',     label: 'Hours',        type: 'hrs',   align: 'right',
    tooltip: 'Total hours from all work orders attached to this job.' },
  { key: 'avgRate',   label: 'Avg $/hr',     type: 'money', align: 'right',
    tooltip: 'Total billed amount ÷ total hours, across all work orders.' },
  { key: 'openWos',   label: 'Open WOs',     type: 'num',   align: 'right',
    tooltip: 'Count of work orders with status = "open".' },
  { key: 'status',    label: 'Status',       type: 'str',
    tooltip: 'Active, On Hold, or Closed.' },
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

function fmtProductivity(p) {
  if (p == null) return '—'
  const cls = p >= 1 ? 'ops-text-pos' : p >= 0.9 ? '' : 'ops-text-neg'
  return <span className={cls}>{p.toFixed(2)}</span>
}

function ColumnHeader({ col, sortKey, sortDir, onClick }) {
  const arrow = sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  return (
    <th
      onClick={onClick}
      className={col.align === 'right' ? 'right' : ''}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      title={col.tooltip || ''}
    >
      {col.label}
      {col.tooltip && (
        <span
          aria-label={col.tooltip}
          title={col.tooltip}
          style={{
            display: 'inline-block',
            marginLeft: 4,
            fontSize: '0.78em',
            opacity: 0.55,
            cursor: 'help',
            verticalAlign: 'baseline',
          }}
        >
          ⓘ
        </span>
      )}
      {arrow}
    </th>
  )
}

// ── Type-reclassification pill ────────────────────────────────────────
// Small inline control rendered next to job name in the expanded row.
// Allows the user to move a job between Contract and Service.  The
// change persists across sessions via OpsViewStateContext → localStorage.
function JobTypeToggle({ job, currentType, onToggle }) {
  const target = currentType === 'contract' ? 'service' : 'contract'
  const isOverridden = !!job._typeOverridden
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span className="ops-small ops-text-dim">
        Classified as:
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 10px',
          borderRadius: 20,
          fontSize: '0.78rem',
          fontWeight: 700,
          background: currentType === 'contract'
            ? 'rgba(111,168,255,0.18)'
            : 'rgba(240,192,64,0.18)',
          border: `1px solid ${currentType === 'contract' ? 'rgba(111,168,255,0.5)' : 'rgba(240,192,64,0.5)'}`,
          color: currentType === 'contract' ? PALETTE.blue : PALETTE.amber,
        }}
      >
        {currentType === 'contract' ? 'Contract' : 'Service'}
        {isOverridden && (
          <span style={{ fontSize: '0.7rem', opacity: 0.7, fontWeight: 400 }}>
            (overridden)
          </span>
        )}
      </span>
      <button
        className="ops-btn ghost"
        style={{ padding: '3px 10px', fontSize: '0.78rem' }}
        title={`Move to ${target} — affects Jobs P&L and A/R reports`}
        onClick={(e) => { e.stopPropagation(); onToggle(job.num, target) }}
      >
        → Move to {target === 'contract' ? 'Contract' : 'Service'}
      </button>
      {isOverridden && (
        <button
          className="ops-btn ghost"
          style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.7 }}
          title="Restore original Sage classification"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(job.num, job._originalType || (currentType === 'contract' ? 'service' : 'contract'))
          }}
        >
          ↺ Reset
        </button>
      )}
    </div>
  )
}

// ── Per-job service cost detail tooltip ──────────────────────────────
// For service (T&M) jobs: show the total direct cost buckets + the top
// 10 line items (work orders) that make up that cost on hover.
function ServiceCostCell({ job, workOrders }) {
  const [open, setOpen] = useState(false)

  // Top-10 work orders by billed amount
  const top10 = useMemo(() => {
    const wos = (workOrders || [])
      .filter((w) => w.jobNum === job.num)
      .sort((a, b) => b.billed - a.billed)
      .slice(0, 10)
    return wos
  }, [workOrders, job.num])

  const totalBilled = top10.reduce((s, w) => s + w.billed, 0)

  return (
    <td
      className="right"
      style={{
        position: 'relative',
        cursor: top10.length > 0 ? 'help' : 'default',
        fontWeight: 600,
      }}
      onMouseEnter={() => top10.length > 0 && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {fmt(job.directCost)}
      {open && top10.length > 0 && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 60,
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 320,
            maxWidth: 420,
            background: 'var(--panel-dark, #1b1f25)',
            border: '1px solid var(--border-bright, #3a4049)',
            borderRadius: 8,
            padding: '10px 12px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            textAlign: 'left',
            fontWeight: 400,
            fontSize: '0.78rem',
            color: 'var(--white)',
          }}
        >
          {/* Cost bucket summary */}
          <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.04em', fontSize: '0.75rem' }}>
            DIRECT COST BREAKDOWN
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
            <tbody>
              {COST_BUCKETS.filter((b) => (job[b.key] || 0) > 0).map((b) => (
                <tr key={b.key}>
                  <td style={{ padding: '1px 4px' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: b.color, borderRadius: 2, marginRight: 5 }} />
                    {b.label}
                  </td>
                  <td style={{ textAlign: 'right', padding: '1px 4px', fontWeight: 600 }}>{fmt(job[b.key] || 0)}</td>
                  <td style={{ textAlign: 'right', padding: '1px 4px', color: 'var(--text-dim)' }}>
                    {job.directCost ? pct(((job[b.key] || 0) / job.directCost) * 100, 0) : '—'}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid rgba(255,255,255,0.15)', fontWeight: 700 }}>
                <td style={{ padding: '3px 4px' }}>Total</td>
                <td style={{ textAlign: 'right', padding: '3px 4px' }}>{fmt(job.directCost)}</td>
                <td style={{ textAlign: 'right', padding: '3px 4px', color: 'var(--text-dim)' }}>100%</td>
              </tr>
            </tbody>
          </table>

          {/* Top-10 work orders */}
          <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.04em', fontSize: '0.75rem' }}>
            TOP {top10.length} WORK ORDERS BY BILLED
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '2px 4px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.72rem' }}>WO #</th>
                <th style={{ textAlign: 'left', padding: '2px 4px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.72rem' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '2px 4px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.72rem' }}>Billed</th>
                <th style={{ textAlign: 'right', padding: '2px 4px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.72rem' }}>Hrs</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((w, i) => (
                <tr key={w.wo} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                  <td style={{ padding: '2px 4px', color: 'var(--text-dim)' }}>{w.wo}</td>
                  <td style={{ padding: '2px 4px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.description || '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600 }}>{fmt(w.billed)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 4px', color: 'var(--text-dim)' }}>{w.hours}</td>
                </tr>
              ))}
              {top10.length < (workOrders || []).filter((w) => w.jobNum === job.num).length && (
                <tr>
                  <td colSpan={4} style={{ padding: '3px 4px', color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.72rem' }}>
                    + {(workOrders || []).filter((w) => w.jobNum === job.num).length - top10.length} more WOs — expand row for full list
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-dim)' }}>Top 10 total</span>
            <span style={{ fontWeight: 700 }}>{fmt(totalBilled)}</span>
          </div>
        </div>
      )}
    </td>
  )
}

// ── Productivity helper for service jobs ──────────────────────────────
function serviceProductivity(serviceJobs, workOrders) {
  const rev = serviceJobs.reduce((s, j) => s + j.revenue, 0)
  const hrs = workOrders
    .filter((w) => serviceJobs.some((j) => j.num === w.jobNum))
    .reduce((s, w) => s + w.hours, 0)
  return {
    revenue: rev,
    hours: hrs,
    revenuePerHour: hrs ? +(rev / hrs).toFixed(2) : null,
    jobCount: serviceJobs.length,
  }
}

export default function OpsJobsPage() {
  const { jobs, purchaseOrders, workOrders } = useOpsData()
  const { setJobTypeOverride, applyJobTypeOverrides } = useOpsViewState()

  const [view, setView]       = useState('contract')
  const [q, setQ]             = useState('')
  const [status, setStatus]   = useState('all')
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(null)
  const [mode, setMode]       = useState('actual')

  // Apply user overrides to all jobs so downstream filters see the
  // corrected types throughout this component.
  const effectiveJobs = useMemo(() => applyJobTypeOverrides(jobs), [jobs, applyJobTypeOverrides])

  const contractJobs = useMemo(() => effectiveJobs.filter((j) => j.type === 'contract'), [effectiveJobs])
  const serviceJobs  = useMemo(() => effectiveJobs.filter((j) => j.type === 'service'),  [effectiveJobs])

  const tmRollup = useMemo(() => {
    if (!serviceJobs.length) return null
    const rev = serviceJobs.reduce((s, j) => s + j.revenue, 0)
    const cost = serviceJobs.reduce((s, j) => s + j.directCost, 0)
    const hrs = workOrders.reduce((s, w) => s + w.hours, 0)
    const openWos = workOrders.filter((w) => w.status === 'open').length
    return {
      num: 'T&M',
      name: 'Time & Material (service rollup)',
      contract: null,
      revenue: rev,
      directCost: cost,
      gpDol: rev - cost,
      gpPct: rev ? +(((rev - cost) / rev) * 100).toFixed(1) : 0,
      pctCmp: null,
      productivity: null,
      status: 'Active',
      isRollup: true,
      hrs,
      openWos,
    }
  }, [serviceJobs, workOrders])

  const serviceRows = useMemo(() => {
    return serviceJobs.map((j) => {
      const wos  = workOrders.filter((w) => w.jobNum === j.num)
      const hrs  = wos.reduce((s, w) => s + w.hours, 0)
      const bill = wos.reduce((s, w) => s + w.billed, 0)
      const openWos = wos.filter((w) => w.status === 'open').length
      return {
        ...j,
        hours:   hrs,
        avgRate: hrs ? +(bill / hrs).toFixed(0) : 0,
        openWos,
        workOrders: wos,
      }
    })
  }, [serviceJobs, workOrders])

  // ── Split productivity summaries ─────────────────────────────────
  const contractProd = useMemo(() => companyProductivity(contractJobs), [contractJobs])
  const svcProd      = useMemo(() => serviceProductivity(serviceJobs, workOrders), [serviceJobs, workOrders])

  const rows = useMemo(() => {
    const source = view === 'contract'
      ? [...contractJobs.map((j) => ({ ...j, productivity: jobProductivity(j).productivity })), ...(tmRollup ? [tmRollup] : [])]
      : serviceRows
    let filtered = source.slice()
    if (q.trim()) {
      const needle = q.toLowerCase()
      filtered = filtered.filter((j) =>
        j.name.toLowerCase().includes(needle) || String(j.num).toLowerCase().includes(needle))
    }
    if (status !== 'all') filtered = filtered.filter((j) => j.status === status)
    filtered.sort((a, b) => {
      if (a.isRollup && !b.isRollup) return 1
      if (b.isRollup && !a.isRollup) return -1
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
    return filtered
  }, [view, contractJobs, serviceRows, tmRollup, q, status, sortKey, sortDir])

  const columns = view === 'contract' ? CONTRACT_COLUMNS : SERVICE_COLUMNS

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const fmtCell = (j, col) => {
    const v = j[col.key]
    if (col.type === 'money') return v == null ? '—' : fmt(v)
    if (col.type === 'pct')   return v == null ? '—' : pct(v, 0)
    if (col.type === 'hrs')   return v == null ? '—' : `${Number(v).toFixed(0)}`
    if (col.type === 'num')   return v == null ? '—' : String(v)
    if (col.type === 'prod')  return fmtProductivity(v)
    return String(v ?? '—')
  }

  // Productivity colour helper
  const prodColor = (p) =>
    p == null ? 'var(--white)'
    : p >= 1.0 ? 'var(--pos)'
    : p >= 0.9 ? 'var(--gold)'
    : 'var(--neg)'

  return (
    <div>
      {/* ── Productivity summary cards — split Contract / Service ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 20 }}>

        {/* Contract productivity */}
        <OpsSectionCard
          title="Contract productivity"
          subtitle="Earned-value across contract jobs only"
        >
          <div className="ops-kpi-value" style={{ color: prodColor(contractProd.productivity) }}>
            {contractProd.productivity == null ? '—' : contractProd.productivity.toFixed(2)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {contractProd.earnedHrs.toLocaleString()} earned hrs ÷ {contractProd.actualHrs.toLocaleString()} actual hrs
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            1.00 = on plan · {contractProd.jobCount} contract jobs
          </div>
        </OpsSectionCard>

        {/* Contract revenue per field hour */}
        <OpsSectionCard title="Contract rev / field hour" subtitle="Contract revenue ÷ actual labor hrs">
          <div className="ops-kpi-value">
            {contractProd.revenuePerHour == null ? '—' : `$${contractProd.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Revenue booked ÷ actual hours worked
          </div>
        </OpsSectionCard>

        {/* Service revenue per field hour */}
        <OpsSectionCard title="Service rev / field hour" subtitle="T&M revenue ÷ work-order hours">
          <div className="ops-kpi-value">
            {svcProd.revenuePerHour == null ? '—' : `$${svcProd.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {fmtK(svcProd.revenue)} billed ÷ {svcProd.hours.toLocaleString()} hrs · {svcProd.jobCount} service jobs
          </div>
        </OpsSectionCard>

        {/* How we measure */}
        <OpsSectionCard
          title="How we measure productivity"
          subtitle="Earned value, shown on every row"
        >
          <div className="ops-small" style={{ color: 'var(--white-dim)', lineHeight: 1.55 }}>
            <div style={{ color: 'var(--white)', fontWeight: 600 }}>
              productivity = (budgeted hrs × % complete) ÷ actual hrs
            </div>
            <div style={{ marginTop: 4 }}>
              1.00 = on plan · {'>'}1.00 ahead · {'<'}1.00 behind
            </div>
            <div style={{ marginTop: 4 }}>
              Service (T&amp;M) shows rev/hr instead — no %&nbsp;complete.
            </div>
          </div>
        </OpsSectionCard>

        {/* Retainage */}
        <OpsSectionCard title="Retainage held (contract jobs)" subtitle="Per-job detail in expanded row">
          <div className="ops-kpi-value">
            {fmtK(contractJobs.reduce((s, j) => s + (j.retainageHeld || 0), 0))}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Contracted: {fmtK(contractJobs.reduce((s, j) => s + (j.contractedRetention || 0), 0))}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Release schedule tied to % complete (95% / 100%).
          </div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title={view === 'contract' ? 'Jobs P&L — Contract' : 'Jobs P&L — Service (T&M)'}
        subtitle={
          view === 'contract'
            ? 'Click any column header to sort. Click a row to expand cost buckets, POs, weekly curve, retainage, and job-type reclassification. Hover ⓘ to see how values are calculated.'
            : 'Click a row to expand the work-order list. Hover the Direct Cost cell to see the cost breakdown + top 10 work orders. Expand to reclassify a job.'
        }
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle" title="Contract jobs vs service (T&M) jobs">
              <button onClick={() => { setView('contract'); setExpanded(null) }} className={view === 'contract' ? 'active' : ''}>Contract</button>
              <button onClick={() => { setView('service');  setExpanded(null) }} className={view === 'service'  ? 'active' : ''}>Service</button>
            </div>
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search job # or name"
              style={{ width: 220 }}
            />
            <select className="ops-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="Active">Active</option>
              <option value="Hold">On hold</option>
              <option value="Closed">Closed</option>
            </select>
            {view === 'contract' && (
              <div className="ops-toggle" title="Actual = per-week; Accumulated = running totals">
                <button onClick={() => setMode('actual')}      className={mode === 'actual'      ? 'active' : ''}>Actual</button>
                <button onClick={() => setMode('accumulated')} className={mode === 'accumulated' ? 'active' : ''}>Accumulated</button>
              </div>
            )}
          </div>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                {columns.map((c) => (
                  <ColumnHeader
                    key={c.key}
                    col={c}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={() => toggleSort(c.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                view === 'contract'
                  ? <ContractJobRow
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
                  : <ServiceJobRow
                      key={j.num}
                      job={j}
                      workOrders={workOrders}
                      expanded={expanded === j.num}
                      onToggle={() => setExpanded(expanded === j.num ? null : j.num)}
                      fmtCell={fmtCell}
                      columns={columns}
                      onReclassify={setJobTypeOverride}
                    />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={columns.length + 1} className="center ops-text-dim" style={{ padding: '24px 0' }}>
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

function runSum(arr) {
  let s = 0
  return arr.map((v) => (s += v))
}

// ── Contract-job row ──────────────────────────────────────────────────
function ContractJobRow({ job, purchaseOrders, workOrders, expanded, onToggle, fmtCell, columns, mode, onReclassify }) {
  if (job.isRollup) {
    return (
      <tr style={{ fontStyle: 'italic', borderTop: '1px dashed var(--border-bright)' }}>
        <td style={{ width: 24 }}></td>
        {columns.map((c) => (
          <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
            {c.key === 'status'
              ? <span className="chip active">T&amp;M</span>
              : fmtCell(job, c)}
          </td>
        ))}
      </tr>
    )
  }

  const costTot  = job.directCost
  const weekly   = useMemo(() => buildWeekly(job.revenue, costTot), [job.revenue, costTot])

  const series = useMemo(() => {
    if (mode === 'accumulated') {
      return { revenue: runSum(weekly.revenue), cogs: runSum(weekly.cogs), gp: runSum(weekly.gp) }
    }
    return { revenue: weekly.revenue, cogs: weekly.cogs, gp: weekly.gp }
  }, [weekly, mode])

  const lineData = {
    labels: weekly.labels,
    datasets: [
      { label: 'Revenue',     data: series.revenue, borderColor: PALETTE.blue,  backgroundColor: 'rgba(111,168,255,0.10)', fill: true, tension: 0.3, borderWidth: 2 },
      { label: 'Direct Cost', data: series.cogs,    borderColor: PALETTE.red,   backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'GP',          data: series.gp,      borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
    ],
  }

  const bucketValues = COST_BUCKETS.map((b) => job[b.key] || 0)
  const bucketData = {
    labels: COST_BUCKETS.map((b) => b.label),
    datasets: [{
      label: 'Direct cost ($)',
      data: bucketValues,
      backgroundColor: COST_BUCKETS.map((b) => b.color),
      borderWidth: 0,
    }],
  }
  const bucketOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed.y)} (${pct(costTot ? (ctx.parsed.y / costTot) * 100 : 0, 0)})`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.82)', font: { size: 10 } } },
      y: {
        grid: { color: 'rgba(240,192,64,0.14)' },
        ticks: { color: 'rgba(255,255,255,0.82)', font: { size: 10 }, callback: (v) => fmtK(Number(v)) },
      },
    },
  }

  const jobPOs = purchaseOrders.filter((p) => p.jobNum === job.num)
  const poBilledTot      = jobPOs.reduce((s, p) => s + p.billed, 0)
  const poOutstandingTot = jobPOs.reduce((s, p) => s + (p.amount - p.billed), 0)

  const { productivity, earnedHrs } = jobProductivity(job)
  const chipCls = job.status === 'Closed' ? 'closed' : job.status === 'Hold' ? 'hold' : 'active'

  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 24 }}>{expanded ? '▾' : '▸'}</td>
        {columns.map((c) => (
          <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
            {c.key === 'status'
              ? <span className={`chip ${chipCls}`}>{job.status}</span>
              : fmtCell(job, c)}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="ops-row-expand">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--white)' }}>{job.name}</div>
                <div className="ops-small ops-text-dim">
                  Rev {fmtK(job.revenue)} · Direct Cost {fmtK(costTot)} · GP {fmtK(job.revenue - costTot)} ({pct(job.gpPct, 1)})
                </div>
                {/* ── Reclassification control ── */}
                <JobTypeToggle
                  job={job}
                  currentType={job.type}
                  onToggle={onReclassify}
                />
              </div>
              <div className="ops-small ops-text-dim" style={{ textAlign: 'right', maxWidth: 320 }}>
                <div>Budget: {job.budgetLaborHrs?.toLocaleString()} hrs · Actual: {job.actualLaborHrs?.toLocaleString()} hrs</div>
                <div>Earned: {Math.round(earnedHrs).toLocaleString()} hrs · Productivity {productivity == null ? '—' : productivity.toFixed(2)}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Direct cost breakdown</div>
                <OpsChartBox size="sm">
                  <Bar data={bucketData} options={bucketOpts} />
                </OpsChartBox>
              </div>
              <div>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Buckets ($)</div>
                <table className="ops-table" style={{ fontSize: '0.8rem' }}>
                  <tbody>
                    {COST_BUCKETS.map((b, i) => (
                      <tr key={b.key}>
                        <td>
                          <span style={{ display: 'inline-block', width: 10, height: 10, background: b.color, borderRadius: 2, marginRight: 6 }} />
                          {b.label}
                        </td>
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

            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>
                Weekly curve <span className="ops-text-dim" style={{ fontWeight: 400 }}>({mode === 'accumulated' ? 'accumulated' : 'actual'})</span>
              </div>
              <OpsChartBox size="md">
                <Line data={lineData} options={moneyLineOpts()} />
              </OpsChartBox>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>
                Purchase orders · outstanding = commitment (variable / direct cost)
              </div>
              {jobPOs.length === 0 ? (
                <div className="ops-small ops-text-dim">No POs on file for this job.</div>
              ) : (
                <table className="ops-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Vendor</th>
                      <th>Description</th>
                      <th className="right">Amount</th>
                      <th className="right">Billed</th>
                      <th className="right">Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobPOs.map((p) => {
                      const outstanding = p.amount - p.billed
                      return (
                        <tr key={p.po}>
                          <td>{p.po}</td>
                          <td>{p.vendor}</td>
                          <td className="ops-text-dim">{p.desc}</td>
                          <td className="right">{fmt(p.amount)}</td>
                          <td className="right">{fmt(p.billed)}</td>
                          <td className={`right ${outstanding > 0 ? 'ops-text-neg' : ''}`}>{fmt(outstanding)}</td>
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

            <div>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Retainage</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div className="ops-stat-box">
                  <div className="ops-small ops-text-dim">Contract retention rate</div>
                  <div style={{ fontWeight: 700, color: 'var(--white)' }}>{pct(job.retainagePct, 0)}</div>
                </div>
                <div className="ops-stat-box">
                  <div className="ops-small ops-text-dim">Contracted retention $</div>
                  <div style={{ fontWeight: 700, color: 'var(--white)' }}>{fmt(job.contractedRetention)}</div>
                </div>
                <div className="ops-stat-box">
                  <div className="ops-small ops-text-dim">Held to date</div>
                  <div style={{ fontWeight: 700, color: 'var(--white)' }}>{fmt(job.retainageHeld || 0)}</div>
                </div>
                <div className="ops-stat-box">
                  <div className="ops-small ops-text-dim">% complete</div>
                  <div style={{ fontWeight: 700, color: 'var(--white)' }}>{pct(job.pctCmp, 0)}</div>
                </div>
              </div>
              {job.releaseSchedule?.length > 0 && (
                <table className="ops-table" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Trigger (% complete)</th>
                      <th className="right">Release %</th>
                      <th>Note</th>
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

// ── Service-job row ───────────────────────────────────────────────────
function ServiceJobRow({ job, workOrders, expanded, onToggle, fmtCell, columns, onReclassify }) {
  const chipCls = job.status === 'Closed' ? 'closed' : job.status === 'Hold' ? 'hold' : 'active'
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 24 }}>{expanded ? '▾' : '▸'}</td>
        {columns.map((c) => {
          // Replace the directCost cell with the enriched hover tooltip version
          if (c.key === 'revenue') {
            return (
              <ServiceCostCell key="svcCost" job={job} workOrders={workOrders} />
            )
          }
          return (
            <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
              {c.key === 'status'
                ? <span className={`chip ${chipCls}`}>{job.status}</span>
                : fmtCell(job, c)}
            </td>
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="ops-row-expand">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--white)', marginBottom: 4 }}>
                  {job.name} · work orders
                </div>
                {/* ── Reclassification control ── */}
                <JobTypeToggle
                  job={job}
                  currentType={job.type}
                  onToggle={onReclassify}
                />
              </div>
            </div>

            {job.workOrders.length === 0 ? (
              <div className="ops-small ops-text-dim">No work orders on file.</div>
            ) : (
              <table className="ops-table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>WO #</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th>Description</th>
                    <th className="right">Hours</th>
                    <th className="right">Rate</th>
                    <th className="right">Billed</th>
                    <th>Status</th>
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
