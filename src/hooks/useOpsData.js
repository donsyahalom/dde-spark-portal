import { useMemo } from 'react'
import { useOpsViewState } from '../context/OpsViewStateContext'
import {
  AR_EMAIL_DEFAULTS,
  AR_INVOICES,
  AP_INVOICES,
  CASHFLOW,
  JOBS,
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
import { useOpsDataLive } from './useOpsDataLive'

// Feature flag — set VITE_USE_LIVE_DATA=true in Netlify env to drive
// the portal from the Sage->Supabase sync instead of fixtures.  Any
// failure in the live path falls back to fixtures so the UI is always
// renderable during the rollout.
const USE_LIVE = String(import.meta.env.VITE_USE_LIVE_DATA || '').toLowerCase() === 'true'

// Single hook that returns all the slices the ops pages need for the
// current profit-center / basis view.  Returns a stable shape across
// fixture + live paths.
//
// Live mode also exposes API methods on the returned object:
//   refresh()                                 — re-fetch all slices
//   loadModeledOt()                           — fetch ops.payroll_modeled_ot
//   setJobTypeOverride({ source_company, job_recnum, override_type, set_by_email })
//   clearJobTypeOverride({ source_company, job_recnum })
//
// Fixture mode no-ops these (returns Promises that resolve immediately)
// so the UI can be developed offline.
export function useOpsData() {
  const { pc, basis } = useOpsViewState()
  const live = useOpsDataLive()

  return useMemo(() => {
    // Live path — pages get a single object with both data and APIs.
    if (USE_LIVE && live.data) {
      return {
        ...live.data,
        // expose mutation/refresh APIs the pages need
        refresh:              live.refresh,
        loadModeledOt:        live.loadModeledOt,
        setJobTypeOverride:   live.setJobTypeOverride,
        clearJobTypeOverride: live.clearJobTypeOverride,
      }
    }

    // Fixture path — unchanged behaviour, with shimmed APIs so pages
    // don't crash when toggling the override or clicking Model OT.
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
      // Don asked to remove all KPIs and start fresh — match in fixture mode.
      kpis:            [],
      pnl:             pnlScaled,
      jobs:            jobsForPc,
      cashflow:        CASHFLOW,
      arInvoices:      AR_INVOICES,
      apInvoices:      AP_INVOICES,
      paymentHistory:  PAYMENT_HISTORY,
      kpiSparks:       KPI_SPARKS,
      permUsers:       PERM_USERS,
      payrollLines:    PAYROLL_LINES.map((r) => ({ ...r, perDiem: 0 })),
      purchaseOrders,
      workOrders,
      cashAccounts:    [],
      arEmailDefaults: AR_EMAIL_DEFAULTS,
      // shimmed APIs for fixture / dev mode
      refresh:              () => {},
      loadModeledOt:        async () => [],
      setJobTypeOverride:   async () => {},
      clearJobTypeOverride: async () => {},
    }
  }, [pc, basis, live.data, live.refresh, live.loadModeledOt, live.setJobTypeOverride, live.clearJobTypeOverride])
}

export { buildWeekly, companyProductivity, computePayroll, jobProductivity }
