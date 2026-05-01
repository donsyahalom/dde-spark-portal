import { useMemo } from 'react'
import OpsSectionCard from './OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt } from '../../lib/opsFormat'

// Payment-history breakdown.  Don asked for a contract/service toggle
// that scopes the days-to-pay sample.  The toggle lives in OpsArPage
// (parent), and we receive the current value as a prop so the AR table
// and this section stay in sync.
//
// We don't have a 'type' field on the paymentHistory rows themselves
// (those are projected from sage.invoices joined with sage.payments at
// the customer level).  So we derive each customer's predominant AR
// type by majority-vote over the open AR invoices for that customer:
//   - majority 'AR' rows → 'contract'
//   - majority 'SR' rows → 'service'
//   - tie / unknown      → counted in 'all' but excluded from contract
//                          and service buckets to avoid double-attributing.
//
// Props:
//   typeFilter           'contract' | 'service' | 'all'
//   onTypeFilterChange   (next) => void   — optional; if provided we
//                         show a small inline toggle in the header.

export default function OpsPaymentHistory({ typeFilter = 'all', onTypeFilterChange }) {
  const { paymentHistory, arInvoices } = useOpsData()

  // Build customer → predominant type map from the open AR pool.
  const customerType = useMemo(() => {
    const counts = new Map()   // customer -> { AR: n, SR: n }
    for (const inv of arInvoices || []) {
      const c = inv.customer
      if (!c) continue
      const t = inv.type || 'AR'
      const cur = counts.get(c) || { AR: 0, SR: 0 }
      cur[t] = (cur[t] || 0) + 1
      counts.set(c, cur)
    }
    const out = new Map()
    for (const [customer, n] of counts) {
      if (n.AR > n.SR) out.set(customer, 'contract')
      else if (n.SR > n.AR) out.set(customer, 'service')
      // tie: leave undefined — only counts toward 'all'
    }
    return out
  }, [arInvoices])

  const filtered = useMemo(() => {
    const rows = paymentHistory || []
    if (typeFilter === 'all') return rows
    return rows.filter((r) => customerType.get(r.customer) === typeFilter)
  }, [paymentHistory, customerType, typeFilter])

  // Aggregates for the summary cards.
  const summary = useMemo(() => {
    if (!filtered.length) return null
    const avgDays = filtered.reduce((a, r) => a + (r.avgDaysToPay || 0), 0) / filtered.length
    const totalPaid = filtered.reduce((a, r) => a + (r.paidYtd || 0), 0)
    const fastest = filtered.slice().sort((a, b) => a.avgDaysToPay - b.avgDaysToPay)[0]
    const slowest = filtered.slice().sort((a, b) => b.avgDaysToPay - a.avgDaysToPay)[0]
    return { avgDays, totalPaid, fastest, slowest, count: filtered.length }
  }, [filtered])

  const scopeLabel =
    typeFilter === 'contract' ? 'contract customers'
    : typeFilter === 'service' ? 'service customers'
    : 'all customers'

  return (
    <div>
      {summary ? (
        <div className="ops-grid-4" style={{ marginBottom: 12 }}>
          <OpsSectionCard title="Avg days to pay">
            <div className="ops-kpi-value">{Math.round(summary.avgDays)} d</div>
            <div className="ops-small ops-text-dim">across {summary.count} {scopeLabel}</div>
          </OpsSectionCard>
          <OpsSectionCard title="Paid YTD">
            <div className="ops-kpi-value">{fmt(summary.totalPaid)}</div>
          </OpsSectionCard>
          <OpsSectionCard title="Fastest payer">
            {summary.fastest ? (
              <>
                <div style={{ fontWeight: 700 }}>{summary.fastest.customer}</div>
                <div className="ops-small ops-text-dim">{summary.fastest.avgDaysToPay} d avg</div>
              </>
            ) : <div className="ops-text-dim">—</div>}
          </OpsSectionCard>
          <OpsSectionCard title="Slowest payer">
            {summary.slowest ? (
              <>
                <div style={{ fontWeight: 700 }} className="ops-text-warn">{summary.slowest.customer}</div>
                <div className="ops-small ops-text-dim">{summary.slowest.avgDaysToPay} d avg</div>
              </>
            ) : <div className="ops-text-dim">—</div>}
          </OpsSectionCard>
        </div>
      ) : null}

      <table className="ops-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Type</th>
            <th className="right">Invoices</th>
            <th className="right">Paid YTD</th>
            <th className="right">Avg days to pay</th>
            <th className="right">Last paid</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const t = customerType.get(r.customer)
            const cls = r.avgDaysToPay > 60 ? 'ops-text-neg' : r.avgDaysToPay > 45 ? 'ops-text-warn' : ''
            return (
              <tr key={r.customer}>
                <td style={{ fontWeight: 600 }}>{r.customer}</td>
                <td>
                  {t ? (
                    <span className={`chip ${t === 'service' ? 'hold' : 'active'}`}>
                      {t === 'service' ? 'SR' : 'AR'}
                    </span>
                  ) : (
                    <span className="ops-small ops-text-dim">—</span>
                  )}
                </td>
                <td className="right">{r.invoiceCount}</td>
                <td className="right">{fmt(r.paidYtd)}</td>
                <td className={`right ${cls}`}>{r.avgDaysToPay} d</td>
                <td className="right">{r.lastPaidDate || '—'}</td>
              </tr>
            )
          })}
          {!filtered.length && (
            <tr>
              <td colSpan={6} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                No payment history for {scopeLabel}.
                {onTypeFilterChange && typeFilter !== 'all' && (
                  <>
                    {' '}
                    <button
                      className="btn btn-outline btn-xs"
                      style={{ marginLeft: 8 }}
                      onClick={() => onTypeFilterChange('all')}
                    >
                      Show all
                    </button>
                  </>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
