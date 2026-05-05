import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import OpsKpiCard from '../../components/ops/OpsKpiCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData, companyProductivity } from '../../hooks/useOpsData'
import { useOpsViewState } from '../../context/OpsViewStateContext'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmtK } from '../../lib/opsFormat'

const fmt$ = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Shared period filter — returns indices from pnl.monthDates to keep.
function pnlKeepIndices(monthDates, labels, period) {
  const now      = new Date()
  const curYear  = now.getFullYear()
  const curMonth = now.getMonth() + 1
  const curQ     = Math.ceil(curMonth / 3)
  const qStart   = (curQ - 1) * 3 + 1
  const n        = labels.length

  const byDate = (fn) =>
    (monthDates || []).reduce((acc, d, i) => {
      if (!d) { acc.push(i); return acc }
      if (fn(new Date(d))) acc.push(i)
      return acc
    }, [])

  const fallback = (arr) => arr.length ? arr : labels.map((_, i) => i)

  switch (period) {
    case 'mtd':
      return fallback(byDate((d) =>
        d.getFullYear() === curYear && d.getMonth() + 1 === curMonth))

    case 'qtd':
      return fallback(byDate((d) => {
        const m = d.getMonth() + 1
        return d.getFullYear() === curYear && m >= qStart && m <= curMonth
      }))

    case 'ytd':
      return fallback(byDate((d) => d.getFullYear() === curYear))

    case 'ttm': {
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1)
      return fallback(byDate((d) => d >= cutoff))
    }

    case 'last_month': {
      const lm = curMonth === 1 ? 12 : curMonth - 1
      const ly = curMonth === 1 ? curYear - 1 : curYear
      return fallback(byDate((d) => d.getFullYear() === ly && d.getMonth() + 1 === lm))
    }

    case 'last_quarter': {
      const lq      = curQ === 1 ? 4 : curQ - 1
      const ly      = curQ === 1 ? curYear - 1 : curYear
      const lqStart = (lq - 1) * 3 + 1
      const lqEnd   = lq * 3
      return fallback(byDate((d) => {
        const m = d.getMonth() + 1
        return d.getFullYear() === ly && m >= lqStart && m <= lqEnd
      }))
    }

    case 'last_year':
      return fallback(byDate((d) => d.getFullYear() === curYear - 1))

    default:
      return labels.map((_, i) => i)  // custom / unknown: show all
  }
}

const PERIOD_LABELS = {
  mtd: 'MTD', qtd: 'QTD', ytd: 'YTD',
  ttm: 'Trailing 12M', last_month: 'Last month',
  last_quarter: 'Last quarter', last_year: 'Last year',
  custom: 'Custom',
}

