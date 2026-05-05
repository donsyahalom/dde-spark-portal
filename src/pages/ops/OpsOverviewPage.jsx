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

export default function OpsOverviewPage() {
  const { kpis, pnl, jobs, arInvoices, loading: _opsLoading } = useOpsData()
  const { period } = useOpsViewState()

  // ── Period-filtered pnl (same logic as OpsPnlPage) ─────────────────
  const filteredPnl = useMemo(() => {
    if (!pnl.labels.length) return pnl
    const now = new Date()
    const curMonth = now.getMonth() + 1
    const curQ = Math.ceil(curMonth / 3)

    let keepIndices = pnl.labels.map((_, i) => i)

    if (period === 'mtd') {
      keepIndices = [pnl.labels.length - 1]
    } else if (period === 'qtd') {
      const qStart = (curQ - 1) * 3 + 1
      keepIndices = pnl.labels.reduce((acc, label, i) => {
        const mIdx = MONTH_ABBR.findIndex((m) => label.startsWith(m))
        const mNum = mIdx >= 0 ? mIdx + 1 : null
        if (mNum && mNum >= qStart && mNum <= curMonth) acc.push(i)
        return acc
      }, [])
      if (!keepIndices.length) keepIndices = pnl.labels.map((_, i) => i).slice(-3)
    }

    const slice = (arr) => keepIndices.map((i) => (arr || [])[i] ?? 0)
    return {
      ...pnl,
      labels:       keepIndices.map((i) => pnl.labels[i]),
      revenue:      slice(pnl.revenue),
      cogs:         slice(pnl.cogs),
      gp:           slice(pnl.gp),
      priorRevenue: slice(pnl.priorRevenue || []),
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
        title={`Revenue, Direct Cost, GP — ${period === 'mtd' ? 'MTD' : period === 'qtd' ? 'QTD' : 'YTD'}`}
        subtitle="Dashed line shows prior-year revenue for the same months."
      >
        <OpsChartBox size="lg">
          <Line data={data} options={opts} />
        </OpsChartBox>
      </OpsSectionCard>
    </div>
  )
}
