import { Chart } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmtK, pct } from '../../lib/opsFormat'
import { PALETTE } from '../../lib/opsChartOpts'

export default function OpsPnlPage() {
  const { pnl } = useOpsData()

  // Combined chart — bars for Rev/COGS/Overhead, solid line for Net,
  // dashed line for GP %.  Unified index tooltip shows all of them plus
  // GP $ in the afterBody.
  const data = {
    labels: pnl.labels,
    datasets: [
      { type: 'bar',  label: 'Revenue',      data: pnl.revenue,  backgroundColor: PALETTE.blue,   yAxisID: 'y' },
      { type: 'bar',  label: 'COGS',         data: pnl.cogs,     backgroundColor: PALETTE.red,    yAxisID: 'y' },
      { type: 'bar',  label: 'Overhead',     data: pnl.overhead, backgroundColor: PALETTE.amber,  yAxisID: 'y' },
      { type: 'line', label: 'Net Profit',   data: pnl.net,      borderColor: PALETTE.purple,
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 2.5, yAxisID: 'y' },
      { type: 'line', label: 'GP Margin %',  data: pnl.gpPct,    borderColor: PALETTE.green,
        backgroundColor: 'transparent', borderDash: [4, 4], tension: 0.3, borderWidth: 2, yAxisID: 'y1' },
    ],
  }

  const AXIS = 'rgba(255,255,255,0.55)'
  const GRID = 'rgba(240,192,64,0.10)'

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top', align: 'end', labels: { color: 'rgba(255,255,255,0.85)', font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const label = ctx.dataset.label || ''
            const val   = ctx.parsed.y
            if (label.includes('%')) return `${label}: ${pct(val)}`
            return `${label}: ${fmtK(val)}`
          },
          afterBody: (items) => {
            const i = items[0]?.dataIndex ?? 0
            return `GP $: ${fmtK(pnl.gp[i])}`
          },
        },
      },
    },
    scales: {
      x:  { grid: { display: false }, ticks: { color: AXIS, font: { size: 10 } } },
      y:  {
        position: 'left',  grid: { color: GRID },
        ticks:    { color: AXIS, font: { size: 10 }, callback: (v) => fmtK(Number(v)) },
        title:    { display: true, text: '$', color: AXIS, font: { size: 10 } },
      },
      y1: {
        position: 'right', grid: { display: false },
        ticks:    { color: AXIS, font: { size: 10 }, callback: (v) => `${v}%` },
        suggestedMin: 0, suggestedMax: 35,
        title:    { display: true, text: '%', color: AXIS, font: { size: 10 } },
      },
    },
  }

  const totals = {
    rev:  pnl.revenue.reduce((a, b) => a + b, 0),
    cogs: pnl.cogs.reduce((a, b) => a + b, 0),
    gp:   pnl.gp.reduce((a, b) => a + b, 0),
    oh:   pnl.overhead.reduce((a, b) => a + b, 0),
    net:  pnl.net.reduce((a, b) => a + b, 0),
  }
  const gpPct  = (totals.gp  / totals.rev) * 100
  const netPct = (totals.net / totals.rev) * 100

  return (
    <div>
      <div className="ops-grid-5">
        <OpsSectionCard title="Revenue"><div className="ops-kpi-value">{fmtK(totals.rev)}</div></OpsSectionCard>
        <OpsSectionCard title="COGS"><div className="ops-kpi-value">{fmtK(totals.cogs)}</div></OpsSectionCard>
        <OpsSectionCard title="Gross Profit">
          <div className="ops-kpi-value">{fmtK(totals.gp)}</div>
          <div className="ops-small ops-text-dim">{pct(gpPct)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="Overhead"><div className="ops-kpi-value">{fmtK(totals.oh)}</div></OpsSectionCard>
        <OpsSectionCard title="Net Profit">
          <div className="ops-kpi-value">{fmtK(totals.net)}</div>
          <div className="ops-small ops-text-dim">{pct(netPct)}</div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title="Revenue, COGS, Overhead, Net Profit & GP %"
        subtitle="Hover any month — tooltip shows every series plus GP $ for the period."
      >
        <OpsChartBox size="lg">
          <Chart type="bar" data={data} options={opts} />
        </OpsChartBox>
      </OpsSectionCard>
    </div>
  )
}
