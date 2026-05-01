// useOpsDataLive.js
// -----------------
// Supabase-backed source for the ops portal.  Queries the ops.* view
// layer and projects each slice into the exact shape the page components
// consume.  Falls back to mock fixtures when a query errors so the UI is
// always renderable.
//
// Gate with VITE_USE_LIVE_DATA=true (set in Netlify env -> Builds scope).
//
// IMPORTANT: cross-schema queries use `supabase.schema('ops').from(...)`,
// NOT `supabase.from('ops.tablename')`.  PostgREST treats the latter as
// a literal table name and 404s.
//
// Slices wired live:
//   jobs                 ops.jobs                  (+ enrichJob in JS)
//   arInvoices           ops.ar_invoices           (type honors override)
//   apInvoices           ops.ap_invoices
//   payrollLines         ops.payroll_lines + ops.payroll_non_job_time
//   pnl                  ops.pnl_monthly           (pivoted in JS)
//   cashflow             ops.cashflow_weekly       (pivoted in JS)
//   paymentHistory       ops.ar_payment_history
//   cashAccounts         ops.gl_cash_accounts      (real bank list)
//   permUsers            ops.dashboard_users       (auto from public.employees)
//
// Empty by request:
//   kpis           — Don asked to remove all and start fresh.  KpisPage
//                    is now a clean slate where customs can be added.
//
// On-demand:
//   loadModeledOt()      ops.payroll_modeled_ot   (Payroll page button)
//
// Mutations (admin-only via RLS):
//   setJobTypeOverride({ source_company, job_recnum, override_type, set_by_email })
//   clearJobTypeOverride({ source_company, job_recnum })

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOpsViewState } from '../context/OpsViewStateContext'
import {
  AR_EMAIL_DEFAULTS,
  KPI_SPARKS,
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

  const contract            = num(j.contract)
  const retainagePct        = num(j.retainagePct)
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
    typeOverridden: Boolean(j.typeOverridden),
  }
}

// Merge job-coded labor rows (regHrs only) with non-job time rows
// (OT/sick/vac/holiday).  Sage doesn't allocate non-job time to a
// specific job, so we emit one synthetic row per (week, emp) carrying
// the non-reg hours under a job called "(Non-Job)".
//
// Per Don's directive ("remove per diem. The company does not do that.")
// every output row carries perDiem = 0 regardless of source.
function mergePayroll(jobLines, nonJob) {
  const base = (jobLines || []).map((r) => ({
    ...r,
    regHrs:  num(r.regHrs),
    otHrs:   num(r.otHrs),
    sickHrs: num(r.sickHrs),
    vacHrs:  num(r.vacHrs),
    holHrs:  num(r.holHrs),
    perDiem: 0,                 // hard-zeroed — DDE does not pay per diem
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
      rate: (() => {
        const hrs = num(r.otHrs) + num(r.sickHrs) + num(r.vacHrs) + num(r.holHrs)
        const pay = num(r.otPay) + num(r.sickPay) + num(r.vacPay) + num(r.holPay)
        return hrs > 0 ? +(pay / hrs).toFixed(2) : 0
      })(),
      cost_amount: num(r.otPay) + num(r.sickPay) + num(r.vacPay) + num(r.holPay),
    }))

  return base.concat(synthetic)
}

// Apply modeled OT rows over base payroll lines.  For each
// (week, emp, job) match, replace the row's otHrs with the modeled
// value and zero the row's contribution to "(Non-Job)" OT.
export function applyModeledOt(baseLines, modeledRows) {
  if (!modeledRows || !modeledRows.length) return baseLines
  const key = (r) => `${r.source_company}|${r.week}|${(r.emp || '').toLowerCase()}|${r.job}`
  const ix = new Map()
  for (const m of modeledRows) {
    ix.set(key(m), { otHrs: num(m.modeledOtHrs) })
  }
  // Strip out the synthetic Non-Job OT rows (modeling moves it onto
  // jobs) but keep sick/vac/holiday rows as-is.
  return baseLines
    .filter((r) => !(r.job === '(Non-Job)' && num(r.otHrs) > 0
                     && !num(r.sickHrs) && !num(r.vacHrs) && !num(r.holHrs)))
    .map((r) => {
      const m = ix.get(key(r))
      return m ? { ...r, otHrs: m.otHrs } : r
    })
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
  const priorRevenue = revenue.map((r) => Math.round(r * 0.93))
  const goalRevenue  = revenue.map((r) => Math.round(r * 1.05))
  // Surface raw month_iso so the page can slice by YTD/QTD/MTD against
  // a real date instead of a label string.
  const monthIso = rows.map((r) => r.month_iso || r.month_label)
  return {
    labels: months,
    monthIso,
    revenue, cogs, burden, gp, overhead, net, gpPct,
    priorRevenue, goalRevenue,
  }
}

// Pivot ops.cashflow_weekly rows into the arrays shape the cashflow
// chart consumes.  The view returns at most 13 rows per company; we
// clip defensively in case more sneak through.
function buildCashflow(rows) {
  const sorted = [...rows]
    .sort((a, b) => a.week_num - b.week_num)
    .filter((r) => r.week_num >= 1 && r.week_num <= 13)
  return {
    weeks:   sorted.map((r) => r.week_label),
    cash:    sorted.map((r) => num(r.cash)),
    inflow:  sorted.map((r) => num(r.inflow)),
    outflow: sorted.map((r) => num(r.outflow)),
  }
}

