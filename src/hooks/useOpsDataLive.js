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
//
// PC filtering note (2026-04-29):
// The original mock-only filter assumed job numbers were short numeric
// codes (e.g. "23-100") and split AR.job by space to recover the leading
// num token.  Real DuBaldo Sage data uses multi-word short_names (e.g.
// "Empire Industries"), so the split-by-space heuristic drops every row.
// Today the underlying sage.* data is single-source-company (DuBaldo),
// so PC subdivision (DDE / DCM / SILK) has no DB-side support yet — we
// pass the full live result through unfiltered.  Add a real
// profit_center column upstream and re-introduce server-side filtering
// when that lands.

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

  // PC filter is intentionally a no-op today — see file header.  We pass
  // every live row through and rely on the source-company filter at the
  // DB level for scoping.
  return {
    loading: false,
    error:   null,
    lastSync,
    data: {
      kpis:            KPIS[pc],            // still mock
      pnl:             pnlScaled,           // still mock
      jobs:            jobs,                // LIVE — unfiltered
      cashflow:        CASHFLOW,            // still mock
      arInvoices:      arInvoices,          // LIVE — unfiltered
      apInvoices:      apInvoices,          // LIVE — unfiltered
      paymentHistory:  PAYMENT_HISTORY,     // still mock
      kpiSparks:       KPI_SPARKS,          // still mock
      permUsers:       PERM_USERS,          // still mock
      payrollLines:    payrollLines,        // LIVE — unfiltered
      purchaseOrders:  PURCHASE_ORDERS,     // still mock (no live source yet)
      workOrders:      WORK_ORDERS,         // still mock (no live source yet)
      arEmailDefaults: AR_EMAIL_DEFAULTS,
    },
  }
}
