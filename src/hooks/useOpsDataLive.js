// useOpsDataLive.js
// -----------------
// Supabase-backed source for the ops portal.  Queries the ops.* view
// layer (see supabase/ops_views.sql + patch_*.sql) and projects each
// slice into the exact shape the page components consume.  Falls back
// to mock fixtures when a query errors so the UI is always renderable.
//
// Gate with VITE_USE_LIVE_DATA=true (set in Netlify env -> Builds scope).
//
// IMPORTANT: cross-schema queries use `supabase.schema('ops').from(...)`,
// NOT `supabase.from('ops.tablename')`.  PostgREST treats the latter as
// a literal table name and 404s.
//
// Slices wired live (2026-04-29):
//   jobs                 ops.jobs                  (+ enrichJob in JS)
//   arInvoices           ops.ar_invoices
//   apInvoices           ops.ap_invoices
//   payrollLines         ops.payroll_lines + ops.payroll_non_job_time
//   kpis                 ops.kpis                  (formatted in JS)
//   pnl                  ops.pnl_monthly           (pivoted in JS)
//   cashflow             ops.cashflow_weekly       (pivoted in JS)
//   paymentHistory       ops.ar_payment_history
//
// Still on fixtures:
//   kpiSparks, permUsers, purchaseOrders, workOrders, arEmailDefaults
//   (no upstream sync yet for sparkline metrics, PO/WO tables.)
//
// PC filtering is intentionally a no-op today — DuBaldo is currently a
// single source-company (DDE).  Every PC value (COMBINED/DDE/DCM/SILK)
// returns the same live rollup until a multi-company sync is wired.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOpsViewState } from '../context/OpsViewStateContext'
import {
  AR_EMAIL_DEFAULTS,
  KPI_SPARKS,
  PERM_USERS,
  PURCHASE_ORDERS,
  WORK_ORDERS,
} from '../lib/opsMockData'

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