// Project ops.dashboard_users into the permUsers shape pages expect.
// Visibility lists start empty — wire to a settings table later.
function buildPermUsers(rows) {
  return (rows || []).map((u) => ({
    sparksId:       u.sparks_id,
    name:           u.name,
    email:          u.email,
    role:           u.role,
    is_admin:       Boolean(u.is_admin),
    pcs:            ['DDE', 'DCM', 'SILK'],
    hiddenTabs:     [],
    hiddenFields:   [],
    jobAccess:      'all',
    jobAccessList:  [],
  }))
}

// ---------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------
async function fetchOpsSlices() {
  const ops = supabase.schema('ops')

  const [
    jobs, ar, ap, pay, payNon,
    pnl, cf, paymentHistory, lastSync,
    cashAccts, permUsers,
  ] = await Promise.all([
    ops.from('jobs').select('*'),
    ops.from('ar_invoices').select('*'),
    ops.from('ap_invoices').select('*'),
    ops.from('payroll_lines').select('*'),
    ops.from('payroll_non_job_time').select('*'),
    ops.from('pnl_monthly').select('*'),
    ops.from('cashflow_weekly').select('*'),
    ops.from('ar_payment_history').select('*'),
    ops.from('last_sync').select('*').limit(1).maybeSingle(),
    ops.from('gl_cash_accounts').select('*'),
    ops.from('dashboard_users').select('*'),
  ])

  const critical = [jobs, ar, ap, pay]
  const firstCritical = critical.find((r) => r.error)
  if (firstCritical) throw firstCritical.error

  for (const [label, r] of [
    ['payroll_non_job_time', payNon],
    ['pnl_monthly',          pnl],
    ['cashflow_weekly',      cf],
    ['ar_payment_history',   paymentHistory],
    ['gl_cash_accounts',     cashAccts],
    ['dashboard_users',      permUsers],
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
    pnlRows:        pnl.error  ? []   : (pnl.data  || []),
    cashflowRows:   cf.error   ? []   : (cf.data   || []),
    paymentHistory: paymentHistory.error ? [] : (paymentHistory.data || []),
    cashAccounts:   cashAccts.error ? [] : (cashAccts.data || []),
    permUsers:      permUsers.error ? [] : buildPermUsers(permUsers.data),
    lastSync:       lastSync?.data || null,
  }
}

// On-demand fetch for the Payroll page's "Model OT" button.
async function fetchModeledOt() {
  const { data, error } = await supabase
    .schema('ops').from('payroll_modeled_ot').select('*')
  if (error) throw error
  return data || []
}

// Admin-only mutation.  RLS on ops.job_type_overrides gates writes to
// users with public.employees.is_admin = TRUE.
async function upsertJobTypeOverride({ source_company, job_recnum, override_type, set_by_email }) {
  const payload = {
    source_company,
    job_recnum,
    override_type,
    set_by_email: set_by_email || null,
    set_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .schema('ops')
    .from('job_type_overrides')
    .upsert(payload, { onConflict: 'source_company,job_recnum' })
  if (error) throw error
}

async function deleteJobTypeOverride({ source_company, job_recnum }) {
  const { error } = await supabase
    .schema('ops')
    .from('job_type_overrides')
    .delete()
    .eq('source_company', source_company)
    .eq('job_recnum', job_recnum)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------
export function useOpsDataLive() {
  const { basis } = useOpsViewState()
  const [state, setState] = useState({
    loading: true,
    error:   null,
    live:    null,
    refreshTick: 0,
  })

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, refreshTick: s.refreshTick + 1 }))
  }, [])

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchOpsSlices()
      .then((live) => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: null, live })) })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[useOpsDataLive] live query failed; falling back to mocks:', error)
        if (!cancelled) setState((s) => ({ ...s, loading: false, error, live: null }))
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.refreshTick])

  const apis = {
    refresh,
    loadModeledOt:        fetchModeledOt,
    setJobTypeOverride:   upsertJobTypeOverride,
    clearJobTypeOverride: deleteJobTypeOverride,
  }

  if (!state.live) {
    return { ...state, data: null, ...apis }
  }

  const {
    jobs, arInvoices, apInvoices, payrollLines,
    pnlRows, cashflowRows, paymentHistory, cashAccounts, permUsers, lastSync,
  } = state.live

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
    ...apis,
    data: {
      // Don asked to remove all KPIs and start fresh.
      kpis:            [],
      pnl:             pnlScaled,
      jobs,
      cashflow:        buildCashflow(cashflowRows),
      arInvoices,
      apInvoices,
      paymentHistory,
      cashAccounts,
      permUsers,
      kpiSparks:       KPI_SPARKS,        // page no longer renders these
      payrollLines,
      purchaseOrders:  PURCHASE_ORDERS,    // still mock — Sage POs not synced
      workOrders:      WORK_ORDERS,        // still mock — Sage WOs not synced
      arEmailDefaults: AR_EMAIL_DEFAULTS,
    },
  }
}
