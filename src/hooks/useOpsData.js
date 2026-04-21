import { useMemo } from 'react'
import { useOpsViewState } from '../context/OpsViewStateContext'
import {
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
  buildWeekly,
  computePayroll,
} from '../lib/opsMockData'

// Single hook that returns all the slices the ops pages need for the
// current profit-center / basis view.  When Supabase is wired, swap the
// fixture reads below for `ops.*` view queries — the return shape stays
// stable.
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
    return {
      kpis:           KPIS[pc],
      pnl:            pnlScaled,
      jobs:           JOBS[pc],
      cashflow:       CASHFLOW,
      arInvoices:     AR_INVOICES,
      apInvoices:     AP_INVOICES,
      paymentHistory: PAYMENT_HISTORY,
      kpiSparks:      KPI_SPARKS,
      permUsers:      PERM_USERS,
      payrollLines:   PAYROLL_LINES,
    }
  }, [pc, basis])
}

export { buildWeekly, computePayroll }
