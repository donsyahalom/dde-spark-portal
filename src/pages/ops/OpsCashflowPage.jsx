import { Bar } from 'react-chartjs-2'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import { useOpsData } from '../../hooks/useOpsData'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmt, fmtK } from '../../lib/opsFormat'

// Cashflow page — Don's directives:
//   1. "those bank accounts you put there are not the ones we have. how
//       did you decide which ones to put?" → we now read the real cash
//       accounts from the Sage GL via ops.gl_cash_accounts (Sage account
//       numbers 1000–1199 plus name match on cash/bank/checking).
//   2. "wk13 doesn't show real data" → ops.cashflow_weekly now buckets
//       by *actual* due date with ceil((due - today) / 7) and the hook
//       clips to weeks 1..13.  Anything farther out is dropped (not
//       rolled into wk13) so the column reflects only its own week.

export default function OpsCashflowPage() {
  const { cashflow, cashAccounts } = useOpsData()

  // Build the chart data: stacked bar of inflow / outflow with cash line.
  const data = {
    labels: cashflow.labels,
    datasets: [
      {
        label: 'Inflow',
        data: cashflow.inflow,
        backgroundColor: 'rgba(76,175,80,0.55)',
        borderColor: PALETTE.green,
        borderWidth: 1,
        stack: 'flow',
        type: 'bar',
      },
      {
        label: 'Outflow',
        data: cashflow.outflow.map((v) => -Math.abs(v)),
        backgroundColor: 'rgba(229,57,53,0.55)',
        borderColor: PALETTE.red,
        borderWidth: 1,
        stack: 'flow',
        type: 'bar',
      },
      {
        label: 'Cash on hand',
        data: cashflow.cash,
        borderColor: PALETTE.blue,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.3,
        type: 'line',
        yAxisID: 'y',
      },
    ],
  }

  const opts = moneyLineOpts({
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${fmtK(Math.abs(ctx.parsed.y))}`,
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: false },
    },
  })

  // Bank account cards — real GL cash accounts from Sage.  No more
  // hard-coded "Chase 1234, M&T 9912" placeholders.
  const accounts = cashAccounts || []
  const totalCash = accounts.reduce((a, b) => a + (b.balance || 0), 0)

  return (
    <div>
      <div className="ops-grid-4">
        <OpsSectionCard title="Cash on hand">
          <div className="ops-kpi-value">{fmt(totalCash)}</div>
          <div className="ops-small ops-text-dim">
            Across {accounts.length || 0} GL cash account{accounts.length === 1 ? '' : 's'}
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Inflow (next 13w)">
          <div className="ops-kpi-value">
            {fmt((cashflow.inflow || []).reduce((a, b) => a + b, 0))}
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Outflow (next 13w)">
          <div className="ops-kpi-value ops-text-neg">
            {fmt((cashflow.outflow || []).reduce((a, b) => a + b, 0))}
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Net (next 13w)">
          <div className="ops-kpi-value">
            {fmt(
              (cashflow.inflow || []).reduce((a, b) => a + b, 0) -
              (cashflow.outflow || []).reduce((a, b) => a + b, 0)
            )}
          </div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title="13-week forecast"
        subtitle="Inflows from open A/R receipts; outflows from A/P due dates and payroll. Real Sage data — no synthetic wk13 fill."
      >
        <OpsChartBox size="lg">
          <Bar data={data} options={opts} />
        </OpsChartBox>
      </OpsSectionCard>

      <OpsSectionCard
        title="Bank accounts"
        subtitle={
          accounts.length === 0
            ? 'No GL cash accounts found. Patch_features.sql needs to be applied, or the account-number / name heuristic missed them.'
            : 'Auto-detected from Sage GL (account numbers 1000–1199 or names matching cash / bank / checking).'
        }
      >
        {accounts.length === 0 ? (
          <div className="ops-text-dim ops-small" style={{ padding: '12px 0' }}>
            No accounts to show. Once patch_features.sql is applied, this list will populate
            automatically from <code>ops.gl_cash_accounts</code>.
          </div>
        ) : (
          <table className="ops-table">
            <thead>
              <tr>
                <th>Account #</th>
                <th>Name</th>
                <th className="right">Balance</th>
                <th className="right">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.accountNumber || a.label}>
                  <td>{a.accountNumber || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{a.label}</td>
                  <td className="right" style={{ fontWeight: 600 }}>{fmt(a.balance || 0)}</td>
                  <td className="right ops-text-dim">{a.lastActivity || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </OpsSectionCard>
    </div>
  )
}
