import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import OpsChartBox from './OpsChartBox'
import { useOpsCashflowBasis } from '../../context/OpsCashflowBasisContext'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt } from '../../lib/opsFormat'
import { PALETTE } from '../../lib/opsChartOpts'

// Payment history panel — filters largest customers, computes avg /
// median / p90 days-to-pay, renders per-customer rows and a distribution
// chart, then exposes an "Apply to Cashflow" button that snapshots the
// current sample into the Cashflow context on a per-customer basis.

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const med  = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const p90 = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.round(0.9 * (s.length - 1)))]
}

export default function OpsPaymentHistory() {
  const { paymentHistory } = useOpsData()
  const { applyPaymentHistory } = useOpsCashflowBasis()
  const navigate = useNavigate()

  const [activeMode, setActiveMode] = useState('active')     // 'active' | 'all' | 'inactive'
  const [period, setPeriod]         = useState('12')         // '6' | '12' | '24' | '36' | 'all'
  const [topN, setTopN]             = useState(8)
  const [trim, setTrim]             = useState(true)
  const [toast, setToast]           = useState(null)

  const { rows, stats, buckets, counts } = useMemo(() => {
    let rows = paymentHistory.filter((c) => {
      if (activeMode === 'active')   return c.active
      if (activeMode === 'inactive') return !c.active
      return true
    })
    const cap = period === 'all' ? Infinity : parseInt(period, 10)
    const rowsWithDeltas = rows
      .map((r) => ({ ...r, _deltas: r.deltas.slice(Math.max(0, r.deltas.length - cap)) }))
      .filter((r) => r._deltas.length > 0)

    rowsWithDeltas.sort((a, b) => b.paid - a.paid)
    const topRows = rowsWithDeltas.slice(0, Math.max(1, topN))

    const combined = topRows.flatMap((r) => r._deltas)
    const sampleBase = combined.length
    const doTrim = trim && sampleBase >= 12
    let working = [...combined].sort((a, b) => a - b)
    let trimmed = []
    if (doTrim) { trimmed = working.slice(-2); working = working.slice(0, -2) }

    const stats = {
      avg: mean(working),
      med: med(working),
      p90: p90(working),
      n: working.length,
      base: sampleBase,
      trimmed,
      trimApplied: doTrim,
      customers: topRows.length,
    }

    const bucketDefs = [
      { label: '0-14',  lo: 0,  hi: 14  },
      { label: '15-30', lo: 15, hi: 30  },
      { label: '31-45', lo: 31, hi: 45  },
      { label: '46-60', lo: 46, hi: 60  },
      { label: '61-90', lo: 61, hi: 90  },
      { label: '91+',   lo: 91, hi: 1e9 },
    ]
    const counts = bucketDefs.map((b) => working.filter((d) => d >= b.lo && d <= b.hi).length)

    return { rows: topRows, stats, buckets: bucketDefs, counts }
  }, [paymentHistory, activeMode, period, topN, trim])

  const applyHandler = () => {
    applyPaymentHistory(rows, stats.avg)
    const shift = Math.round(stats.avg - 30)
    setToast(
      `Per-customer payment history applied. ${stats.customers} customers ` +
      `(median ${Math.round(stats.med)}d, avg shift ${shift >= 0 ? '+' + shift : shift}d vs Net-30).`,
    )
    setTimeout(() => navigate('/ops/cashflow'), 600)
    setTimeout(() => setToast(null), 8000)
  }

  const distData = {
    labels: buckets.map((b) => b.label),
    datasets: [{
      label: 'Invoices',
      data: counts,
      backgroundColor: counts.map((_, i) => (i >= 3 ? PALETTE.amber : PALETTE.blue)),
      borderRadius: 4,
    }],
  }

  return (
    <>
      <div className="ops-card">
        <div className="ops-card-head">
          <div>
            <div className="ops-card-title">Payment history — largest customers</div>
            <div className="ops-card-sub">
              Days between invoice date and date paid in full · {stats.customers} customers · {stats.base} invoices in window
            </div>
          </div>
          <div className="ops-toolbar">
            <select className="ops-select" value={activeMode} onChange={(e) => setActiveMode(e.target.value)}>
              <option value="active">Active customers only</option>
              <option value="all">Active + inactive</option>
              <option value="inactive">Inactive only</option>
            </select>
            <select className="ops-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="24">Last 24 months</option>
              <option value="12">Last 12 months</option>
              <option value="6">Last 6 months</option>
              <option value="36">Last 36 months</option>
              <option value="all">All time</option>
            </select>
            <label className="ops-checkbox" style={{ gap: 8 }}>
              <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--white-dim)' }}>Top</span>
              <input
                type="number"
                min={1}
                value={topN}
                onChange={(e) => setTopN(parseInt(e.target.value || '1', 10))}
                style={{ width: 48, background: 'transparent', border: 'none', color: 'var(--white)', fontSize: '0.85rem', outline: 'none' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--white-dim)' }}>by paid $</span>
            </label>
            <label className="ops-checkbox">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
              Trim top 2 outliers
            </label>
            <button className="btn btn-gold btn-sm" onClick={applyHandler}>Apply to Cashflow</button>
          </div>
        </div>

        <div className="ops-grid-4" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <Stat
            label="Avg days to pay"
            value={stats.n ? Math.round(stats.avg) + ' d' : '—'}
            sub={stats.n
              ? '≈ ' + (stats.avg > 30 ? '+' + Math.round(stats.avg - 30) : Math.round(stats.avg - 30)) + ' d vs Net-30'
              : ' '}
          />
          <Stat label="Median" value={stats.n ? Math.round(stats.med) + ' d' : '—'} />
          <Stat label="p90 (slow tail)" value={stats.n ? Math.round(stats.p90) + ' d' : '—'} />
          <Stat
            label="Invoices in sample"
            value={String(stats.n)}
            sub={stats.trimApplied
              ? `trimmed 2 outliers (${stats.trimmed.map((d) => d + 'd').join(', ')})`
              : (trim ? 'sample too small to trim' : 'no outlier trim')}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 0 }}>
          <div style={{ borderRight: '1px solid var(--border)' }}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="right">Invoices</th>
                  <th className="right">Paid $</th>
                  <th className="right">Avg days</th>
                  <th className="right">Median</th>
                  <th className="right">p90</th>
                  <th className="center">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => <CustomerRow key={c.name} c={c} />)}
                {!rows.length && (
                  <tr><td colSpan={7} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                    No customers match the current filters.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 16 }}>
            <div className="ops-stat-lbl" style={{ marginBottom: 8 }}>Days-to-pay distribution</div>
            <OpsChartBox size="md">
              <Bar data={distData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { grid: { display: false }, ticks: { color: PALETTE.dim, font: { size: 10 } } },
                  y: { beginAtZero: true, grid: { color: 'rgba(240,192,64,0.10)' }, ticks: { color: PALETTE.dim, precision: 0, font: { size: 10 } } },
                },
              }} />
            </OpsChartBox>
            <div className="ops-text-dim ops-small" style={{ marginTop: 8 }}>
              Bucketed across the visible sample. Outlier-trimmed view shown when the toggle is on.
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="ops-toast">✓ {toast}</div>}
    </>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <div className="ops-stat-lbl">{label}</div>
      <div className="ops-stat-val">{value}</div>
      {sub ? <div className="ops-stat-sub">{sub}</div> : null}
    </div>
  )
}

function CustomerRow({ c }) {
  const avg = mean(c._deltas)
  const mdn = med(c._deltas)
  const p   = p90(c._deltas)
  const cls = avg > 45 ? 'ops-text-neg' : avg > 35 ? 'ops-text-warn' : ''
  const icon =
    c.trend === 'up'
      ? <span className="ops-text-neg" title="Worse — paying slower">▲</span>
      : c.trend === 'down'
        ? <span className="ops-text-pos" title="Better — paying faster">▼</span>
        : <span className="ops-text-dim">—</span>
  return (
    <tr>
      <td>
        {c.name}
        {c.active ? null : <span className="ops-text-dim ops-small" style={{ marginLeft: 6 }}>(inactive)</span>}
      </td>
      <td className="right">{c._deltas.length}</td>
      <td className="right">{fmt(c.paid)}</td>
      <td className={`right ${cls}`}>{Math.round(avg)} d</td>
      <td className="right">{Math.round(mdn)} d</td>
      <td className="right">{Math.round(p)} d</td>
      <td className="center">{icon}</td>
    </tr>
  )
}
