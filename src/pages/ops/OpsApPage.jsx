import { useMemo, useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK } from '../../lib/opsFormat'

// A/P page — Don asked for a Job vs Detail view toggle.
//   Detail (default-ish):  one row per AP invoice (vendor / inv / job / due / total / balance / age)
//   Job:                   one row per job, summing all AP across vendors,
//                          expandable to show the underlying invoices.

const BUCKETS = [
  { label: 'Current', min: 0,  max: 0    },
  { label: '1 – 30',  min: 1,  max: 30   },
  { label: '31 – 60', min: 31, max: 60   },
  { label: '61 – 90', min: 61, max: 90   },
  { label: '90+',     min: 91, max: 9999 },
]

export default function OpsApPage() {
  const { apInvoices } = useOpsData()
  const [view, setView]       = useState('job')         // 'job' | 'detail'
  const [expanded, setExpanded] = useState(null)
  const [q, setQ]             = useState('')

  const sums = BUCKETS.map((b) =>
    apInvoices.filter((i) => i.ageDays >= b.min && i.ageDays <= b.max).reduce((a, i) => a + i.balance, 0),
  )

  const filtered = useMemo(() => {
    if (!q.trim()) return apInvoices
    const needle = q.toLowerCase()
    return apInvoices.filter((r) =>
      (r.vendor || '').toLowerCase().includes(needle) ||
      (r.invoice || '').toString().toLowerCase().includes(needle) ||
      (r.job || '').toLowerCase().includes(needle))
  }, [apInvoices, q])

  // Group by job for the "Job" view.
  const byJob = useMemo(() => {
    const map = new Map()
    for (const r of filtered) {
      const key = r.job || '(unassigned)'
      if (!map.has(key)) {
        map.set(key, { job: key, invoices: [], total: 0, balance: 0, oldest: 0, vendors: new Set() })
      }
      const g = map.get(key)
      g.invoices.push(r)
      g.total   += r.total   || 0
      g.balance += r.balance || 0
      g.oldest   = Math.max(g.oldest, r.ageDays || 0)
      if (r.vendor) g.vendors.add(r.vendor)
    }
    return Array.from(map.values())
      .map((g) => ({ ...g, vendors: g.vendors.size }))
      .sort((a, b) => b.balance - a.balance)
  }, [filtered])

  return (
    <div>
      <div className="ops-grid-5">
        {BUCKETS.map((b, i) => (
          <OpsSectionCard key={b.label} title={b.label}>
            <div className="ops-kpi-value">{fmtK(sums[i])}</div>
          </OpsSectionCard>
        ))}
      </div>

      <OpsSectionCard
        title="Open A/P"
        subtitle={view === 'job'
          ? 'Grouped by job. Click a row to expand the underlying invoices.'
          : 'One row per invoice.'}
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle" title="Group by job, or show every invoice line">
              <button onClick={() => { setView('job');    setExpanded(null) }} className={view === 'job'    ? 'active' : ''}>By Job</button>
              <button onClick={() => { setView('detail'); setExpanded(null) }} className={view === 'detail' ? 'active' : ''}>Detail</button>
            </div>
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={view === 'job' ? 'Search job' : 'Search vendor / invoice / job'}
              style={{ width: 240 }}
            />
          </div>
        }
      >
        {view === 'detail' ? (
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
              {filtered.map((r) => (
                <tr key={(r.vendor || '') + r.invoice}>
                  <td style={{ fontWeight: 600 }}>{r.vendor}</td>
                  <td>{r.invoice}</td>
                  <td>{r.job}</td>
                  <td>{r.dueDate}</td>
                  <td className="right">{fmt(r.total)}</td>
                  <td className="right" style={{ fontWeight: 600 }}>{fmt(r.balance)}</td>
                  <td className="right">{r.ageDays} d</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                  No A/P invoices match the current filters.
                </td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="ops-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Job</th>
                <th className="right">Vendors</th>
                <th className="right">Invoices</th>
                <th className="right">Total</th>
                <th className="right">Balance</th>
                <th className="right">Oldest age</th>
              </tr>
            </thead>
            <tbody>
              {byJob.map((g) => {
                const isOpen = expanded === g.job
                const ageCls = g.oldest > 90 ? 'ops-text-neg' : g.oldest > 60 ? 'ops-text-warn' : ''
                return (
                  <>
                    <tr key={g.job} className="clickable" onClick={() => setExpanded(isOpen ? null : g.job)}>
                      <td className="ops-text-dim ops-small" style={{ width: 24 }}>{isOpen ? '▾' : '▸'}</td>
                      <td style={{ fontWeight: 600 }}>{g.job}</td>
                      <td className="right">{g.vendors}</td>
                      <td className="right">{g.invoices.length}</td>
                      <td className="right">{fmt(g.total)}</td>
                      <td className="right" style={{ fontWeight: 600 }}>{fmt(g.balance)}</td>
                      <td className={`right ${ageCls}`}>{g.oldest} d</td>
                    </tr>
                    {isOpen && (
                      <tr key={g.job + '_exp'}>
                        <td></td>
                        <td colSpan={6} className="ops-row-expand">
                          <table className="ops-table" style={{ fontSize: '0.82rem', marginTop: 4 }}>
                            <thead>
                              <tr>
                                <th>Vendor</th>
                                <th>Invoice</th>
                                <th>Due date</th>
                                <th className="right">Total</th>
                                <th className="right">Balance</th>
                                <th className="right">Age</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.invoices.map((r) => (
                                <tr key={(r.vendor || '') + r.invoice}>
                                  <td style={{ fontWeight: 600 }}>{r.vendor}</td>
                                  <td>{r.invoice}</td>
                                  <td>{r.dueDate}</td>
                                  <td className="right">{fmt(r.total)}</td>
                                  <td className="right">{fmt(r.balance)}</td>
                                  <td className="right">{r.ageDays} d</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {!byJob.length && (
                <tr><td colSpan={7} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                  No A/P invoices match the current filters.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </OpsSectionCard>
    </div>
  )
}
