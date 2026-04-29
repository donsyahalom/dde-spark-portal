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
import { fmt, fmtK, pct } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'

// Contract-job table columns.  `gpDol`, `gpPct`, `subPct`, `directCost`
// come from enrichJob().  `productivity` is computed per-row.
const CONTRACT_COLUMNS = [
  { key: 'num',          label: 'Job #',      type: 'str' },
  { key: 'name',         label: 'Name',       type: 'str' },
  { key: 'contract',     label: 'Contract',   type: 'money', align: 'right' },
  { key: 'revenue',      label: 'Revenue',    type: 'money', align: 'right' },
  { key: 'directCost',   label: 'Direct Cost',type: 'money', align: 'right' },
  { key: 'gpDol',        label: 'GP $',       type: 'money', align: 'right' },
  { key: 'gpPct',        label: 'GP %',       type: 'pct',   align: 'right' },
  { key: 'pctCmp',       label: '% Cmp',      type: 'pct',   align: 'right' },
  { key: 'productivity', label: 'Productivity', type: 'prod',align: 'right' },
  { key: 'status',       label: 'Status',     type: 'str' },
]

// Service-job table (T&M) — different metrics.
const SERVICE_COLUMNS = [
  { key: 'num',       label: 'Job #',       type: 'str' },
  { key: 'name',      label: 'Name',        type: 'str' },
  { key: 'customer',  label: 'Customer',    type: 'str' },
  { key: 'revenue',   label: 'T&M Revenue', type: 'money', align: 'right' },
  { key: 'hours',     label: 'Hours',       type: 'hrs',   align: 'right' },
  { key: 'avgRate',   label: 'Avg $/hr',    type: 'money', align: 'right' },
  { key: 'openWos',   label: 'Open WOs',    type: 'num',   align: 'right' },
  { key: 'status',    label: 'Status',      type: 'str' },
]

// ── Cost-bucket metadata ──
// Used by both the expanded cost-breakdown chart and the bucket totals
// row on the contract table footer.
const COST_BUCKETS = [
  { key: 'labor',     label: 'Labor',     color: PALETTE.blue },
  { key: 'material',  label: 'Material',  color: PALETTE.amber },
  { key: 'subs',      label: 'Subs',      color: PALETTE.red },
  { key: 'equipment', label: 'Equipment', color: PALETTE.purple },
  { key: 'bonds',     label: 'Bonds',     color: PALETTE.green },
  { key: 'permits',   label: 'Permits',   color: '#E879F9' }, // soft magenta
  { key: 'other',     label: 'Other',     color: 'rgba(255,255,255,0.45)' },
]

function fmtProductivity(p) {
  if (p == null) return '—'
  // Classify so the reader can sanity-check at a glance:
  //  ≥ 1.00 on or ahead of plan, 0.90–0.99 slightly behind, < 0.90 behind
  const cls = p >= 1 ? 'ops-text-pos' : p >= 0.9 ? '' : 'ops-text-neg'
  return <span className={cls}>{p.toFixed(2)}</span>
}