// Compact $ formatter — matches the mock's "$41.8M / $847K / $1.92M"
// style.
function formatMoney(value) {
  const v = num(value)
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v)}`
}

// Productivity / GP fields the Jobs P&L page reads but the view doesn't
// project.  Mirrors enrichJob() from opsMockData.
function enrichJob(j) {
  const labor      = num(j.labor)
  const material   = num(j.material)
  const subs       = num(j.subs)
  const equipment  = num(j.equipment)
  const bonds      = num(j.bonds)
  const permits    = num(j.permits)
  const other      = num(j.other)
  const directCost = labor + material + subs + equipment + bonds + permits + other

  const revenue = num(j.revenue)
  const gpDol   = revenue - directCost
  const gpPct   = revenue ? +(((gpDol / revenue) * 100).toFixed(1)) : 0
  const subPct  = directCost ? +(((subs / directCost) * 100).toFixed(1)) : 0

  const contract           = num(j.contract)
  const retainagePct       = num(j.retainagePct)
  const contractedRetention = +((contract * retainagePct) / 100).toFixed(2)

  return {
    ...j,
    directCost,
    gpDol,
    gpPct,
    subPct,
    contractedRetention,
    releaseSchedule: Array.isArray(j.releaseSchedule) ? j.releaseSchedule : [],
    lab: labor,
    mat: material,
    sub: subs,
    revenue,
    contract,
    retainagePct,
    retainageHeld:  num(j.retainageHeld),
    pctCmp:         num(j.pctCmp),
    budgetLaborHrs: num(j.budgetLaborHrs),
    actualLaborHrs: num(j.actualLaborHrs),
  }
}

// Merge job-coded labor rows (regHrs only) with non-job time rows
// (OT/sick/vac/holiday).  Sage doesn't allocate non-job time to a
// specific job, so we emit one synthetic row per (week, emp) carrying
// the non-reg hours under a job called "(Non-Job)".  The Payroll page's
// per-category sums stay correct without faking per-job allocation.
function mergePayroll(jobLines, nonJob) {
  const base = (jobLines || []).map((r) => ({
    ...r,
    regHrs:  num(r.regHrs),
    otHrs:   num(r.otHrs),
    sickHrs: num(r.sickHrs),
    vacHrs:  num(r.vacHrs),
    holHrs:  num(r.holHrs),
    perDiem: num(r.perDiem),
    rate:    num(r.rate),
  }))

  const synthetic = (nonJob || [])
    .filter((r) => num(r.otHrs) || num(r.sickHrs) || num(r.vacHrs) || num(r.holHrs))
    .map((r) => ({
      source_company: r.source_company,
      week:           r.week,
      emp:            r.emp,
      trade:          null,
      job:            '(Non-Job)',
      jobName:        'Non-Job Time',
      regHrs:  0,
      otHrs:   num(r.otHrs),
      sickHrs: num(r.sickHrs),
      vacHrs:  num(r.vacHrs),
      holHrs:  num(r.holHrs),
      perDiem: 0,
      // Effective rate from the pay record: total non-reg pay / non-reg hrs
      rate: (() => {
        const hrs = num(r.otHrs) + num(r.sickHrs) + num(r.vacHrs) + num(r.holHrs)
        const pay = num(r.otPay) + num(r.sickPay) + num(r.vacPay) + num(r.holPay)
        return hrs > 0 ? +(pay / hrs).toFixed(2) : 0
      })(),
      cost_amount: num(r.otPay) + num(r.sickPay) + num(r.vacPay) + num(r.holPay),
    }))

  return base.concat(synthetic)
}

// Build the KPI card array from a single ops.kpis row.
function buildKpis(k) {
  if (!k) return []
  const yoy   = k.yoy_revenue_pct
  const gpPct = k.gp_pct
  const rev   = num(k.revenue_ytd)
  const gp    = num(k.gross_profit_ytd)
  const net   = num(k.net_profit_ytd)
  const netPct = rev > 0 ? +((net / rev) * 100).toFixed(1) : 0
  return [
    { id: 'rev',  label: 'Revenue (YTD)',
      value: formatMoney(rev),
      delta: yoy != null ? `${yoy > 0 ? '+' : ''}${yoy}% YoY` : '—',
      tone:  yoy != null ? (yoy >= 0 ? 'pos' : 'neg') : 'neutral' },
    { id: 'gp',   label: 'Gross Profit',
      value: formatMoney(gp),
      delta: gpPct != null ? `${gpPct}% margin` : '—',
      tone: 'pos' },
    { id: 'net',  label: 'Net Profit',
      value: formatMoney(net),
      delta: `${netPct}% net`,
      tone: net >= 0 ? 'pos' : 'neg' },
    { id: 'cash', label: 'Cash on hand',
      value: formatMoney(k.cash_on_hand),
      delta: `${num(k.cash_account_count)} accounts`,
      tone: 'neutral' },
    { id: 'ar',   label: 'A/R (balance)',
      value: formatMoney(k.ar_balance),
      delta: `DSO ${num(k.dso_days)} d`,
      tone: 'neutral' },
    { id: 'ap',   label: 'A/P (balance)',
      value: formatMoney(k.ap_balance),
      delta: `DPO ${num(k.dpo_days)} d`,
      tone: 'neutral' },
  ]
}

// Pivot ops.pnl_monthly rows into the arrays-by-month shape the chart
// expects.  Rows are already month-sorted by the view's ORDER BY.
function buildPnl(rows) {
  const months   = rows.map((r) => r.month_label)
  const revenue  = rows.map((r) => num(r.revenue))
  const cogs     = rows.map((r) => num(r.cogs))
  const burden   = rows.map((r) => num(r.burden))
  const gp       = rows.map((r) => num(r.gp))
  const overhead = rows.map((r) => num(r.overhead))
  const net      = rows.map((r) => num(r.net))
  const gpPct    = rows.map((r) => num(r.gp_pct))
  // No prior-year / goal series in the DB yet — synthesise per the
  // mock's heuristic so the chart's overlay lines render.
  const priorRevenue = revenue.map((r) => Math.round(r * 0.93))
  const goalRevenue  = revenue.map((r) => Math.round(r * 1.05))
  return {
    labels: months,
    revenue, cogs, burden, gp, overhead, net, gpPct,
    priorRevenue, goalRevenue,
  }
}

// Pivot ops.cashflow_weekly rows into the arrays shape the cashflow
// chart consumes.
function buildCashflow(rows) {
  const sorted = [...rows].sort((a, b) => a.week_num - b.week_num)
  return {
    weeks:   sorted.map((r) => r.week_label),
    cash:    sorted.map((r) => num(r.cash)),
    inflow:  sorted.map((r) => num(r.inflow)),
    outflow: sorted.map((r) => num(r.outflow)),
  }
}

// ---------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------
async function fetchOpsSlices() {
  const ops = supabase.schema('ops')

  const [
    jobs, ar, ap, pay, payNon,
    kpis, pnl, cf, paymentHistory, lastSync,
  ] = await Promise.all([
    ops.from('jobs').select('*'),
    ops.from('ar_invoices').select('*'),
    ops.from('ap_invoices').select('*'),
    ops.from('payroll_lines').select('*'),
    ops.from('payroll_non_job_time').select('*'),
    ops.from('kpis').select('*').limit(1).maybeSingle(),
    ops.from('pnl_monthly').select('*'),
    ops.from('cashflow_weekly').select('*'),
    ops.from('ar_payment_history').select('*'),
    ops.from('last_sync').select('*').limit(1).maybeSingle(),
  ])

  // Critical slices that must succeed for the live path to be usable.
  const critical = [jobs, ar, ap, pay]
  const firstCritical = critical.find((r) => r.error)
  if (firstCritical) throw firstCritical.error

  // Soft errors on secondary slices: log and degrade to empty rather
  // than failing the whole hook.  Keeps the AR/AP/Jobs pages live even
  // if the new patch hasn't been applied yet.
  for (const [label, r] of [
    ['payroll_non_job_time', payNon],
    ['kpis',                 kpis],
    ['pnl_monthly',          pnl],
    ['cashflow_weekly',      cf],
    ['ar_payment_history',   paymentHistory],
  ]) {
    if (r.error) {
      // eslint-disable-next-line no-console
      console.warn(`[useOpsDataLive] ${label} not available — falling back to empty:`, r.error)
    }
  }

  return {
    jobs:           (jobs.data || []).map(enrichJob),
    arInvoices:     ar.data   || [],
    apInvoices:     ap.data   || [],
    payrollLines:   mergePayroll(pay.data, payNon.error ? [] : payNon.data),
    kpisRow:        kpis.error ? null : (kpis.data || null),
    pnlRows:        pnl.error  ? []   : (pnl.data  || []),
    cashflowRows:   cf.error   ? []   : (cf.data   || []),
    paymentHistory: paymentHistory.error ? [] : (paymentHistory.data || []),
    lastSync:       lastSync?.data || null,
  }
}

// ---------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------
export function useOpsDataLive() {
  const { pc, basis } = useOpsViewState()
  const [state, setState] = useState({
    loading: true,
    error:   null,
    live:    null,
  })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchOpsSlices()
      .then((live) => { if (!cancelled) setState({ loading: false, error: null, live }) })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[useOpsDataLive] live query failed; falling back to mocks:', error)
        if (!cancelled) setState({ loading: false, error, live: null })
      })
    return () => { cancelled = true }
  }, [])

  if (!state.live) {
    return { ...state, data: null }
  }

  const {
    jobs, arInvoices, apInvoices, payrollLines,
    kpisRow, pnlRows, cashflowRows, paymentHistory, lastSync,
  } = state.live

  // Build the derived shapes once per fetch.  The cash-basis "clip"
  // (94 % revenue) replicates the mock's quick-and-dirty cash-vs-accrual
  // toggle until the view layer accepts a basis param.
  const adjust = basis === 'Cash' ? 0.94 : 1
  const pnlLive = buildPnl(pnlRows)
  const pnlScaled = adjust === 1 ? pnlLive : {
    ...pnlLive,
    revenue:  pnlLive.revenue.map((v) => Math.round(v * adjust)),
    cogs:     pnlLive.cogs.map((v) => Math.round(v * adjust)),
    burden:   pnlLive.burden.map((v) => Math.round(v * adjust)),
    gp:       pnlLive.gp.map((v) => Math.round(v * adjust)),
    overhead: pnlLive.overhead.map((v) => Math.round(v * adjust)),
    net:      pnlLive.net.map((v) => Math.round(v * adjust)),
  }

  return {
    loading: false,
    error:   null,
    lastSync,
    data: {
      kpis:            buildKpis(kpisRow),
      pnl:             pnlScaled,
      jobs:            jobs,
      cashflow:        buildCashflow(cashflowRows),
      arInvoices:      arInvoices,
      apInvoices:      apInvoices,
      paymentHistory:  paymentHistory,
      kpiSparks:       KPI_SPARKS,        // still mock — no source yet
      permUsers:       PERM_USERS,         // still mock
      payrollLines:    payrollLines,
      purchaseOrders:  PURCHASE_ORDERS,    // still mock — Sage POs not synced
      workOrders:      WORK_ORDERS,        // still mock — Sage WOs not synced
      arEmailDefaults: AR_EMAIL_DEFAULTS,
    },
  }
}
