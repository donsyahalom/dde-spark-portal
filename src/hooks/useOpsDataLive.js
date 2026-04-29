// useOpsDataLive.js
// -----------------
// Supabase-backed version of useOpsData.  Reads the `ops.*` view layer
// defined in sage-supabase-sync/ops_views.sql and returns the exact same
// shape as the mock-backed useOpsData() so pages don't need to change.
//
// Gate with VITE_USE_LIVE_DATA=true (set in Netlify env -> Builds scope).
// When the flag is off (or the query fails), the consumer hook
// (useOpsData) falls back to opsMockData fixtures so the UI is always
// renderable.
//
// The initial cut wires four slices: jobs, arInvoices, apInvoices,
// payrollLines.  The rest (kpis, pnl, cashflow, paymentHistory,
// kpiSparks, permUsers, purchaseOrders, workOrders, arEmailDefaults)
// stay on fixtures until their upstream sync pieces land — we return
// fixture values for those so every page keeps rendering during the
// partial migration.
//
// IMPORTANT: cross-schema queries use `supabase.schema('ops').from(...)`,
// NOT `supabase.from('ops.tablename')`.  PostgREST treats the latter as
// a literal table name and 404s.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOpsViewState } from '../context/OpsViewStateContext'
import {
  AR_EMAIL_DEFAULTS,
  CASHFLOW,
  KPIS,
  KPI_SPARKS,
  PAYMENT_HISTORY,
  PERM_USERS,
  PNL,
  PURCHASE_ORDERS,
  WORK_ORDERS,
} from '../lib/opsMockData'

// Profit-center filter.  Today sage.* is a single-company scope so
// every PC sees the same jobs; the filter is a client-side predicate on
// the job number prefix ('SV-DDE-…', 'D…', 'S…') that matches the
// convention used in the mock fixtures.  Swap to a server-side filter
// once the data model learns about profit centers (probably a
// sage.job_profit_center column populated via the cost-code prefix).
function jobMatchesPc(job, pc) {
  if (pc === 'COMBINED') return true
  const n = String(job.num || '')
  if (pc === 'DDE')  return n.startsWith('2') || n.startsWith('SV-DDE')
  if (pc === 'DCM')  return n.startsWith('D') || n.startsWith('SV-DCM')
  if (pc === 'SILK') return n.startsWith('S') && !n.startsWith('SV-DCM')
  return true
}

async function fetchOpsSlices() {
  // Run the view queries in parallel.  Each returns { data, error };
  // we surface the *first* error so the fallback triggers cleanly.
  //
  // .schema('ops') is the supported way to query a non-public schema in
  // supabase-js v2.  Requires the `ops` schema to be added to the
  // "Exposed schemas" list in Supabase Project Settings -> API.
  const ops = supabase.schema('ops')

  const [jobs, ar, ap, pay, lastSync] = await Promise.all([
    ops.from('jobs').select('*'),
    ops.from('ar_invoices').select('*'),
    ops.from('ap_invoices').select('*'),
    ops.from('payroll_lines').select('*'),
    ops.from('last_sync').select('*').limit(1).single(),
  ])

  const firstError = [jobs, ar, ap, pay].find((r) => r.error)
  if (firstError) throw firstError.error

  return {
    jobs:         jobs.data || [],
    arInvoices:   ar.data || [],
    apInvoices:   ap.data || [],
    payrollLines: pay.data || [],
    lastSync:     lastSync?.data || null,
  }
}

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
        // Surface to the console so the cutover failure mode is
        // diagnosable without opening the network tab.
        // eslint-disable-next-line no-console
        console.error('[useOpsDataLive] live query failed; falling back to mocks:', error)
        if (!cancelled) setState({ loading: false, error, live: null })
      })
    return () => { cancelled = true }
  }, [])

  // While loading or on error, the caller gets `null` for live slices
  // and decides whether to show a spinner or fall back to mocks.
  if (!state.live) {
    return { ...state, data: null }
  }

  const { jobs, arInvoices, apInvoices, payrollLines, lastSync } = state.live

  // Filter jobs to the selected PC, then restrict invoice / payroll
  // rows to jobs visible in that PC so each page shows a coherent slice.
  const jobsForPc = jobs.filter((j) => jobMatchesPc(j, pc))
  const jobNums   = new Set(jobsForPc.map((j) => j.num))

  // Same Cash-basis revenue clip we apply to mock PnL.  Once the live
  // P&L view lands, migrate this scaling inside the view.
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

  return {
    loading: false,
    error:   null,
    lastSync,
    data: {
      kpis:            KPIS[pc],            // still mock
      pnl:             pnlScaled,           // still mock
      jobs:            jobsForPc,           // LIVE
      cashflow:        CASHFLOW,            // still mock
      arInvoices:      arInvoices.filter((i) => !i.job || jobNums.has((i.job || '').split(' ')[0])),
      apInvoices,                           // LIVE (no PC filter)
      paymentHistory:  PAYMENT_HISTORY,     // still mock
      kpiSparks:       KPI_SPARKS,          // still mock
      permUsers:       PERM_USERS,          // still mock
      payrollLines:    payrollLines.filter((p) => jobNums.has(p.job)),
      purchaseOrders:  PURCHASE_ORDERS.filter((p) => jobNums.has(p.jobNum)),
      workOrders:      WORK_ORDERS.filter((w) => jobNums.has(w.jobNum)),
      arEmailDefaults: AR_EMAIL_DEFAULTS,
    },
  }
}
