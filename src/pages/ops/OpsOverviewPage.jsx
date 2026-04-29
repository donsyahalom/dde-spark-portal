import { Line } from 'react-chartjs-2'
import OpsKpiCard from '../../components/ops/OpsKpiCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData, companyProductivity } from '../../hooks/useOpsData'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmtK } from '../../lib/opsFormat'

// Retainage due in the next 30 days — heuristic mock estimate.
//   pctCmp = 100 (Closed)     → full retainageHeld is due (final release)
//   pctCmp ≥ 95  (substantial)→ 50% of retainageHeld is due
//   pctCmp < 95               → none
// When Supabase is wired we'll read actual release dates off the job's
// release schedule + the job's closeout target date.
function retainageDueNext30d(jobs) {
  return jobs
    .filter((j) => j.type === 'contract')
    .reduce((sum, j) => {
      if (j.pctCmp >= 100 || j.status === 'Closed') return sum + (j.retainageHeld || 0)
      if (j.pctCmp >= 95) return sum + Math.round((j.retainageHeld || 0) * 0.5)
      return sum
    }, 0)
}

function totalRetainageHeld(jobs) {
  return jobs
    .filter((j) => j.type === 'contract')
    .reduce((sum, j) => sum + (j.retainageHeld || 0), 0)
}

// Compact money formatter — drops decimals, adds thousands separators
// and a leading $.  Handles null/undefined as an em-dash.
const fmt$ = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default function OpsOverviewPage() {
  const { kpis, pnl, jobs } = useOpsData()

  // 2nd row of Overview cards
  const prod       = companyProductivity(jobs)
  const heldTotal  = totalRetainageHeld(jobs)
  const dueSoon    = retainageDueNext30d(jobs)

  const data = {
    labels: pnl.labels,
    datasets: [
      {
        label: 'Revenue', data: pnl.revenue,
        borderColor: PALETTE.blue, backgroundColor: 'rgba(111,168,255,0.10)',
        fill: true, tension: 0.3, borderWidth: 2,
      },
      {
        label: 'Direct Cost', data: pnl.cogs,
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

  // Productivity colour: green if ≥ 1.00, amber 0.90–0.99, red < 0.90
  const prodColor =
    prod.productivity == null ? 'var(--white)'
    : prod.productivity >= 1.0 ? 'var(--pos)'
    : prod.productivity >= 0.9 ? 'var(--gold)'
    : 'var(--neg)'

  return (
    <div>
      <div className="ops-kpi-grid">
        {kpis.map((k) => <OpsKpiCard key={k.id} kpi={k} />)}
      </div>

      {/* 2nd row — operating health snapshot */}
      <div className="ops-grid-4">
        <OpsSectionCard title="Company productivity" subtitle="Earned hrs ÷ actual hrs, contract jobs only">
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: prodColor }}>
            {prod.productivity == null ? '—' : prod.productivity.toFixed(2)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            {prod.earnedHrs.toLocaleString()} earned / {prod.actualHrs.toLocaleString()} actual · {prod.jobCount} jobs
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Revenue per field hour" subtitle="Contract revenue ÷ actual labor hrs">
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--white)' }}>
            {prod.revenuePerHour == null ? '—' : `$${prod.revenuePerHour.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Blended across all contract work
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Retainage held" subtitle="Total contract retention outstanding">
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--white)' }}>
            {fmt$(heldTotal)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Across {jobs.filter((j) => j.type === 'contract' && (j.retainageHeld || 0) > 0).length} contract jobs
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Retainage due — next 30 days" subtitle="Releases scheduled at 95% / 100% cmp">
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: dueSoon > 0 ? 'var(--gold)' : 'var(--white)' }}>
            {fmt$(dueSoon)}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
            Based on current % complete
          </div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title="Revenue, Direct Cost, GP — monthly"
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
