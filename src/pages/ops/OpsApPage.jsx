import { useState, useMemo } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK } from '../../lib/opsFormat'

export default function OpsApPage() {
  const { apInvoices, loading: _opsLoading } = useOpsData()
  const [q,         setQ]         = useState('')
  const [threshold, setThreshold] = useState(100)   // hide invoices below this balance

  const filtered = useMemo(() => {
    let rows = apInvoices.filter((inv) => (inv.balance || 0) >= threshold)
    if (q.trim()) {
      const needle = q.toLowerCase()
      rows = rows.filter((inv) =>
        (inv.vendor || '').toLowerCase().includes(needle) ||
        (inv.job    || '').toLowerCase().includes(needle) ||
        (inv.invoice|| '').toLowerCase().includes(needle)
      )
    }
    return rows
  }, [apInvoices, q, threshold])

  const hiddenCount = useMemo(
    () => apInvoices.filter((inv) => (inv.balance || 0) < threshold).length,
    [apInvoices, threshold],
  )

  const totals = useMemo(() => ({
    balance: filtered.reduce((s, r) => s + (r.balance || 0), 0),
    total:   filtered.reduce((s, r) => s + (r.total   || 0), 0),
  }), [filtered])

  if (_opsLoading) return <div style={{ padding: '40px 20px', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', textAlign: 'center' }}>Loading data…</div>

  return (
    <div>
      <div className="ops-grid-2" style={{ marginBottom: 20 }}>
        <OpsSectionCard title="Open A/P balance">
          <div className="ops-kpi-value">{fmtK(totals.balance)}</div>
          <div className="ops-small ops-text-dim">
            {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
            {hiddenCount > 0 && <span className="ops-text-dim"> · {hiddenCount} below ${threshold} threshold hidden</span>}
          </div>
        </OpsSectionCard>
        <OpsSectionCard title="Total invoiced">
          <div className="ops-kpi-value">{fmtK(totals.total)}</div>
          <div className="ops-small ops-text-dim">original invoice amounts (shown rows only)</div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title="Open A/P invoices"
        subtitle="Vendor invoices with an outstanding balance."
        right={
          <div className="ops-toolbar">
            <label className="ops-small ops-text-dim" style={{ whiteSpace: 'nowrap' }}>
              Min balance $
            </label>
            <input
              className="ops-input"
              type="number"
              min="0"
              step="50"
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 80 }}
              title="Hide invoices with balance below this amount"
            />
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search vendor or job…"
              style={{ width: 200 }}
            />
          </div>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Invoice</th>
                <th>Job</th>
                <th className="right">Due date</th>
                <th className="right">Days late</th>
                <th className="right">Total</th>
                <th className="right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice()
                .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))
                .map((inv, i) => (
                  <tr key={i}>
                    <td>{inv.vendor || '—'}</td>
                    <td className="ops-text-dim">{inv.invoice || '—'}</td>
                    <td className="ops-text-dim">{inv.job || '—'}</td>
                    <td className="right ops-text-dim">{inv.dueDate || '—'}</td>
                    <td className={`right ${(inv.ageDays || 0) > 30 ? 'ops-text-neg' : ''}`}>
                      {inv.ageDays > 0 ? `${inv.ageDays}d` : '—'}
                    </td>
                    <td className="right">{fmt(inv.total)}</td>
                    <td className="right" style={{ fontWeight: 600 }}>{fmt(inv.balance)}</td>
                  </tr>
                ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                    {hiddenCount > 0
                      ? `All ${hiddenCount} invoice${hiddenCount !== 1 ? 's' : ''} are below the $${threshold} threshold.`
                      : 'No open A/P invoices.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </OpsSectionCard>
    </div>
  )
}
