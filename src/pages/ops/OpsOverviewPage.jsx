import { Line } from 'react-chartjs-2'
import OpsKpiCard from '../../components/ops/OpsKpiCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmtK, fmt } from '../../lib/opsFormat'

// Overview page — Don asked to "remove all the KPIs that are there now
// and start fresh."  The headline KPI grid honors that: when kpis is
// empty (the default in live mode now), we render nothing for the top
// row.  The rest of the page (revenue/COGS/GP chart, callout cards) is
// computed from real data and stays.

export default function OpsOverviewPage() {
  const { kpis, pnl, jobs, arInvoices, cashflow } = useOpsData()

  const data = {
    labels: pnl.labels,
    datasets: [
      {
        label: 'Revenue', data: pnl.revenue,
        borderColor: PALETTE.blue, backgroundColor: 'rgba(111,168,255,0.10)',
        fill: true, tension: 0.3, borderWidth: 2,
      },
      {
        label: 'COGS', data: pnl.cogs,
        borderColor: PALETTE.red, backgroundColor: 'transparent',
        tension: 0.3, borderWidth: 2,
      },
      {
        label: 'GP', data: pnl.gp,
        borderColor: PALETTE.green, backgroundColor: 'transparent',
        tension: 0.3, borderWidth: 2,
      },
      {
        label: 'Revenue (PY)', data: pnl.priorRevenue || [],
        borderColor: 'rgba(255,255,255,0.35)', borderDash: [4, 4],
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5,
      },
    ],
  }

  const opts = moneyLineOpts({
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${fmtK(ctx.parsed.y)}`,
        },
      },
    },
  })

  // Top revenue job this month (live data: largest revenue contract job)
  const topJob = (jobs || [])
    .filter((j) => j.type !== 'service')
    .slice()
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0] || null

  // Oldest open AR invoice
  const oldestAr = (arInvoices || [])
    .slice()
    .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))[0] || null

  // Cash runway = current cash / avg weekly outflow over the 13-week forecast
  const avgOutflow = cashflow?.outflow?.length
    ? cashflow.outflow.reduce((s, v) => s + v, 0) / cashflow.outflow.length
    : 0
  const cashStart = cashflow?.cash?.[0] || 0
  const runwayWeeks = avgOutflow > 0 ? Math.round(cashStart / avgOutflow) : null

  return (
    <div>
      {/* KPI grid — empty by request.  Once the team picks the metrics
          they want, we'll either re-seed kpis or wire them through the
          KPIs tab. */}
      {kpis && kpis.length > 0 && (
        <div className="ops-kpi-grid">
          {kpis.map((k) => <OpsKpiCard key={k.id} kpi={k} />)}
        </div>
      )}

      <OpsSectionCard
        title="Revenue, COGS, GP — monthly"
        subtitle="Dashed line shows prior-year revenue for the same months."
      >
        <OpsChartBox size="lg">
          <Line data={data} options={opts} />
        </OpsChartBox>
      </OpsSectionCard>

      <div className="ops-grid-3">
        <OpsSectionCard title="Top job this month">
          {topJob ? (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)' }}>
                {topJob.name} ({topJob.num})
              </div>
              <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                {fmtK(topJob.revenue)} revenue · GP {Math.round(topJob.gpPct || 0)}%
              </div>
            </>
          ) : (
            <div className="ops-text-dim">—</div>
          )}
        </OpsSectionCard>
        <OpsSectionCard title="Cash vs burn">
          {runwayWeeks != null ? (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)' }}>
                {runwayWeeks} weeks runway
              </div>
              <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                At avg weekly outflow of {fmtK(avgOutflow)} over the next 13 weeks.
              </div>
            </>
          ) : (
            <div className="ops-text-dim">—</div>
          )}
        </OpsSectionCard>
        <OpsSectionCard title="Oldest A/R">
          {oldestAr ? (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }} className="ops-text-neg">
                INV-{oldestAr.invoice} — {oldestAr.ageDays} d
              </div>
              <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                {oldestAr.customer} · {fmt(oldestAr.balance)} balance
              </div>
            </>
          ) : (
            <div className="ops-text-dim">—</div>
          )}
        </OpsSectionCard>
      </div>
    </div>
  )
}
