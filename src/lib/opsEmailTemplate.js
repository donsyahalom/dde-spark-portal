// Weekly A/R email — HTML template + aging helpers.
// -----------------------------------------------------------------------
// This module is used in three places:
//   1) The Preview button on OpsArPage renders the output directly into
//      an iframe's srcDoc (so the user sees exactly what recipients get).
//   2) The future server-side weekly job (Supabase edge fn / Netlify fn)
//      imports the same helper so the email body stays in one spot.
//   3) OpsArPage's in-page Sage-style aging tables import the bucketing
//      helpers so the on-screen tables stay in lock-step with the email.
//
// Email clients (Outlook especially) only reliably render inline styles
// on table + basic block elements.  Everything here stays email-safe:
// no external stylesheet, no flexbox/grid, no background-images.
// -----------------------------------------------------------------------

// Sage aging buckets — days mode.  Ordered, min/max inclusive.
//   • "Current" is anything not yet overdue (daysLate === 0).
//   • The tail end collapses 91-120 + >120 into a single ">90" column.
export const DAYS_BUCKETS = [
  { label: 'Current', min: 0,   max: 0    },
  { label: '1-30',    min: 1,   max: 30   },
  { label: '31-60',   min: 31,  max: 60   },
  { label: '61-90',   min: 61,  max: 90   },
  { label: '>90',     min: 91,  max: 9999 },
]

// Back-compat alias — older code referenced AGING_BUCKETS directly.
// Keep both names exported so existing imports keep compiling.
export const AGING_BUCKETS = DAYS_BUCKETS

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

// --------------------------------------------------------------------
//  Month-based aging buckets
// --------------------------------------------------------------------
// Sage-style "months" view: current month, 3 prior named months, then
// an Older catch-all.  Buckets are generated relative to `asOf` so the
// labels automatically roll forward over time.
//   Apr 21, 2026  → [Current (Apr), Mar, Feb, Jan, Older]
//   Jun 3,  2026  → [Current (Jun), May, Apr, Mar, Older]
// The Current column includes "future-dated" invoices too (ie any
// invoice whose invDate is in the current month or later).
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function buildMonthBuckets(asOf = new Date()) {
  const curY = asOf.getFullYear()
  const curM = asOf.getMonth() // 0-based
  const at = (offset) => {
    const m = ((curM - offset) % 12 + 12) % 12
    const y = curY + Math.floor((curM - offset) / 12)
    return { m, y }
  }
  const cur = at(0)
  const m1  = at(1)
  const m2  = at(2)
  const m3  = at(3)
  return [
    { label: 'Current',                      year: cur.y, month: cur.m, kind: 'current' },
    { label: `${MONTH_NAMES[m1.m]} ${m1.y}`, year: m1.y,  month: m1.m,  kind: 'month'   },
    { label: `${MONTH_NAMES[m2.m]} ${m2.y}`, year: m2.y,  month: m2.m,  kind: 'month'   },
    { label: `${MONTH_NAMES[m3.m]} ${m3.y}`, year: m3.y,  month: m3.m,  kind: 'month'   },
    { label: 'Older',                        year: null,  month: null,  kind: 'older'   },
  ]
}

// Return the bucket index (into buildMonthBuckets(asOf)) for a given
// invoice.  Invoices in the current month or newer land in Current.
export function monthBucketIndex(inv, asOf = new Date()) {
  const buckets = buildMonthBuckets(asOf)
  if (!inv.invDate) return buckets.length - 1 // Older
  const d = new Date(inv.invDate + 'T00:00:00')
  const invY = d.getFullYear()
  const invM = d.getMonth()
  const curY = asOf.getFullYear()
  const curM = asOf.getMonth()
  // Current month or later → Current bucket
  if (invY > curY || (invY === curY && invM >= curM)) return 0
  for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i]
    if (b.kind === 'month' && invY === b.year && invM === b.month) return i
  }
  return buckets.length - 1 // Older
}

