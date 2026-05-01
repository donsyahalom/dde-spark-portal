import { Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { useOpsCashflowBasis } from '../../context/OpsCashflowBasisContext'
import { fmtK } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'

export default function OpsCashflowPage() {
  const { cashflow } = useOpsData()
  const { basis, setBasis, appliedSummary, fallbackAvg } = useOpsCashflowBasis()

  const data = {
    labels: cashflow.weeks,
    datasets: [
      { label: 'Cash',    data: cashflow.cash,    borderColor: PALETTE.blue,  backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'Inflow',  data: cashflow.inflow,  borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'Outflow', data: cashflow.outflow, borderColor: PALETTE.red,   backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
    ],
  }

  const opts = moneyLineOpts()

  return (
    <div>
      <BasisBanner />

      <div className="ops-grid-3">
        <OpsSectionCard title="Operating — Chase 1234">
          <div className="ops-kpi-value">$847,234</div>
          <div className="ops-small ops-text-dim">as of sync 2h ago</div>
        </OpsSectionCard>
        <OpsSectionCard title="Payroll — Chase 5678">
          <div className="ops-kpi-value">$412,100</div>
        </OpsSectionCard>
        <OpsSectionCard title="Savings — M&amp;T 9912">
          <div className="ops-kpi-value">$250,000</div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title="13-week cashflow forecast"
        right={
          <div className="ops-toolbar">
            <span className="ops-stat-lbl">Forecast timing</span>
            <select className="ops-select" value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="due">Invoice due dates</option>
              <option value="payhist">Payment history</option>
              <option value="blended">Blended (50 / 50)</option>
            </select>
          </div>
        }
      >
        <OpsChartBox size="lg">
          <Line data={data} options={opts} />
        </OpsChartBox>
        {basis !== 'due' && appliedSummary && (
          <div className="ops-small ops-text-dim" style={{ marginTop: 10 }}>
            {appliedSummary.customers} customers mapped from payment history · median {Math.round(appliedSummary.median)}d ·
            range {Math.round(appliedSummary.min)}–{Math.round(appliedSummary.max)}d ·
            fallback {Math.round(fallbackAvg ?? 0)}d.
          </div>
        )}
      </OpsSectionCard>

      <div className="ops-grid-2">
        <OpsSectionCard
          title="Expected inflows"
          subtitle={<span>A/R bucketed by invoice <em>due date</em></span>}
        >
          <div>
            <Row label="Next 14 days" value={fmtK(412839)} />
            <Row label="15 – 30 days" value={fmtK(127204)} />
            <Row label="31 – 60 days" value={fmtK(198142)} />
            <Row label="61 – 90 days" value={fmtK(92100)}  strong />
            <Row label="> 90 days"    value={fmtK(84300)}  strong />
          </div>
        </OpsSectionCard>
        <OpsSectionCard
          title="Expected outflows"
          subtitle={<span>A/P bucketed by vendor <em>due date</em></span>}
        >
          <div>
            <Row label="Next 14 days" value={fmtK(298400)} />
            <Row label="15 – 30 days" value={fmtK(182200)} />
            <Row label="31 – 60 days" value={fmtK(201800)} />
            <Row label="Payroll (bi-weekly)" value={fmtK(348000)} />
            <Row label="Bond/insurance" value={fmtK(62000)} />
          </div>
        </OpsSectionCard>
      </div>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="ops-text-dim ops-small">{label}</span>
      <span style={{ fontWeight: strong ? 700 : 500, color: strong ? 'var(--gold)' : 'var(--white)' }}>{value}</span>
    </div>
  )
}

function BasisBanner() {
  const { basis, appliedSummary, fallbackAvg } = useOpsCashflowBasis()
  let cls = 'warn'
  let body = (
    <span>
      <strong>Forecast basis.</strong> All A/R and A/P inflows and outflows on this page are projected from <em>invoice due dates</em> — not expected-payment dates or payment history.
      Customers may pay early or late relative to due date; use these as the contractual baseline, not a precise cash-timing model.
    </span>
  )

  if (basis === 'payhist') {
    cls = 'info'
    const fb = Math.round(fallbackAvg ?? 0)
    body = appliedSummary ? (
      <span>
        <strong>Payment-history basis — per customer.</strong> {appliedSummary.customers} customers are shifted by their own observed avg days-to-pay
        (median {Math.round(appliedSummary.median)}d, range {Math.round(appliedSummary.min)}–{Math.round(appliedSummary.max)}d).
        Customers outside that sample fall back to the portfolio avg of {fb}d. A/P outflows still use vendor due dates.
      </span>
    ) : (
      <span>
        <strong>Payment-history basis — per customer.</strong> Each A/R invoice is shifted by that customer's own avg days-to-pay.
        Click <em>Apply to Cashflow</em> on the A/R tab to snapshot the current Top-N sample.
      </span>
    )
  } else if (basis === 'blended') {
    cls = 'blend'
    body = (
      <span>
        <strong>Blended basis — per customer.</strong> A/R timing is a 50/50 blend of invoice due dates and each customer's own payment history
        {appliedSummary ? ` (${appliedSummary.customers} customers mapped, fallback ${Math.round(fallbackAvg ?? 0)}d for the rest)` : ''}.
      </span>
    )
  }

  return (
    <div className={`ops-banner ${cls}`}>
      <span style={{ marginTop: 2 }}>⚠</span>
      {body}
    </div>
  )
}