export default function OpsJobsPage() {
  const { jobs, purchaseOrders, workOrders } = useOpsData()
  const [view, setView]       = useState('contract') // 'contract' | 'service'
  const [q, setQ]             = useState('')
  const [status, setStatus]   = useState('all')
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(null)
  // 'actual' = per-week series; 'accumulated' = running totals.
  const [mode, setMode]       = useState('actual')

  const contractJobs = useMemo(() => jobs.filter((j) => j.type === 'contract'), [jobs])
  const serviceJobs  = useMemo(() => jobs.filter((j) => j.type === 'service'),  [jobs])

  // Service-job rollup row — so the contract view always shows a single
  // "Time & Material" line summarising every service job in the PC.  Mirrors
  // the Sage "all service work as one category" convention.
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

  // Build service-view rows — one per service job, with hours / avg rate
  // pulled from the WO list filtered to that job.
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

  // Company productivity card — contract jobs only (see helper).
  const prodSummary = useMemo(() => companyProductivity(jobs), [jobs])

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
      // Keep the T&M rollup pinned to the bottom of the contract view.
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

  return (
    <div>
      {/* ── Productivity summary cards ───────────────────────────── */}
      <div className="ops-grid-4">
        <OpsSectionCard
          title="Company productivity"
          subtitle="Earned-value across all contract jobs"
        >
          <div className="ops-kpi-value">
            {prodSummary.productivity == null ? '—' : prodSummary.productivity.toFixed(2)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {prodSummary.earnedHrs.toLocaleString()} earned hrs ÷ {prodSummary.actualHrs.toLocaleString()} actual hrs
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            1.00 = on plan · {prodSummary.jobCount} contract jobs
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Revenue per field hour" subtitle="Contract jobs only">
          <div className="ops-kpi-value">
            {prodSummary.revenuePerHour == null ? '—' : `$${prodSummary.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Revenue booked ÷ actual hours worked
          </div>
        </OpsSectionCard>
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
              Service (T&amp;M) jobs are excluded — no %&nbsp;complete.
            </div>
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Retainage held (all contract jobs)" subtitle="Per-job detail in expanded row">
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
            ? 'Click any column header to sort. Click a row to expand cost buckets, POs, weekly curve, and retainage.'
            : 'Click a row to expand the work-order list for that service job.'
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
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={c.align === 'right' ? 'right' : ''}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
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
                      expanded={expanded === j.num}
                      onToggle={() => setExpanded(expanded === j.num ? null : j.num)}
                      fmtCell={fmtCell}
                      columns={columns}
                      mode={mode}
                    />
                  : <ServiceJobRow
                      key={j.num}
                      job={j}
                      expanded={expanded === j.num}
                      onToggle={() => setExpanded(expanded === j.num ? null : j.num)}
                      fmtCell={fmtCell}
                      columns={columns}
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

// Running cumulative sum — used when mode === 'accumulated'.
function runSum(arr) {
  let s = 0
  return arr.map((v) => (s += v))
}

// ── Contract-job row ──────────────────────────────────────────────
// Expands into: cost-bucket bar chart, weekly curve, PO table, retainage panel.
function ContractJobRow({ job, purchaseOrders, expanded, onToggle, fmtCell, columns, mode }) {
  // T&M rollup row renders a slimmer version — no expanded body because
  // the detail lives on the Service view.
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

  // Cost-bucket bar chart: horizontal-ish vertical bars, one per bucket.
  // Shown as dollars since the reader is scanning magnitudes.
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
              </div>
              <div className="ops-small ops-text-dim" style={{ textAlign: 'right', maxWidth: 320 }}>
                <div>Budget: {job.budgetLaborHrs?.toLocaleString()} hrs · Actual: {job.actualLaborHrs?.toLocaleString()} hrs</div>
                <div>Earned: {Math.round(earnedHrs).toLocaleString()} hrs · Productivity {productivity == null ? '—' : productivity.toFixed(2)}</div>
              </div>
            </div>

            {/* ── Cost buckets ─────────────────────────────────────── */}
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

            {/* ── Weekly curve ─────────────────────────────────────── */}
            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>
                Weekly curve <span className="ops-text-dim" style={{ fontWeight: 400 }}>({mode === 'accumulated' ? 'accumulated' : 'actual'})</span>
              </div>
              <OpsChartBox size="md">
                <Line data={lineData} options={moneyLineOpts()} />
              </OpsChartBox>
            </div>

            {/* ── Purchase orders ──────────────────────────────────── */}
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

            {/* ── Retainage ────────────────────────────────────────── */}
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

// ── Service-job row — expands to show its work orders ────────────
function ServiceJobRow({ job, expanded, onToggle, fmtCell, columns }) {
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
            <div style={{ fontWeight: 700, color: 'var(--white)', marginBottom: 6 }}>
              {job.name} · work orders
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
