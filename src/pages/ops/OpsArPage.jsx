import { useMemo, useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsPaymentHistory from '../../components/ops/OpsPaymentHistory'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK } from '../../lib/opsFormat'
import {
  AGING_BUCKETS,
  agingByCustomer,
  buildArEmailHtml,
  daysLateOf,
  sortByDaysLateDesc,
} from '../../lib/opsEmailTemplate'

// Keep client-side settings state in localStorage so toggling the Preview
// doesn't clear the recipient/schedule tweaks.  Replace with Supabase
// `ops_settings` row when the RLS table lands.
const LS_KEY = 'dde.ops.arEmailSettings'
function loadSettings(defaults) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    return { ...defaults, ...parsed, recipients: parsed.recipients?.length ? parsed.recipients : defaults.recipients }
  } catch { return defaults }
}
function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Aging report table (in-page version; mirrors the email output) ──
function AgingTable({ title, rows, emptyMsg }) {
  if (!rows.length) {
    return (
      <div>
        <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div className="ops-small ops-text-dim">{emptyMsg}</div>
      </div>
    )
  }
  const totals = AGING_BUCKETS.map((_, i) => rows.reduce((s, r) => s + r.buckets[i], 0))
  const grand  = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div>
      <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ops-table" style={{ fontSize: '0.82rem' }}>
          <thead>
            <tr>
              <th>Customer</th>
              {AGING_BUCKETS.map((b) => <th key={b.label} className="right">{b.label}</th>)}
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer}>
                <td>{r.customer}</td>
                {r.buckets.map((v, i) => (
                  <td key={i} className={`right ${v > 0 ? '' : 'ops-text-dim'}`}>{v > 0 ? fmt(v) : '—'}</td>
                ))}
                <td className="right" style={{ fontWeight: 700 }}>{fmt(r.total)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border-bright)', fontWeight: 700 }}>
              <td>Total</td>
              {totals.map((v, i) => (
                <td key={i} className="right">{fmt(v)}</td>
              ))}
              <td className="right">{fmt(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function OpsArPage() {
  const { arInvoices, arEmailDefaults } = useOpsData()
  const [settings, setSettings] = useState(() => loadSettings(arEmailDefaults))
  const [showPreview, setShowPreview] = useState(false)

  // Split invoices AR vs SR so the two aging reports + two invoice lists
  // can be rendered independently (matches the email layout too).
  const arInv = useMemo(() => arInvoices.filter((i) => i.type === 'AR'), [arInvoices])
  const srInv = useMemo(() => arInvoices.filter((i) => i.type === 'SR'), [arInvoices])

  const arAging = useMemo(() => agingByCustomer(arInv), [arInv])
  const srAging = useMemo(() => agingByCustomer(srInv), [srInv])

  const arSorted = useMemo(() => sortByDaysLateDesc(arInv), [arInv])
  const srSorted = useMemo(() => sortByDaysLateDesc(srInv), [srInv])

  // KPI cards — total open + bucket sums across AR+SR so the top row
  // mirrors the old "aging at a glance" read.
  const totals = useMemo(() => {
    const sums = AGING_BUCKETS.map(() => 0)
    let total = 0
    for (const inv of arInvoices) {
      const dl = daysLateOf(inv)
      const bi = AGING_BUCKETS.findIndex((b) => dl >= b.min && dl <= b.max)
      if (bi >= 0) sums[bi] += inv.balance
      total += inv.balance
    }
    return { sums, total }
  }, [arInvoices])

  const persist = (next) => {
    setSettings(next)
    saveSettings(next)
  }

  const addRecipient = () => {
    persist({ ...settings, recipients: [...settings.recipients, { name: '', email: '' }] })
  }
  const updateRecipient = (idx, patch) => {
    const next = settings.recipients.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    persist({ ...settings, recipients: next })
  }
  const removeRecipient = (idx) => {
    persist({ ...settings, recipients: settings.recipients.filter((_, i) => i !== idx) })
  }

  // Assemble the email HTML — re-runs on preview open so edits are reflected.
  const emailHtml = useMemo(
    () => buildArEmailHtml({ invoices: arInvoices, subject: settings.subject }),
    [arInvoices, settings.subject],
  )

  return (
    <div>
      {/* ── Aging at-a-glance ─────────────────────────────────────── */}
      <div className="ops-grid-5">
        {AGING_BUCKETS.map((b, i) => (
          <OpsSectionCard key={b.label} title={b.label}>
            <div className="ops-kpi-value">{fmtK(totals.sums[i])}</div>
            <div className="ops-small ops-text-dim">days past due</div>
          </OpsSectionCard>
        ))}
      </div>

      {/* ── Sage-style aging reports — AR and SR side-by-side ─────── */}
      <OpsSectionCard
        title="A/R aging — Sage style"
        subtitle="Contract (AR) and Service (SR) reports rolled up by customer, bucketed by days-past-due."
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
          <AgingTable
            title="Contract (AR) aging by customer"
            rows={arAging}
            emptyMsg="No open contract invoices."
          />
          <AgingTable
            title="Service (SR) aging by customer"
            rows={srAging}
            emptyMsg="No open service invoices."
          />
        </div>
      </OpsSectionCard>

      {/* ── Open invoices, days-late desc (matches email layout) ──── */}
      <OpsSectionCard
        title="Open invoices — sorted by days late"
        subtitle="Same list that ships in the weekly email. Oldest at the top."
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
          <InvoiceList title="Contract (AR)" rows={arSorted} />
          <InvoiceList title="Service (SR)"  rows={srSorted} />
        </div>
      </OpsSectionCard>

      {/* ── Weekly email settings + preview ──────────────────────── */}
      <OpsSectionCard
        title="Weekly A/R email"
        subtitle={`Sent automatically every ${DOW_LABELS[settings.dayOfWeek]} at ${pad2(settings.sendHour)}:00. Edit recipients below. Click Preview to see exactly what lands in their inbox.`}
        right={
          <button className="ops-btn" onClick={() => setShowPreview(true)}>Preview email</button>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <div className="ops-stat-box">
            <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Day of week</div>
            <select
              className="ops-select"
              value={settings.dayOfWeek}
              onChange={(e) => persist({ ...settings, dayOfWeek: Number(e.target.value) })}
              style={{ width: '100%' }}
            >
              {DOW_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="ops-stat-box">
            <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Send hour (local)</div>
            <select
              className="ops-select"
              value={settings.sendHour}
              onChange={(e) => persist({ ...settings, sendHour: Number(e.target.value) })}
              style={{ width: '100%' }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{pad2(h)}:00</option>
              ))}
            </select>
          </div>
          <div className="ops-stat-box" style={{ gridColumn: '1 / -1' }}>
            <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Subject line</div>
            <input
              className="ops-input"
              style={{ width: '100%' }}
              value={settings.subject}
              onChange={(e) => persist({ ...settings, subject: e.target.value })}
            />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 6 }}>
            Recipients
          </div>
          <table className="ops-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {settings.recipients.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="ops-input"
                      style={{ width: '100%' }}
                      value={r.name}
                      onChange={(e) => updateRecipient(i, { name: e.target.value })}
                      placeholder="Full name"
                    />
                  </td>
                  <td>
                    <input
                      className="ops-input"
                      style={{ width: '100%' }}
                      value={r.email}
                      onChange={(e) => updateRecipient(i, { email: e.target.value })}
                      placeholder="name@dubaldo.com"
                    />
                  </td>
                  <td>
                    <button className="ops-btn ghost" onClick={() => removeRecipient(i)}>Remove</button>
                  </td>
                </tr>
              ))}
              {!settings.recipients.length && (
                <tr><td colSpan={3} className="center ops-text-dim">No recipients configured.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <button className="ops-btn ghost" onClick={addRecipient}>+ Add recipient</button>
          </div>
        </div>
      </OpsSectionCard>

      {/* ── Legacy full A/R list (kept for reference) ───────────── */}
      <OpsSectionCard title="Open A/R — all invoices">
        <div style={{ overflowX: 'auto' }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Job</th>
                <th>Inv date</th>
                <th>Due date</th>
                <th className="right">Total</th>
                <th className="right">Balance</th>
                <th className="right">Days late</th>
              </tr>
            </thead>
            <tbody>
              {arInvoices.map((r) => {
                const dl = daysLateOf(r)
                const ageCls = dl > 90 ? 'ops-text-neg' : dl > 60 ? 'ops-text-warn' : ''
                return (
                  <tr key={r.invoice}>
                    <td><span className={`chip ${r.type === 'AR' ? 'active' : 'hold'}`}>{r.type}</span></td>
                    <td>{r.invoice}</td>
                    <td>{r.customer}</td>
                    <td className="ops-text-dim">{r.job}</td>
                    <td>{r.invDate}</td>
                    <td>{r.dueDate}</td>
                    <td className="right">{fmt(r.total)}</td>
                    <td className="right" style={{ fontWeight: 600 }}>{fmt(r.balance)}</td>
                    <td className={`right ${ageCls}`}>{dl > 0 ? `${dl} d` : 'current'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </OpsSectionCard>

      <OpsPaymentHistory />

      {/* ── Email preview modal ─────────────────────────────────── */}
      {showPreview && (
        <div className="ops-modal-backdrop" onClick={() => setShowPreview(false)}>
          <div className="ops-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ops-modal-head">
              <div>
                <div style={{ fontWeight: 700 }}>Email preview</div>
                <div className="ops-small ops-text-dim">
                  To: {settings.recipients.map((r) => r.name || r.email).filter(Boolean).join(', ') || '(no recipients)'}
                </div>
              </div>
              <button className="ops-btn ghost" onClick={() => setShowPreview(false)}>Close</button>
            </div>
            <div className="ops-modal-body">
              <iframe
                title="A/R email preview"
                srcDoc={emailHtml}
                style={{ width: '100%', height: '68vh', border: 'none', background: '#f5f5f5' }}
              />
            </div>
            <div className="ops-modal-foot">
              <button className="ops-btn ghost" onClick={() => setShowPreview(false)}>Close</button>
              <button
                className="ops-btn"
                onClick={() => {
                  // Copy HTML to clipboard so the user can paste into any
                  // email client immediately.  Falls back gracefully.
                  try {
                    navigator.clipboard?.writeText(emailHtml)
                    // eslint-disable-next-line no-alert
                    alert('Email HTML copied to clipboard.')
                  } catch {
                    // eslint-disable-next-line no-alert
                    alert('Clipboard unavailable — use your browser dev tools to copy the preview HTML.')
                  }
                }}
              >
                Copy HTML
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InvoiceList({ title, rows }) {
  return (
    <div>
      <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ops-table" style={{ fontSize: '0.82rem' }}>
          <thead>
            <tr>
              <th>Company</th>
              <th>Invoice #</th>
              <th>Inv date</th>
              <th className="right">Balance</th>
              <th className="right">Days late</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="center ops-text-dim">No open invoices.</td>
              </tr>
            )}
            {rows.map((inv) => {
              const cls = inv.daysLate > 90 ? 'ops-text-neg' : inv.daysLate > 60 ? 'ops-text-warn' : inv.daysLate > 0 ? '' : 'ops-text-dim'
              return (
                <tr key={inv.invoice}>
                  <td>{inv.customer}</td>
                  <td>{inv.invoice}</td>
                  <td className="ops-text-dim">{inv.invDate}</td>
                  <td className="right" style={{ fontWeight: 600 }}>{fmt(inv.balance)}</td>
                  <td className={`right ${cls}`} style={{ fontWeight: inv.daysLate > 0 ? 700 : 400 }}>
                    {inv.daysLate > 0 ? `${inv.daysLate} d` : 'current'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function pad2(n) { return String(n).padStart(2, '0') }
