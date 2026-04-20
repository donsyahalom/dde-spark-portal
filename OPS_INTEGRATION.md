# Ops dashboard — integration notes

This document explains how the DuBaldo operations/finance dashboard was
merged into the Sparks portal, what to look at first, and what's still
open.

## What's new

The dashboard now lives inside this repo. Admins and Owners get a new
**📊 Ops** link in the header that opens a nested `/ops/*` area with
eight tabs:

    /ops                Overview        (company KPIs + monthly rev/COGS/GP)
    /ops/pnl            Company P&L
    /ops/jobs           Jobs P&L        (sortable, Top-N, expandable)
    /ops/cashflow       Cashflow        (13-week forecast, basis selector)
    /ops/ar             A/R Detail      (+ Payment History panel)
    /ops/ap             A/P Detail
    /ops/kpis           KPIs            (sparklines + Custom KPI form)
    /ops/permissions    Permissions

Everything is wrapped by Sparks' existing `<ProtectedRoute><Layout />`,
so login, password-change redirect, and the UAT banner behave exactly
the same as on the rest of the portal.

## Why this shape

The original dashboard was a separate Next.js 15 app. We chose to port
it in-place as `.jsx` files rather than run it as a reverse-proxied
subdomain because:

- Same Supabase project — the `employees` / `dashboard_access` tables
  are already there, no cross-origin SSO fiddling.
- Same auth — reuse `useAuth()` and `currentUser` directly.
- One Netlify deploy, one domain, one codebase.
- Sparks design tokens (--gold, --bg-darker, Cinzel) carry across, so
  the dashboard visually belongs inside the portal.

The trade-off: the dashboard is no longer Next.js (no App Router, no
server components). That's fine — all the pages were `"use client"`
anyway, and no data-fetching lived on the server.

## File map

New files, all scoped to `ops` so they can't collide with Sparks code:

    src/
    ├─ ops.css                                    # design-token-based styles
    ├─ lib/
    │   ├─ opsFormat.js                           # fmt / fmtK / pct
    │   ├─ opsChartOpts.js                        # moneyLineOpts / sparkOpts / PALETTE
    │   └─ opsMockData.js                         # mirrors the HTML mockup
    ├─ context/
    │   ├─ OpsViewStateContext.jsx                # pc / basis / period / compare
    │   └─ OpsCashflowBasisContext.jsx            # cashflow basis + per-customer map
    ├─ hooks/
    │   └─ useOpsData.js                          # single Supabase swap-point
    ├─ components/ops/
    │   ├─ OpsChartBox.jsx                        # Chart.js registration + fixed box
    │   ├─ OpsKpiCard.jsx
    │   ├─ OpsSectionCard.jsx
    │   ├─ OpsPaymentHistory.jsx                  # Apply-to-Cashflow handler lives here
    │   └─ OpsLayout.jsx                          # sub-nav + toolbar, sits inside main Layout
    └─ pages/ops/
        ├─ OpsOverviewPage.jsx
        ├─ OpsPnlPage.jsx
        ├─ OpsJobsPage.jsx
        ├─ OpsCashflowPage.jsx
        ├─ OpsArPage.jsx
        ├─ OpsApPage.jsx
        ├─ OpsKpisPage.jsx
        └─ OpsPermissionsPage.jsx

Modified files:

    package.json            + chart.js, + react-chartjs-2
    src/App.jsx             + OpsRoute guard, + <Route path="ops"> subtree
    src/components/Layout.jsx + "📊 Ops" NavLink (admin / Owner only)

## Auth gate

Ops is gated twice — once in `App.jsx` (`OpsRoute`) and once in
`Layout.jsx` (the NavLink is hidden from non-admins / non-Owners):

    canSeeOps = currentUser.is_admin || currentUser.job_grade === 'Owner'

When we're ready to go finer-grained, replace this with a per-row
lookup against a new `ops_access` table, and expose a boolean on
`currentUser` from `AuthContext.refreshUser()`.

## The "Apply to Cashflow" flow (worth understanding)

On `/ops/ar`, the Payment History panel lets the user pick a sample
(Active/Inactive, time window, Top-N, outlier trim). Clicking
**Apply to Cashflow**:

1. Snapshots **per-customer** avg days-to-pay into
   `OpsCashflowBasisContext.perCustomer`.
2. Sets `basis = 'payhist'`.
3. Records a fallback portfolio avg for customers not in the sample.
4. Navigates to `/ops/cashflow`.

The Cashflow banner on `/ops/cashflow` then narrates what the user sees:
"N customers are shifted by their own observed avg days-to-pay (median
Md, range min–max). Customers outside that sample fall back to the
portfolio avg of Fd."

## Pre-existing bug we didn't fix

`App.jsx` already had two routes both mounted at `path="dashboard"`
(`DashboardPage` and `UserDashboardPage`). We left that alone — the
ops subtree uses `path="ops"` so it doesn't collide. If you want to
clean up the duplicate at some point, one of those should become
something like `path="my-dashboard"` or be gated behind role.

## Running it

    npm install         # pulls in chart.js + react-chartjs-2
    npm run dev         # vite on :5173 (or whatever your vite.config says)

Log in as an admin or as a user with `job_grade = 'Owner'` to see the
📊 Ops link. Everything inside `/ops/*` reads from
`src/lib/opsMockData.js` — no network calls yet, so you can explore
without touching Supabase.

## Swapping mock data for Supabase

Every page reads data through `useOpsData()`. When the `ops.*` views
are live:

1. Fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (already
   used elsewhere in Sparks).
2. In `src/hooks/useOpsData.js`, replace the mock lookups with queries
   against the corresponding `ops.*` view (KPIs, PNL, JOBS, CASHFLOW,
   AR, AP, PAYMENT_HISTORY, KPI_SPARKS, PERM_USERS).
3. Delete `src/lib/opsMockData.js` and its one import.

The return shape of `useOpsData()` is the only contract the pages rely
on — keep it stable.

## Styling

Everything under `.ops-root` uses the Sparks design tokens
(`--gold`, `--bg-darker`, `--border`, Cinzel for display type, Lato for
body). Component-level classes live in `src/ops.css`, which is imported
once from `OpsLayout.jsx`. No Tailwind, no styled-components, no
new build step — just CSS.

Chart.js is registered exactly once in `OpsChartBox`, lazily, the first
time a chart is rendered. Every chart is wrapped in a fixed-height
`.ops-chart` so Chart.js' `maintainAspectRatio: false` doesn't produce
a canvas that grows forever.

## What's still open

- Wire `useOpsData()` to Supabase (see above).
- Wire `OpsPermissionsPage` to actually persist changes. Today Save /
  Discard are no-ops; all edits are local state.
- Report (PDF) button was removed from the toolbar during the port.
  Add it back under `OpsLayout → OpsHeader` when we decide how we want
  to render reports.
- `OpsRoute` should read from a server-side `ops_access` table rather
  than a client-side admin/Owner check.
