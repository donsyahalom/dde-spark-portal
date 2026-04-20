// Formatting helpers for the Operations dashboard — ported from the
// Next.js scaffold's src/lib/format.ts.  Mirrors the HTML mockup.

export const fmt = (n) =>
  '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const fmtK = (n) => {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K'
  return '$' + n.toFixed(0)
}

export const pct = (n, digits = 1) => n.toFixed(digits) + '%'

export const dOrDash = (n) =>
  n == null || Number.isNaN(n) ? '—' : Math.round(n) + ' d'
