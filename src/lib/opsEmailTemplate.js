// Weekly A/R email — HTML template.
// -----------------------------------------------------------------------
// This module is used in two places:
//   1) The Preview button on OpsArPage renders the output directly into
//      an iframe's srcDoc (so the user sees exactly what recipients get).
//   2) The future server-side weekly job (Supabase edge fn / Netlify fn)
//      imports the same helper so the email body stays in one spot.
//
// Email clients (Outlook especially) only reliably render inline styles
// on table + basic block elements.  Everything here stays email-safe:
// no external stylesheet, no flexbox/grid, no background-images.
// -----------------------------------------------------------------------

// Sage aging buckets — ordered.  Keep the min/max inclusive.
export const AGING_BUCKETS = [
  { label: '0-30',    min: 0,    max: 30  },
  { label: '31-60',   min: 31,   max: 60  },
  { label: '61-90',   min: 61,   max: 90  },
  { label: '91-120',  min: 91,   max: 120 },
  { label: '>120',    min: 121,  max: 9999 },
]

const $ = (n) => (n == null ? '—'
  : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)

// daysLate = today - dueDate.  If the invoice isn't yet overdue, this
// goes negative; we clamp at 0 because the email sorts by days-late.
export function daysLateOf(inv, asOf = new Date()) {
  if (!inv.dueDate) return 0
  const due = new Date(inv.dueDate + 'T00:00:00')
  const ms  = asOf.getTime() - due.getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  return Math.max(0, days)
}

