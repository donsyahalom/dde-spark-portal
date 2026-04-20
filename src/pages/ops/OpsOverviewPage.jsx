import { Line } from 'react-chartjs-2'
import OpsKpiCard from '../../components/ops/OpsKpiCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmtK } from '../../lib/opsFormat'

export default function OpsOverviewPage() {
  const { kpis, pnl } = useOpsData()

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

  return (
    <div>
      <div className="ops-kpi-grid">
        {kpis.map((k) => <OpsKpiCard key={k.id} kpi={k} />)}
      </div>

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
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)' }}>Hartford Municipal (2544)</div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>+$312K revenue, GP 18%</div>
        </OpsSectionCard>
        <OpsSectionCard title="Cash vs burn">
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)' }}>22 weeks runway</div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>At current avg weekly outflow.</div>
        </OpsSectionCard>
        <OpsSectionCard title="Oldest A/R">
          <div style={{ fontSize: '0.95rem', fontWeight: 700 }} className="ops-text-neg">INV-9766 — 113 d</div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>Sage Park Apts C · $21,400 balance</div>
        </OpsSectionCard>
      </div>
    </div>
  )
}
