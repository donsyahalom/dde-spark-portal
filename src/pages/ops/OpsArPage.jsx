import { useMemo, useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsPaymentHistory from '../../components/ops/OpsPaymentHistory'
import { useOpsData } from '../../hooks/useOpsData'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtK } from '../../lib/opsFormat'
import {
  DAYS_BUCKETS,
  agingByCustomer,
  buildArEmailHtml,
  buildMonthBuckets,
  daysLateOf,
  sortByDaysLateDesc,
} from '../../lib/opsEmailTemplate'

// Keep client-side settings state in localStorage so toggling the Preview
// doesn't clear the recipient/schedule tweaks.  Replace with Supabase
// `ops_settings` row when the RLS table lands.
const LS_KEY = 'dde.ops.arEmailSettings'
const EMAIL_DEFAULTS = {
  enabled: true,
  dayOfWeek: 1,
  sendHour: 8,
  subject: 'Weekly A/R Aging — D. DuBaldo Electric',
  recipients: [],
  content: { contractAging: true, contractDetail: true, serviceAging: true, serviceDetail: true },
  deliveryMode: 'embedded', // 'embedded' | 'password' | 'link'
  emailPassword: '',
}
function loadSettings(defaults) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { ...EMAIL_DEFAULTS, ...defaults }
    const parsed = JSON.parse(raw)
    return {
      ...EMAIL_DEFAULTS,
      ...defaults,
      ...parsed,
      content: { ...EMAIL_DEFAULTS.content, ...(parsed.content || {}) },
      recipients: parsed.recipients?.length ? parsed.recipients : (defaults.recipients || []),
    }
  } catch { return { ...EMAIL_DEFAULTS, ...defaults } }
}
function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Cell with hover tooltip listing the invoices that make up its $ ──
// Lightweight tooltip — we don't pull in a lib just for this.  Uses a
// popover div revealed on :hover/:focus via local state.  The cell is
// role="button" so it's keyboard-focusable.
function AgingCell({ amount, invoices, align = 'right', bold = false }) {
  const [open, setOpen] = useState(false)
  const hasInvoices = invoices && invoices.length > 0
  const show = () => hasInvoices && setOpen(true)
  const hide = () => setOpen(false)
  return (
    <td
      className={align === 'right' ? 'right' : ''}
      style={{
        position: 'relative',
        fontWeight: bold ? 700 : 400,
        color: amount > 0 ? undefined : 'var(--text-dim)',
        cursor: hasInvoices ? 'help' : 'default',
      }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={hasInvoices ? 0 : -1}
    >
      {amount > 0 ? fmt(amount) : '—'}
      {open && hasInvoices && (
        <div
          className="ops-tooltip"
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 50,
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 240,
            maxWidth: 340,
            background: 'var(--panel-dark, #1b1f25)',
            border: '1px solid var(--border-bright, #3a4049)',
            borderRadius: 6,
            padding: '8px 10px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            textAlign: 'left',
            fontWeight: 400,
            fontSize: '0.78rem',
            color: 'var(--white)',
          }}
        >
          <div className="ops-small" style={{ color: 'var(--gold)', marginBottom: 4, letterSpacing: '0.04em' }}>
            {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left',  padding: '2px 4px', color: 'var(--text-dim)', fontWeight: 600 }}>Inv #</th>
                <th style={{ textAlign: 'left',  padding: '2px 4px', color: 'var(--text-dim)', fontWeight: 600 }}>Date</th>
                <th style={{ textAlign: 'right', padding: '2px 4px', color: 'var(--text-dim)', fontWeight: 600 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoice}>
                  <td style={{ padding: '2px 4px' }}>{inv.invoice}</td>
                  <td style={{ padding: '2px 4px', color: 'var(--text-dim)' }}>{inv.invDate}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>{fmt(inv.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </td>
  )
}

// ── Aging report table ─────────────────────────────────────────────
// Props:
//   • title          : section title above the table
//   • rows           : [{ customer, buckets:[{amount,invoices}], total }]
//   • bucketLabels   : array of column labels (from DAYS_BUCKETS or months)
//   • retainageByCust: optional { [customer]: retainageHeld$ } — when
//                      supplied we show a Retainage column (contract only)
//   • emptyMsg       : shown when rows is empty
function AgingTable({ title, rows, bucketLabels, retainageByCust, emptyMsg }) {
  if (!rows.length) {
    return (
      <div>
        <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div className="ops-small ops-text-dim">{emptyMsg}</div>
      </div>
    )
  }
  const totals = bucketLabels.map((_, i) => rows.reduce((s, r) => s + r.buckets[i].amount, 0))
  const grand  = rows.reduce((s, r) => s + r.total, 0)
  const retainageGrand = retainageByCust
    ? rows.reduce((s, r) => s + (retainageByCust[r.customer] || 0), 0)
    : 0
  return (
    <div>
      <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ops-table" style={{ fontSize: '0.82rem' }}>
          <thead>
            <tr>
              <th>Customer</th>
              {retainageByCust && <th className="right">Retainage</th>}
              {bucketLabels.map((lbl) => <th key={lbl} className="right">{lbl}</th>)}
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer}>
                <td>{r.customer}</td>
                {retainageByCust && (
                  <td className="right ops-text-warn" style={{ fontWeight: 600 }}>
                    {retainageByCust[r.customer] ? fmt(retainageByCust[r.customer]) : '—'}
                  </td>
                )}
                {r.buckets.map((c, i) => (
                  <AgingCell key={i} amount={c.amount} invoices={c.invoices} />
                ))}
                <td className="right" style={{ fontWeight: 700 }}>{fmt(r.total)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border-bright)', fontWeight: 700 }}>
              <td>Total</td>
              {retainageByCust && (
                <td className="right">{retainageGrand ? fmt(retainageGrand) : '—'}</td>
              )}
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
  const { arInvoices, arEmailDefaults, jobs } = useOpsData()
  const { currentUser } = useAuth()
  const isAdmin = !!currentUser?.is_admin
  const [settings, setSettings] = useState(() => loadSettings(arEmailDefaults))
  const [showPreview, setShowPreview] = useState(false)
  // Days vs months bucketing (applies to both AR + SR aging tables)
  const [agingMode, setAgingMode] = useState('days')
  // Email section is collapsed by default — admins can expand it.
  const [emailOpen, setEmailOpen] = useState(false)

  // Split invoices AR vs SR so the two aging reports + two invoice lists
  // can be rendered independently (matches the email layout too).
  const arInv = useMemo(() => arInvoices.filter((i) => i.type === 'AR'), [arInvoices])
  const srInv = useMemo(() => arInvoices.filter((i) => i.type === 'SR'), [arInvoices])

  // Rebuild aging rollups whenever the toggle flips.
  const arAging = useMemo(
    () => agingByCustomer(arInv, { mode: agingMode }),
    [arInv, agingMode],
  )
  const srAging = useMemo(
    () => agingByCustomer(srInv, { mode: agingMode }),
    [srInv, agingMode],
  )

  const arSorted = useMemo(() => sortByDaysLateDesc(arInv), [arInv])
  const srSorted = useMemo(() => sortByDaysLateDesc(srInv), [srInv])

  // Column labels for the current mode
  const bucketLabels = useMemo(() => {
    if (agingMode === 'months') return buildMonthBuckets().map((b) => b.label)
    return DAYS_BUCKETS.map((b) => b.label)
  }, [agingMode])

  // Retainage per customer — sum retainageHeld across their contract jobs.
  // Only used for the Contract (AR) table.
  const retainageByCust = useMemo(() => {
    const m = {}
    for (const j of jobs) {
      if (j.type !== 'contract' || !j.retainageHeld) continue
      m[j.customer] = (m[j.customer] || 0) + j.retainageHeld
    }
    return m
  }, [jobs])

  // Top-row quick cards — always use days buckets so the "aging at a
  // glance" read stays interpretable regardless of the toggle.
  const totals = useMemo(() => {
    const sums = DAYS_BUCKETS.map(() => 0)
    let total = 0
    for (const inv of arInvoices) {
      const dl = daysLateOf(inv)
      const bi = DAYS_BUCKETS.findIndex((b) => dl >= b.min && dl <= b.max)
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
  const emailHtml = useMemo(() => {
    if (settings.deliveryMode === 'link') {
      const appUrl = window.location.origin
      return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif;">
<table cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:6px;">
<tr><td style="padding:18px 22px;border-bottom:2px solid #F0C040;">
  <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#666;">DuBaldo Electric — Finance</div>
  <div style="font-size:18px;font-weight:700;color:#222;margin-top:2px;">${settings.subject}</div>
</td></tr>
<tr><td style="padding:24px 22px;">
  <p style="margin:0 0 20px;font-size:14px;color:#333;">Your weekly A/R aging report is ready.</p>
  <a href="${appUrl}/ops/ar" style="display:inline-block;background:#F0C040;color:#112e1c;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;">View A/R Dashboard →</a>
  <p style="margin:20px 0 0;font-size:11px;color:#888;">If the button doesn't work: ${appUrl}/ops/ar</p>
</td></tr>
</table></body></html>`
    }
    return buildArEmailHtml({
      invoices: arInvoices,
      jobs,
      subject: settings.subject,
      content: settings.content || {},
    })
  }, [arInvoices, jobs, settings.subject, settings.content, settings.deliveryMode])

  return (
    <div>
      {/* ── Aging at-a-glance ─────────────────────────────────────── */}
      <div className="ops-grid-5">
        {DAYS_BUCKETS.map((b, i) => (
          <OpsSectionCard key={b.label} title={b.label}>
            <div className="ops-kpi-value">{fmtK(totals.sums[i])}</div>
            <div className="ops-small ops-text-dim">
              {b.label === 'Current' ? 'not yet overdue' : 'days past due'}
            </div>
          </OpsSectionCard>
        ))}
      </div>

      {/* ── Sage-style aging reports — AR and SR ──────────────────── */}
      <OpsSectionCard
        title="A/R aging — Sage style"
        subtitle="Contract (AR) and Service (SR) reports rolled up by customer. Hover any cell to see the invoices behind it."
        right={
          <div className="ops-toolbar">
            <div className="ops-toggle" role="group" aria-label="Aging bucket mode">
              <button
                type="button"
                onClick={() => setAgingMode('days')}
                className={agingMode === 'days' ? 'active' : ''}
              >Days</button>
              <button
                type="button"
                onClick={() => setAgingMode('months')}
                className={agingMode === 'months' ? 'active' : ''}
              >Months</button>
            </div>
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
          <AgingTable
            title="Contract (AR) aging by customer"
            rows={arAging}
            bucketLabels={bucketLabels}
            retainageByCust={retainageByCust}
            emptyMsg="No open contract invoices."
          />
          <AgingTable
            title="Service (SR) aging by customer"
            rows={srAging}
            bucketLabels={bucketLabels}
            /* no retainage column for service — SR jobs don't have retention */
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

      {/* ── Weekly email settings + preview — admin-only, collapsible ── */}
      {isAdmin && (
        <OpsSectionCard
          title="Weekly A/R email"
          subtitle={emailOpen
            ? `Configure what gets sent, to whom, and how.`
            : settings.enabled
              ? `Sends every ${DOW_LABELS[settings.dayOfWeek]} at ${pad2(settings.sendHour)}:00 to ${settings.recipients.filter((r) => r.email).length} recipient${settings.recipients.filter((r) => r.email).length === 1 ? '' : 's'}. Expand to edit.`
              : `Email disabled. Expand to re-enable.`}
          right={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Enabled toggle */}
              <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:'0.82rem', color: settings.enabled ? 'var(--pos)' : 'var(--text-dim)' }}>
                <input
                  type="checkbox"
                  checked={!!settings.enabled}
                  onChange={e => persist({ ...settings, enabled: e.target.checked })}
                  style={{ accentColor:'var(--gold)', width:14, height:14 }}
                />
                {settings.enabled ? 'Enabled' : 'Disabled'}
              </label>
              {emailOpen && settings.enabled && (
                <button className="ops-btn" onClick={() => setShowPreview(true)}>Preview email</button>
              )}
              <button className="ops-btn ghost" onClick={() => setEmailOpen((v) => !v)} aria-expanded={emailOpen}>
                {emailOpen ? 'Hide' : 'Expand'}
              </button>
            </div>
          }
        >
          {emailOpen && (
            <>
              {/* ── Schedule ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
                <div className="ops-stat-box">
                  <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Day of week</div>
                  <select className="ops-select" value={settings.dayOfWeek}
                    onChange={(e) => persist({ ...settings, dayOfWeek: Number(e.target.value) })}
                    style={{ width: '100%' }}>
                    {DOW_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </div>
                <div className="ops-stat-box">
                  <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Send hour (local)</div>
                  <select className="ops-select" value={settings.sendHour}
                    onChange={(e) => persist({ ...settings, sendHour: Number(e.target.value) })}
                    style={{ width: '100%' }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{pad2(h)}:00</option>
                    ))}
                  </select>
                </div>
                <div className="ops-stat-box" style={{ gridColumn: '1 / -1' }}>
                  <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Subject line</div>
                  <input className="ops-input" style={{ width: '100%' }} value={settings.subject}
                    onChange={(e) => persist({ ...settings, subject: e.target.value })} />
                </div>
              </div>

              {/* ── Content options ── */}
              <div style={{ marginBottom: 20 }}>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 8 }}>
                  Content to include
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {[
                    ['contractAging',  'Contract Aging'],
                    ['contractDetail', 'Contract Detail'],
                    ['serviceAging',   'Service Aging'],
                    ['serviceDetail',  'Service Detail'],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer',
                      padding:'7px 12px', borderRadius:6,
                      background: settings.content?.[key] ? 'rgba(240,192,64,0.12)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${settings.content?.[key] ? 'rgba(240,192,64,0.35)' : 'rgba(255,255,255,0.12)'}`,
                      fontSize: '0.83rem', color: 'var(--white)' }}>
                      <input type="checkbox" checked={!!settings.content?.[key]}
                        onChange={e => persist({ ...settings, content: { ...(settings.content || {}), [key]: e.target.checked } })}
                        style={{ accentColor: 'var(--gold)' }} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* ── Delivery mode ── */}
              <div style={{ marginBottom: 20 }}>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 8 }}>
                  Delivery method
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['embedded',  'Option 1 — Embedded (full report in email, as per preview)'],
                    ['password',  'Option 2 — Embedded with password protection'],
                    ['link',      'Option 3 — Link only (email contains a link to the A/R page, no detail)'],
                  ].map(([val, label]) => (
                    <label key={val} style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer',
                      padding:'10px 14px', borderRadius:6,
                      background: settings.deliveryMode === val ? 'rgba(240,192,64,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${settings.deliveryMode === val ? 'rgba(240,192,64,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      fontSize:'0.85rem', color:'var(--white)' }}>
                      <input type="radio" name="deliveryMode" value={val}
                        checked={settings.deliveryMode === val}
                        onChange={() => persist({ ...settings, deliveryMode: val })}
                        style={{ marginTop: 2, accentColor: 'var(--gold)', flexShrink: 0 }} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {settings.deliveryMode === 'password' && (
                  <div style={{ marginTop: 12, maxWidth: 320 }}>
                    <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>
                      Password recipients must enter to view report
                    </div>
                    <input
                      className="ops-input"
                      style={{ width: '100%' }}
                      type="text"
                      value={settings.emailPassword || ''}
                      onChange={e => persist({ ...settings, emailPassword: e.target.value })}
                      placeholder="Set a password…"
                    />
                    <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
                      Note: the email will include a password prompt before the report content is shown.
                    </div>
                  </div>
                )}
              </div>

              {/* ── Recipients ── */}
              <div>
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
                          <input className="ops-input" style={{ width: '100%' }} value={r.name}
                            onChange={(e) => updateRecipient(i, { name: e.target.value })} placeholder="Full name" />
                        </td>
                        <td>
                          <input className="ops-input" style={{ width: '100%' }} value={r.email}
                            onChange={(e) => updateRecipient(i, { email: e.target.value })} placeholder="name@dubaldo.com" />
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
            </>
          )}
        </OpsSectionCard>
      )}

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
