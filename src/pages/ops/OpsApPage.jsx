import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK } from '../../lib/opsFormat'

const BUCKETS = [
  { label: 'Current', min: 0,  max: 0    },
  { label: '1 – 30',  min: 1,  max: 30   },
  { label: '31 – 60', min: 31, max: 60   },
  { label: '61 – 90', min: 61, max: 90   },
  { label: '90+',     min: 91, max: 9999 },
]

export default function OpsApPage() {
  const { apInvoices } = useOpsData()

  const sums = BUCKETS.map((b) =>
    apInvoices.filter((i) => i.ageDays >= b.min && i.ageDays <= b.max).reduce((a, i) => a + i.balance, 0),
  )

  return (
    <div>
      <div className="ops-grid-5">
        {BUCKETS.map((b, i) => (
          <OpsSectionCard key={b.label} title={b.label}>
            <div className="ops-kpi-value">{fmtK(sums[i])}</div>
          </OpsSectionCard>
        ))}
      </div>

      <OpsSectionCard title="Open A/P">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Invoice</th>
              <th>Job</th>
              <th>Due date</th>
              <th className="right">Total</th>
              <th className="right">Balance</th>
              <th className="right">Age</th>
            </tr>
          </thead>
          <tbody>
            {apInvoices.map((r) => (
              <tr key={r.vendor + r.invoice}>
                <td style={{ fontWeight: 600 }}>{r.vendor}</td>
                <td>{r.invoice}</td>
                <td>{r.job}</td>
                <td>{r.dueDate}</td>
                <td className="right">{fmt(r.total)}</td>
                <td className="right" style={{ fontWeight: 600 }}>{fmt(r.balance)}</td>
                <td className="right">{r.ageDays} d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </OpsSectionCard>
    </div>
  )
}
