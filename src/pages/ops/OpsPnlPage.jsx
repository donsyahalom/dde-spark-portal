import { Chart } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK, pct } from '../../lib/opsFormat'
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

  const AXIS = 'rgba(255,255,255,0.82)'
  const GRID = 'rgba(240,192,64,0.14)'

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top', align: 'end', labels: { color: 'rgba(255,255,255,0.95)', font: { size: 11 } } },
      tooltip: {
        // Render a single, explicitly-ordered body so the reader sees
        // Revenue → COGS → GP $ → GP margin % → Overhead → Net Profit
        // regardless of dataset order or chart type.
        displayColors: false,
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex !== 0) return null
            const i = ctx.dataIndex
            return [
              `Revenue:     ${fmtK(pnl.revenue[i])}`,
              `COGS:        ${fmtK(pnl.cogs[i])}`,
              `GP $:        ${fmtK(pnl.gp[i])}`,
              `GP margin %: ${pct(pnl.gpPct[i])}`,
              `Overhead:    ${fmtK(pnl.overhead[i])}`,
              `Net Profit:  ${fmtK(pnl.net[i])}`,
            ]
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

      <OpsSectionCard
        title="Monthly detail"
        subtitle="Same period as the chart above — revenue, COGS, labor burden (inside COGS), gross profit, overhead, net profit."
      >
        <table className="ops-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="right">Revenue</th>
              <th className="right">COGS</th>
              <th className="right">Burden</th>
              <th className="right">Gross Profit</th>
              <th className="right">GP %</th>
              <th className="right">Overhead</th>
              <th className="right">Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {pnl.labels.map((m, i) => (
              <tr key={m}>
                <td>{m}</td>
                <td className="right">{fmt(pnl.revenue[i])}</td>
                <td className="right">{fmt(pnl.cogs[i])}</td>
                <td className="right ops-text-dim">{fmt(pnl.burden[i])}</td>
                <td className="right">{fmt(pnl.gp[i])}</td>
                <td className="right">{pct(pnl.gpPct[i])}</td>
                <td className="right">{fmt(pnl.overhead[i])}</td>
                <td className={`right ${pnl.net[i] >= 0 ? 'ops-text-pos' : 'ops-text-neg'}`}>{fmt(pnl.net[i])}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border-bright)', fontWeight: 700 }}>
              <td>Total</td>
              <td className="right">{fmt(totals.rev)}</td>
              <td className="right">{fmt(totals.cogs)}</td>
              <td className="right ops-text-dim">{fmt(pnl.burden.reduce((a, b) => a + b, 0))}</td>
              <td className="right">{fmt(totals.gp)}</td>
              <td className="right">{pct(gpPct)}</td>
              <td className="right">{fmt(totals.oh)}</td>
              <td className={`right ${totals.net >= 0 ? 'ops-text-pos' : 'ops-text-neg'}`}>{fmt(totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </OpsSectionCard>
    </div>
  )
}