// --------------------------------------------------------------------
//  Aging rollup by customer
// --------------------------------------------------------------------
// Unified helper that handles both 'days' and 'months' modes.
// Returns an array of rows:
//   {
//     customer,
//     buckets: [ { amount, invoices:[{invoice,invDate,balance}] }, ... ],
//     total,
//   }
// Each bucket carries the list of invoices making up its $ amount so the
// hover tooltip can show invoice #, date, amount.
export function agingByCustomer(invoices, opts = {}) {
  const { asOf = new Date(), mode = 'days' } = opts
  const bucketDefs = mode === 'months' ? buildMonthBuckets(asOf) : DAYS_BUCKETS
  const map = new Map()
  for (const inv of invoices) {
    const key = inv.customer || inv.job || '—'
    if (!map.has(key)) {
      map.set(key, {
        customer: key,
        buckets:  bucketDefs.map(() => ({ amount: 0, invoices: [] })),
        total:    0,
      })
    }
    const row = map.get(key)
    let bi
    if (mode === 'months') {
      bi = monthBucketIndex(inv, asOf)
    } else {
      const dl = daysLateOf(inv, asOf)
      bi = bucketDefs.findIndex((b) => dl >= b.min && dl <= b.max)
    }
    if (bi >= 0) {
      row.buckets[bi].amount += inv.balance
      row.buckets[bi].invoices.push({
        invoice: inv.invoice,
        invDate: inv.invDate,
        balance: inv.balance,
      })
    }
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

// ── Table builders for email (days mode only; inline styles) ─────────

// retainageByCust: optional { [customer]: $ } — when provided adds a Retainage column
function agingTableHtml(title, rows, bucketDefs, retainageByCust = null) {
  if (!rows.length) {
    return `<p style="margin:8px 0; color:#666; font-size:13px;">No open ${title.toLowerCase()} invoices.</p>`
  }
  const showRetainage = !!retainageByCust
  const retainageHead = showRetainage
    ? `<th align="right" style="padding:6px 10px; background:#fff3cd; border:1px solid #ccc; font-size:12px; color:#856404;">Retainage</th>`
    : ''
  const colHeads = bucketDefs.map((b) =>
    `<th align="right" style="padding:6px 10px; background:#eee; border:1px solid #ccc; font-size:12px;">${escapeHtml(b.label)}</th>`
  ).join('')
  const body = rows.map((r) => {
    const retainageCell = showRetainage
      ? `<td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; color:#856404; font-weight:600;">${retainageByCust[r.customer] ? $(retainageByCust[r.customer]) : '—'}</td>`
      : ''
    const cells = r.buckets.map((c) => {
      const v = c.amount
      return `<td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; color:${v > 0 ? '#000' : '#aaa'}">${v > 0 ? $(v) : '—'}</td>`
    }).join('')
    return `<tr>
      <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px;">${escapeHtml(r.customer)}</td>
      ${retainageCell}
      ${cells}
      <td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700;">${$(r.total)}</td>
    </tr>`
  }).join('')
  const totalsPerBucket = bucketDefs.map((_, i) =>
    rows.reduce((s, r) => s + r.buckets[i].amount, 0)
  )
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const retainageGrand = showRetainage
    ? rows.reduce((s, r) => s + (retainageByCust[r.customer] || 0), 0)
    : 0
  const retainageTotalCell = showRetainage
    ? `<td align="right" style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700; background:#fafafa;">${retainageGrand ? $(retainageGrand) : '—'}</td>`
    : ''
  const totalsRow = `<tr>
    <td style="padding:6px 10px; border:1px solid #ccc; font-size:12px; font-weight:700; background:#fafafa;">Total</td>
    ${retainageTotalCell}
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
          ${retainageHead}
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
// jobs     = optional jobs array for retainage lookup on contract aging.
// content  = { contractAging, contractDetail, serviceAging, serviceDetail } — all true by default
// asOf defaults to today but is overridable for unit tests.
export function buildArEmailHtml({
  invoices,
  jobs = [],
  asOf = new Date(),
  subject = 'Weekly A/R aging',
  content = {},
}) {
  const {
    contractAging  = true,
    contractDetail = true,
    serviceAging   = true,
    serviceDetail  = true,
  } = content

  const ar = invoices.filter((i) => i.type === 'AR')
  const sr = invoices.filter((i) => i.type === 'SR')
  const arAging = agingByCustomer(ar, { asOf })
  const srAging = agingByCustomer(sr, { asOf })
  const arList  = sortByDaysLateDesc(ar, asOf)
  const srList  = sortByDaysLateDesc(sr, asOf)
  const dateStr = asOf.toISOString().slice(0, 10)

  // Build retainage lookup from jobs
  const retainageByCust = {}
  for (const j of jobs) {
    if (j.type !== 'contract' || !j.retainageHeld) continue
    retainageByCust[j.customer] = (retainageByCust[j.customer] || 0) + j.retainageHeld
  }
  const hasRetainage = Object.keys(retainageByCust).length > 0

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

      ${contractAging ? agingTableHtml('A/R aging — Contract (AR)', arAging, DAYS_BUCKETS, hasRetainage ? retainageByCust : null) : ''}
      ${contractDetail ? invoiceListHtml('Open AR invoices — sorted by days late', arList) : ''}

      ${serviceAging ? agingTableHtml('A/R aging — Service (SR)', srAging, DAYS_BUCKETS) : ''}
      ${serviceDetail ? invoiceListHtml('Open SR invoices — sorted by days late', srList) : ''}
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
