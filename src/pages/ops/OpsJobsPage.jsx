import { useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData, buildWeekly } from '../../hooks/useOpsData'
import { fmt, fmtK, pct } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'

const COLUMNS = [
  { key: 'num',      label: 'Job #',     type: 'str' },
  { key: 'name',     label: 'Name',      type: 'str' },
  { key: 'contract', label: 'Contract',  type: 'money', align: 'right' },
  { key: 'revenue',  label: 'Revenue',   type: 'money', align: 'right' },
  { key: 'gpDol',    label: 'GP $',      type: 'money', align: 'right' },
  { key: 'gpPct',    label: 'GP %',      type: 'pct',   align: 'right' },
  { key: 'subPct',   label: 'Sub $ %',   type: 'pct',   align: 'right' },
  { key: 'pctCmp',   label: '% Cmp',     type: 'pct',   align: 'right' },
  { key: 'status',   label: 'Status',    type: 'str' },
]

const TOP_BY_OPTIONS = [
  { key: 'revenue',  label: 'Revenue' },
  { key: 'gpDol',    label: 'GP $' },
  { key: 'gpPct',    label: 'GP %' },
  { key: 'contract', label: 'Contract' },
  { key: 'pctCmp',   label: '% Complete' },
]

export default function OpsJobsPage() {
  const { jobs } = useOpsData()
  const [q, setQ] = useState('')
  const [status, setStatus]   = useState('all')
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')
  const [topBy, setTopBy]     = useState('revenue')
  const [topN, setTopN]       = useState(null)
  const [expanded, setExpanded] = useState(null)

  const rows = useMemo(() => {
    let rows = jobs.slice()
    if (q.trim()) {
      const needle = q.toLowerCase()
      rows = rows.filter((j) =>
        j.name.toLowerCase().includes(needle) || j.num.includes(needle))
    }
    if (status !== 'all') rows = rows.filter((j) => j.status === status)
    if (topN && topN > 0) {
      rows.sort((a, b) => b[topBy] - a[topBy])
      rows = rows.slice(0, topN)
    }
    rows.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
    return rows
  }, [jobs, q, status, sortKey, sortDir, topBy, topN])

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const fmtCell = (j, col) => {
    const v = j[col.key]
    if (col.type === 'money') return fmt(v)
    if (col.type === 'pct')   return pct(v, 0)
    return String(v)
  }

  return (
    <OpsSectionCard
      title="Jobs P&L"
      subtitle="Click any column header to sort. Click a row to expand weekly Rev/COGS/GP."
      right={
        <div className="ops-toolbar">
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
          <label className="ops-checkbox" style={{ gap: 6 }}>
            <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--white-dim)' }}>Top</span>
            <input
              type="number"
              min={0}
              value={topN ?? ''}
              onChange={(e) => setTopN(e.target.value ? parseInt(e.target.value, 10) : null)}
              placeholder="—"
              style={{ width: 48, background: 'transparent', border: 'none', color: 'var(--white)', fontSize: '0.85rem', outline: 'none', textAlign: 'center' }}
            />
            <span style={{ fontSize: '0.7rem', color: 'var(--white-dim)' }}>by</span>
            <select
              value={topBy}
              onChange={(e) => setTopBy(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--white)', fontSize: '0.82rem', outline: 'none' }}
            >
              {TOP_BY_OPTIONS.map((o) => <option key={o.key} value={o.key} style={{ background: 'var(--bg-darker)' }}>{o.label}</option>)}
            </select>
          </label>
        </div>
      }
    >
      <table className="ops-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            {COLUMNS.map((c) => (
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
            <JobRow
              key={j.num}
              job={j}
              expanded={expanded === j.num}
              onToggle={() => setExpanded(expanded === j.num ? null : j.num)}
              fmtCell={fmtCell}
            />
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                No jobs match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </OpsSectionCard>
  )
}

function JobRow({ job, expanded, onToggle, fmtCell }) {
  const costTot = job.lab + job.mat + job.sub
  const weekly  = useMemo(() => buildWeekly(job.revenue, costTot), [job.revenue, costTot])

  const data = {
    labels: weekly.labels,
    datasets: [
      { label: 'Revenue', data: weekly.revenue, borderColor: PALETTE.blue,  backgroundColor: 'rgba(111,168,255,0.10)', fill: true, tension: 0.3, borderWidth: 2 },
      { label: 'COGS',    data: weekly.cogs,    borderColor: PALETTE.red,   backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'GP',      data: weekly.gp,      borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
    ],
  }

  const chipCls = job.status === 'Closed' ? 'closed' : job.status === 'Hold' ? 'hold' : 'active'

  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 24 }}>{expanded ? '▾' : '▸'}</td>
        {COLUMNS.map((c) => (
          <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
            {c.key === 'status'
              ? <span className={`chip ${chipCls}`}>{job.status}</span>
              : fmtCell(job, c)}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMNS.length + 1} className="ops-row-expand">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--white)' }}>{job.name} · weekly curve</div>
                <div className="ops-small ops-text-dim">
                  Rev {fmtK(job.revenue)} · COGS {fmtK(costTot)} · GP {fmtK(job.revenue - costTot)}
                </div>
              </div>
              <div className="ops-small ops-text-dim">
                Sub $ {fmt(job.sub)} ({pct(job.subPct, 0)} of revenue)
              </div>
            </div>
            <OpsChartBox size="md">
              <Line data={data} options={moneyLineOpts()} />
            </OpsChartBox>
          </td>
        </tr>
      )}
    </>
  )
}