// Roll up invoices into {customer, 0-30, 31-60, ..., total} rows for
// the Sage-style aging grid.  Customer key dedupes by exact string.
export function agingByCustomer(invoices, asOf = new Date()) {
  const map = new Map()
  for (const inv of invoices) {
    const key = inv.customer || inv.job || '—'
    if (!map.has(key)) {
      map.set(key, {
        customer: key,
        buckets:  AGING_BUCKETS.map(() => 0),
        total:    0,
      })
    }
    const row = map.get(key)
    const dl  = daysLateOf(inv, asOf)
    const bi  = AGING_BUCKETS.findIndex((b) => dl >= b.min && dl <= b.max)
    if (bi >= 0) row.buckets[bi] += inv.balance
    row.total += inv.balance
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// Sorted list of invoices for the "open invoices" section.
export function sortByDaysLateDesc(invoices, asOf = new Date()) {
  return invoices
    .slice()
    .map((i) => ({ ...i, daysLate: daysLateOf(i, asOf) }))
    .sort((a, b) => b.daysLate - a.daysLate)
}

// ── Table builders (return HTML strings; all styles inline) ─────────

function agingTableHtml(title, rows) {
  if (!rows.length) {
    return `<p style="margin:8px 0; color:#666; font-size:13px;">No open ${title.toLowerCase()} invoices.</p>`
  }
  const colHeads = AGING_BUCKETS.map((b) =>
    `<th align="right" style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">${b.label}</th>`
  ).join('')
  const body = rows.map((r) => {
    const cells = r.buckets.map((v) =>
      `<td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; color:${v > 0 ? '#000' : '#aaa'}">${v > 0 ? $(v) : '—'}</td>`
    ).join('')
    return `<tr>
      <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px;">${escapeHtml(r.customer)}</td>
      ${cells}
      <td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700;">${$(r.total)}</td>
    </tr>`
  }).join('')
  const totalsPerBucket = AGING_BUCKETS.map((_, i) =>
    rows.reduce((s, r) => s + r.buckets[i], 0)
  )
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const totalsRow = `<tr>
    <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700; background:#fafafa;">Total</td>
    ${totalsPerBucket.map((v) =>
      `<td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700; background:#fafafa;">${$(v)}</td>`
    ).join('')}
    <td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700; background:#fafafa;">${$(grandTotal)}</td>
  </tr>`
  return `
    <h3 style="margin:18px 0 6px 0; font-family:Arial,sans-serif; font-size:14px; color:#333;">${title}</h3>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%; font-family:Arial,sans-serif;">
      <thead>
        <tr>
          <th align="left" style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Customer</th>
          ${colHeads}
          <th align="right" style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${body}
        ${totalsRow}
      </tbody>
    </table>`
}

function invoiceListHtml(title, invoices) {
  if (!invoices.length) {
    return `<p style="margin:8px 0; color:#666; font-size:13px;">No open ${title.toLowerCase()} invoices.</p>`
  }
  const body = invoices.map((inv) => {
    const dlColor = inv.daysLate > 90 ? '#c0392b' : inv.daysLate > 60 ? '#b87d00' : inv.daysLate > 0 ? '#555' : '#888'
    return `<tr>
      <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px;">${escapeHtml(inv.customer || '—')}</td>
      <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px;">${escapeHtml(inv.invoice)}</td>
      <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px;">${escapeHtml(inv.invDate)}</td>
      <td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px;">${$(inv.balance)}</td>
      <td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; color:${dlColor}; font-weight:${inv.daysLate > 0 ? 700 : 400};">${inv.daysLate > 0 ? `${inv.daysLate} d` : 'current'}</td>
    </tr>`
  }).join('')
  return `
    <h3 style="margin:18px 0 6px 0; font-family:Arial,sans-serif; font-size:14px; color:#333;">${title}</h3>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%; font-family:Arial,sans-serif;">
      <thead>
        <tr>
          <th align="left"  style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Company</th>
          <th align="left"  style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Invoice #</th>
          <th align="left"  style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Inv date</th>
          <th align="right" style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Balance</th>
          <th align="right" style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">Days late</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Public API — assembles the full HTML body.
// invoices = AR_INVOICES (mixed AR + SR).
// asOf defaults to today but is overridable for unit tests.
export function buildArEmailHtml({ invoices, asOf = new Date(), subject = 'Weekly A/R aging' }) {
  const ar = invoices.filter((i) => i.type === 'AR')
  const sr = invoices.filter((i) => i.type === 'SR')
  const arAging = agingByCustomer(ar, asOf)
  const srAging = agingByCustomer(sr, asOf)
  const arList  = sortByDaysLateDesc(ar, asOf)
  const srList  = sortByDaysLateDesc(sr, asOf)
  const dateStr = asOf.toISOString().slice(0, 10)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:20px; background:#f5f5f5; font-family:Arial,Helvetica,sans-serif; color:#222;">
  <table cellspacing="0" cellpadding="0" style="max-width:820px; margin:0 auto; background:#fff; border:1px solid #ddd; border-radius:6px;">
    <tr>
      <td style="padding:18px 22px; border-bottom:2px solid #F0C040;">
        <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#666;">DuBaldo Electric — Finance</div>
        <div style="font-size:18px; font-weight:700; color:#222; margin-top:2px;">${escapeHtml(subject)}</div>
        <div style="font-size:12px; color:#666; margin-top:2px;">As of ${dateStr}</div>
      </td>
    </tr>
    <tr><td style="padding:18px 22px;">
      <p style="margin:0 0 14px 0; font-size:13px; line-height:1.5; color:#333;">
        Summary of outstanding receivables, split by contract (AR) and service (SR).
        Aging buckets follow the Sage convention. Invoices below each aging report
        are sorted by days-late (oldest first).
      </p>

      <!-- AR (contract) -->
      ${agingTableHtml('A/R aging — Contract (AR)', arAging)}
      ${invoiceListHtml('Open AR invoices — sorted by days late', arList)}

      <!-- SR (service) -->
      ${agingTableHtml('A/R aging — Service (SR)', srAging)}
      ${invoiceListHtml('Open SR invoices — sorted by days late', srList)}
    </td></tr>
    <tr>
      <td style="padding:12px 22px; background:#fafafa; border-top:1px solid #ddd; font-size:11px; color:#888;">
        Generated automatically by the DDE portal ·
        Configure recipients + schedule on the A/R tab.
      </td>
    </tr>
  </table>
</body>
</html>`
}
