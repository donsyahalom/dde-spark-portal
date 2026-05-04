import { useMemo } from 'react'
import { useOpsViewState } from '../context/OpsViewStateContext'
import {
  AR_EMAIL_DEFAULTS,
  AR_INVOICES,
  AP_INVOICES,
  CASHFLOW,
  JOBS,
  KPIS,
  KPI_SPARKS,
  PAYMENT_HISTORY,
  PAYROLL_LINES,
  PERM_USERS,
  PNL,
  PURCHASE_ORDERS,
  WORK_ORDERS,
  buildWeekly,
  computePayroll,
} from '../lib/opsMockData'
import { jobProductivity, companyProductivity } from '../lib/opsProductivity'
import { useOpsDataLive } from './useOpsDataLive'

// Feature flag — set VITE_USE_LIVE_DATA=true in Netlify env (Builds
// scope) to drive the portal from the Sage->Supabase sync instead of
// fixtures.  Any failure in the live path (query error, ops.* views
// not yet created, schema not exposed in Supabase API settings, empty
// tables because the first sync hasn't run) falls back to fixtures so
// the UI is always renderable during the rollout.
const USE_LIVE = String(import.meta.env.VITE_USE_LIVE_DATA || '').toLowerCase() === 'true'

// Single hook that returns all the slices the ops pages need for the
// current profit-center / basis view.  When USE_LIVE is on and the
// live query has resolved, we return its data; otherwise we serve
// fixtures so pages always render.
export function useOpsData() {
  const { pc, basis } = useOpsViewState()
  const live = useOpsDataLive()

  // Expose loading so pages can show a spinner without returning null
  // (which would violate React hook rules if hooks follow the call site).
  const loading = USE_LIVE && live.loading

  return useMemo(() => {
    if (USE_LIVE && live.data) {
      return { ...live.data, loading: false }
    }
    const pnl = PNL[pc]
    const adjust = basis === 'Cash' ? 0.94 : 1
    const pnlScaled = {
      ...pnl,
      revenue:  pnl.revenue.map((v) => Math.round(v * adjust)),
      cogs:     pnl.cogs.map((v) => Math.round(v * adjust)),
      burden:   pnl.burden.map((v) => Math.round(v * adjust)),
      gp:       pnl.gp.map((v) => Math.round(v * adjust)),
      overhead: pnl.overhead.map((v) => Math.round(v * adjust)),
      net:      pnl.net.map((v) => Math.round(v * adjust)),
    }
    const jobsForPc = JOBS[pc]
    const jobNums   = new Set(jobsForPc.map((j) => j.num))
    const purchaseOrders = PURCHASE_ORDERS.filter((p) => jobNums.has(p.jobNum))
    const workOrders     = WORK_ORDERS.filter((w) => jobNums.has(w.jobNum))
    return {
      loading,
      kpis:            KPIS[pc],
      pnl:             pnlScaled,
      jobs:            jobsForPc,
      cashflow:        CASHFLOW,
      arInvoices:      AR_INVOICES,
      apInvoices:      AP_INVOICES,
      paymentHistory:  PAYMENT_HISTORY,
      kpiSparks:       KPI_SPARKS,
      permUsers:       PERM_USERS,
      payrollLines:    PAYROLL_LINES,
      purchaseOrders,
      workOrders,
      arEmailDefaults: AR_EMAIL_DEFAULTS,
    }
  }, [pc, basis, live.data, loading])
}

export { buildWeekly, companyProductivity, computePayroll, jobProductivity }
