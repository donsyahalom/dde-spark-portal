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
  companyProductivity,
  computePayroll,
  jobProductivity,
} from '../lib/opsMockData'

// Single hook that returns all the slices the ops pages need for the
// current profit-center / basis view.  When Supabase is wired, swap the
// fixture reads below for `ops.*` view queries — the return shape stays
// stable.
//
// Notes on the new data:
//   • `jobs` now carries split direct-cost buckets (labor/material/subs/
//     equipment/bonds/permits/other) plus type (contract|service),
//     retainage + release schedule, and labor-hour inputs for
//     productivity.  Back-compat aliases `lab/mat/sub` are preserved so
//     older table code keeps working while pages are migrated.
//   • `purchaseOrders` is filtered to the current PC's job list so the
//     Jobs P&L expanded row + commits roll-up show only relevant POs.
//   • `workOrders` is filtered similarly and drives the service-jobs
//     detail view on the Jobs page.
//   • `arEmailDefaults` seeds the weekly A/R email settings panel; the
//     user-saved overrides live in localStorage until Supabase wires.
export function useOpsData() {
  const { pc, basis } = useOpsViewState()

  return useMemo(() => {
    const pnl = PNL[pc]
    // Cash basis just clips revenue slightly to fake cash-timing lag —
    // same as the mockup.  Keeping the shape parallel to Accrual means
    // chart components don't need to care.
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

    // Jobs for the selected profit center — used to filter POs/WOs so we
    // only surface data relevant to what's on screen.
    const jobsForPc = JOBS[pc]
    const jobNums   = new Set(jobsForPc.map((j) => j.num))

    const purchaseOrders = PURCHASE_ORDERS.filter((p) => jobNums.has(p.jobNum))
    const workOrders     = WORK_ORDERS.filter((w) => jobNums.has(w.jobNum))

    return {
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
  }, [pc, basis])
}

export { buildWeekly, companyProductivity, computePayroll, jobProductivity }
