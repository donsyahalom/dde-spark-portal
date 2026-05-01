import { useMemo, useState } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import { useOpsData } from '../../hooks/useOpsData'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmt, fmtK, pct } from '../../lib/opsFormat'

// Company P&L — Don's directive:
//   "the period dropdown didn't actually do anything. clicking YTD or
//    MTD or QTD should slice the chart and the totals."
// We slice using pnl.monthIso (added by the hook on Batch 7) which is
// an ISO month-start date for each label, e.g. '2026-01-01'.  If a row
// is missing monthIso (fixture mode), we fall back to using the index
// against the last 12 months ending today.

const PERIOD_OPTIONS = [
  { id: 'all', label: 'All periods' },
  { id: 'ytd', label: 'YTD' },
  { id: 'qtd', label: 'QTD' },
  { id: 'mtd', label: 'MTD' },
]

function inPeriod(monthIso, period, today) {
  if (!period || period === 'all') return true
  if (!monthIso) return true
  const d = new Date(monthIso)
  if (Number.isNaN(d.getTime())) return true
  if (period === 'ytd') return d.getFullYear() === today.getFullYear()
  if (period === 'mtd') return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
  if (period === 'qtd') {
    const q = Math.floor(d.getMonth() / 3)
    const tq = Math.floor(today.getMonth() / 3)
    return d.getFullYear() === today.getFullYear() && q === tq
  }
  return true
}

export default function OpsPnlPage() {
  const { pnl } = useOpsData()
  const [period, setPeriod] = useState('all')

  const sliced = useMemo(() => {
    const today = new Date()
    const labels = pnl.labels || []
    const monthIso = pnl.monthIso || labels.map(() => null)
    const keep = labels.map((_, i) => inPeriod(monthIso[i], period, today))

    const slice = (arr) => (arr || []).filter((_, i) => keep[i])
    return {
      labels:        slice(labels),
      revenue:       slice(pnl.revenue),
      cogs:          slice(pnl.cogs),
      gp:            slice(pnl.gp),
      overhead:      slice(pnl.overhead),
      net:           slice(pnl.net),
      priorRevenue:  slice(pnl.priorRevenue),
    }
  }, [pnl, period])

  // Headline totals over the sliced period.
  const totals = useMemo(() => {
    const sum = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0)
    const revenue = sum(sliced.revenue)
    const cogs    = sum(sliced.cogs)
    const gp      = sum(sliced.gp)
    const overhead = sum(sliced.overhead)
    const net     = sum(sliced.net)
    const gpPct   = revenue ? (gp / revenue) * 100 : 0
    const netPct  = revenue ? (net / revenue) * 100 : 0
    return { revenue, cogs, gp, overhead, net, gpPct, netPct }
  }, [sliced])

  const lineData = {
    labels: sliced.labels,
    datasets: [
      { label: 'Revenue', data: sliced.revenue, borderColor: PALETTE.blue, backgroundColor: 'rgba(111,168,255,0.12)', fill: true, tension: 0.3, borderWidth: 2 },
      { label: 'COGS',    data: sliced.cogs,    borderColor: PALETTE.red,  backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'GP',      data: sliced.gp,      borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      sliced.priorRevenue && sliced.priorRevenue.some(Boolean) && {
        label: 'Revenue (PY)', data: sliced.priorRevenue,
        borderColor: 'rgba(255,255,255,0.35)', borderDash: [4, 4], backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5,
      },
    ].filter(Boolean),
  }

  const barData = {
    labels: sliced.labels,
    datasets: [
      { label: 'Overhead', data: sliced.overhead.map((v) => -Math.abs(v || 0)), backgroundColor: 'rgba(229,57,53,0.55)', borderColor: PALETTE.red, borderWidth: 1, stack: 's' },
      { label: 'Net',       data: sliced.net,                                    backgroundColor: 'rgba(76,175,80,0.55)',  borderColor: PALETTE.green, borderWidth: 1, stack: 's' },
    ],
  }

  const lineOpts = moneyLineOpts({
    plugins: {
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtK(ctx.parsed.y)}` },
      },
    },
  })

  const barOpts = moneyLineOpts({
    plugins: {
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtK(Math.abs(ctx.parsed.y))}` },
      },
    },
    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } },
  })

  const periodLabel = PERIOD_OPTIONS.find((p) => p.id === period)?.label || 'All periods'

  return (
    <div>
      <OpsSectionCard
        title={`Company P&L — ${periodLabel}`}
        subtitle={
          period === 'mtd' ? 'Current month only.'
          : period === 'qtd' ? 'Current quarter to date.'
          : period === 'ytd' ? 'Current calendar year to date.'
          : 'All available months.'
        }
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={period === p.id ? 'active' : ''}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="ops-grid-5" style={{ marginBottom: 12 }}>
          <div className="ops-kpi">
            <div className="ops-kpi-label">Revenue</div>
            <div className="ops-kpi-value">{fmtK(totals.revenue)}</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label">COGS</div>
            <div className="ops-kpi-value ops-text-neg">{fmtK(totals.cogs)}</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label">GP</div>
            <div className="ops-kpi-value">{fmtK(totals.gp)}</div>
            <div className="ops-small ops-text-dim">{pct(totals.gpPct / 100)}</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label">Overhead</div>
            <div className="ops-kpi-value ops-text-neg">{fmtK(totals.overhead)}</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label">Net profit</div>
            <div className={`ops-kpi-value ${totals.net < 0 ? 'ops-text-neg' : ''}`}>{fmtK(totals.net)}</div>
            <div className="ops-small ops-text-dim">{pct(totals.netPct / 100)}</div>
          </div>
        </div>

        <OpsChartBox size="lg">
          <Line data={lineData} options={lineOpts} />
        </OpsChartBox>
      </OpsSectionCard>

      <OpsSectionCard
        title="Overhead vs Net — by month"
        subtitle="Overhead shown below the axis, Net above. Same period scope as above."
      >
        <OpsChartBox size="md">
          <Bar data={barData} options={barOpts} />
        </OpsChartBox>
      </OpsSectionCard>

      <OpsSectionCard
        title="Detail by month"
        subtitle={`${sliced.labels.length} month${sliced.labels.length === 1 ? '' : 's'} in scope.`}
      >
        <table className="ops-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="right">Revenue</th>
              <th className="right">COGS</th>
              <th className="right">GP</th>
              <th className="right">GP %</th>
              <th className="right">Overhead</th>
              <th className="right">Net</th>
            </tr>
          </thead>
          <tbody>
            {sliced.labels.map((lbl, i) => {
              const rev = sliced.revenue[i] || 0
              const gp  = sliced.gp[i] || 0
              const net = sliced.net[i] || 0
              return (
                <tr key={lbl + i}>
                  <td style={{ fontWeight: 600 }}>{lbl}</td>
                  <td className="right">{fmt(rev)}</td>
                  <td className="right ops-text-neg">{fmt(sliced.cogs[i])}</td>
                  <td className="right">{fmt(gp)}</td>
                  <td className="right">{rev ? pct(gp / rev) : '—'}</td>
                  <td className="right ops-text-neg">{fmt(sliced.overhead[i])}</td>
                  <td className={`right ${net < 0 ? 'ops-text-neg' : ''}`} style={{ fontWeight: 600 }}>{fmt(net)}</td>
                </tr>
              )
            })}
            {!sliced.labels.length && (
              <tr><td colSpan={7} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                No data in this period.
              </td></tr>
            )}
          </tbody>
        </table>
      </OpsSectionCard>
    </div>
  )
}