export default function OpsOverviewPage() {
  const { kpis, pnl, jobs, arInvoices, loading: _opsLoading } = useOpsData()
  const { period } = useOpsViewState()

  // ── Period-filtered pnl ─────────────────────────────────────────────
  const filteredPnl = useMemo(() => {
    if (!pnl.labels.length) return pnl

    const keepIndices = pnlKeepIndices(pnl.monthDates, pnl.labels, period)
    const slice = (arr) => keepIndices.map((i) => (arr || [])[i] ?? 0)
    return {
      ...pnl,
      labels:       keepIndices.map((i) => pnl.labels[i]),
      revenue:      slice(pnl.revenue),
      cogs:         slice(pnl.cogs),
      burden:       slice(pnl.burden),
      gp:           slice(pnl.gp),
      priorRevenue: slice(pnl.priorRevenue || []),
      goalRevenue:  slice(pnl.goalRevenue  || []),
    }
  }, [pnl, period])

  // ── Retainage from live arInvoices (isRetainage flag) ──────────────
  // These are invoices where balance = retainage holdback — the true
  // outstanding retainage we expect to collect at project closeout.
  const retainageInvoices = useMemo(
    () => (arInvoices || []).filter((i) => i.isRetainage),
    [arInvoices],
  )
  const heldTotal = useMemo(
    () => retainageInvoices.reduce((s, i) => s + (i.balance || 0), 0),
    [retainageInvoices],
  )
  // "Due soon" — retainage on jobs at 95%+ complete or Closed status
  const dueSoon = useMemo(() => {
    const retainageJobNums = new Set(retainageInvoices.map((i) => i.job))
    return (jobs || [])
      .filter((j) => j.type === 'contract')
      .filter((j) => {
        // Match job to its retainage invoices via job field
        const hasRetainage = retainageInvoices.some((i) => i.job?.includes(j.num) || j.name === i.customer)
        return hasRetainage && (j.pctCmp >= 95 || j.status === 'Closed' || j.status === 'Complete')
      })
      .reduce((sum, j) => {
        const jobRetainage = retainageInvoices
          .filter((i) => i.job?.includes(j.num) || j.name === i.customer)
          .reduce((s, i) => s + (i.balance || 0), 0)
        return sum + jobRetainage
      }, 0)
  }, [retainageInvoices, jobs])

  // ── Productivity ────────────────────────────────────────────────────
  const prod = useMemo(() => companyProductivity(jobs || []), [jobs])

  const prodColor =
    prod.productivity == null ? 'var(--white)'
    : prod.productivity >= 1.0 ? 'var(--pos)'
    : prod.productivity >= 0.9 ? 'var(--gold)'
    : 'var(--neg)'

  // ── Chart ───────────────────────────────────────────────────────────
  const data = {
    labels: filteredPnl.labels,
    datasets: [
      { label: 'Revenue',     data: filteredPnl.revenue, borderColor: PALETTE.blue,
        backgroundColor: 'rgba(111,168,255,0.10)', fill: true, tension: 0.3, borderWidth: 2 },
      { label: 'Direct Cost', data: filteredPnl.cogs,    borderColor: PALETTE.red,
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'GP',          data: filteredPnl.gp,      borderColor: PALETTE.green,
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'Revenue (PY)', data: filteredPnl.priorRevenue,
        borderColor: 'rgba(255,255,255,0.35)', borderDash: [4, 4],
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5 },
    ],
  }
  const opts = moneyLineOpts({
    plugins: { tooltip: { callbacks: {
      label: (ctx) => `${ctx.dataset.label}: ${fmtK(ctx.parsed.y)}`,
    }}},
  })

  if (_opsLoading) return <div style={{ padding: '40px 20px', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', textAlign: 'center' }}>Loading data…</div>

  return (
    <div>
      <div className="ops-kpi-grid">
        {kpis.map((k) => <OpsKpiCard key={k.id} kpi={k} />)}
      </div>

      {/* Operating health snapshot */}
      <div className="ops-grid-4">
        <OpsSectionCard title="Company productivity" subtitle="Earned hrs ÷ actual hrs · contract jobs">
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: prodColor }}>
            {prod.productivity == null ? '—' : prod.productivity.toFixed(2)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            {prod.earnedHrs.toLocaleString()} earned / {prod.actualHrs.toLocaleString()} actual · {prod.jobCount} jobs
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Revenue per field hour" subtitle="Contract revenue ÷ actual labor hrs">
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
            {prod.revenuePerHour == null ? '—' : `$${prod.revenuePerHour.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>Blended across all contract work</div>
        </OpsSectionCard>

        <OpsSectionCard
          title="Retainage held"
          subtitle={`${retainageInvoices.length} open retainage invoices`}
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{fmt$(heldTotal)}</div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Outstanding retainage from billed invoices
          </div>
        </OpsSectionCard>

        <OpsSectionCard
          title="Retainage — near release"
          subtitle="Jobs ≥ 95% complete or closed"
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: dueSoon > 0 ? 'var(--gold)' : 'var(--white)' }}>
            {fmt$(dueSoon || 0)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Based on % complete on active jobs
          </div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title={`Revenue, Direct Cost, GP — ${PERIOD_LABELS[period] || 'All data'}`}
        subtitle="Dashed line shows prior-year revenue for the same months."
      >
        <OpsChartBox size="lg">
          <Line data={data} options={opts} />
        </OpsChartBox>
      </OpsSectionCard>
    </div>
  )
}
