import { useMemo, useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsPaymentHistory from '../../components/ops/OpsPaymentHistory'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK } from '../../lib/opsFormat'

// A/R page — Don asked for collapsible sections (so the page doesn't
// scroll forever) and a contract/service toggle on the payment-history
// section that defaults to Contract.

const BUCKETS = [
  { label: 'Current', min: 0,  max: 30 },
  { label: '1 – 30',  min: 1,  max: 30 },
  { label: '31 – 60', min: 31, max: 60 },
  { label: '61 – 90', min: 61, max: 90 },
  { label: '90+',     min: 91, max: 9999 },
]

// Reusable collapsible card.  Click the title row to toggle the body.
function CollapsibleSection({ title, subtitle, right, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <OpsSectionCard
      title={
        <span
          onClick={() => setOpen((v) => !v)}
          style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span className="ops-text-dim ops-small">{open ? '▾' : '▸'}</span>
          {title}
        </span>
      }
      subtitle={open ? subtitle : null}
      right={open ? right : null}
    >
      {open && children}
    </OpsSectionCard>
  )
}

export default function OpsArPage() {
  const { arInvoices } = useOpsData()
  const [arType, setArType] = useState('contract')   // 'contract' | 'service' | 'all'

  // The view layer projects type as 'AR' (contract) or 'SR' (service).
  const filtered = useMemo(() => {
    if (arType === 'all') return arInvoices
    const want = arType === 'contract' ? 'AR' : 'SR'
    return arInvoices.filter((i) => (i.type || 'AR') === want)
  }, [arInvoices, arType])

  const sums = BUCKETS.map((b) =>
    filtered.filter((i) => i.ageDays >= b.min && i.ageDays <= b.max).reduce((a, i) => a + i.balance, 0),
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

      <CollapsibleSection
        title="Open A/R"
        subtitle={
          arType === 'contract' ? 'Contract receivables only.'
          : arType === 'service' ? 'Service receivables only.'
          : 'Combined receivables (contract + service).'
        }
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle">
              <button onClick={() => setArType('contract')} className={arType === 'contract' ? 'active' : ''}>Contract</button>
              <button onClick={() => setArType('service')}  className={arType === 'service'  ? 'active' : ''}>Service</button>
              <button onClick={() => setArType('all')}      className={arType === 'all'      ? 'active' : ''}>All</button>
            </div>
          </div>
        }
      >
        <table className="ops-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Invoice</th>
              <th>Job</th>
              <th>Inv date</th>
              <th>Due date</th>
              <th className="right">Total</th>
              <th className="right">Balance</th>
              <th className="right">Age</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const ageCls = r.ageDays > 90 ? 'ops-text-neg' : r.ageDays > 60 ? 'ops-text-warn' : ''
              return (
                <tr key={r.recnum || r.invoice}>
                  <td><span className={`chip ${r.type === 'SR' ? 'hold' : 'active'}`}>{r.type || 'AR'}</span></td>
                  <td>{r.invoice}</td>
                  <td>{r.job}</td>
                  <td>{r.invDate}</td>
                  <td>{r.dueDate}</td>
                  <td className="right">{fmt(r.total)}</td>
                  <td className="right" style={{ fontWeight: 600 }}>{fmt(r.balance)}</td>
                  <td className={`right ${ageCls}`}>{r.ageDays} d</td>
                </tr>
              )
            })}
            {!filtered.length && (
              <tr><td colSpan={8} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                No A/R invoices in this view.
              </td></tr>
            )}
          </tbody>
        </table>
      </CollapsibleSection>

      <CollapsibleSection
        title="Payment history"
        subtitle="Days-to-pay analysis. Toggle Contract / Service / All to scope the sample."
        defaultOpen={false}
      >
        <OpsPaymentHistory typeFilter={arType} onTypeFilterChange={setArType} />
      </CollapsibleSection>
    </div>
  )
}
