# dde-spark-ops-batch5

Drop-in updates on top of the UAT repo.  Overwrite each file in
`sparks/dde-spark-portal-uat/src/...` with the matching file in this
folder (paths inside `src/` match one-for-one).

## What this batch ships

1. **Overview — 2nd row of cards**
   `src/pages/ops/OpsOverviewPage.jsx`
   New row under the top KPI grid with Company productivity,
   Revenue per field hour, Retainage held, and Retainage due
   (next 30 days — derived from `pctCmp >= 95` release schedule).

2. **Weekly A/R email — collapsible + admin-only**
   `src/pages/ops/OpsArPage.jsx`
   Collapsed by default.  Expand button reveals schedule / recipients /
   subject / preview.  Section is hidden entirely for non-admin users
   (`currentUser.is_admin` check via `useAuth()`).

3. **Permissions tab — admin-only**
   `src/App.jsx`, `src/components/ops/OpsLayout.jsx`
   Route gated with `<ProtectedRoute adminOnly>`; tab is filtered out
   of the Ops subnav for non-admins.

4. **A/R aging — new columns + days/months toggle + tooltips**
   `src/pages/ops/OpsArPage.jsx`, `src/lib/opsEmailTemplate.js`
   - Buckets are now **Current / 1-30 / 31-60 / 61-90 / >90**
     (91-120 and >120 collapsed into `>90`).
   - **Days / Months** toggle on the aging section.  Months mode
     buckets by actual invoice month — today's month is *Current*,
     then the three prior months as labelled columns, then *Older*.
   - **Retainage** column added to the Contract (AR) table only
     (rolled up from `jobs[].retainageHeld` per customer).
   - Hover any cell to see the invoices behind it — **invoice #,
     invoice date, amount**.
   - Email (`buildArEmailHtml`) still renders days-mode bucketed
     tables; API is backward-compatible via `AGING_BUCKETS` alias.

5. **Payroll — non-regular $ time-series**
   `src/pages/ops/OpsPayrollPage.jsx`, `src/lib/opsMockData.js`
   New section under the summary cards: line chart with OT $,
   Sick $, Vacation $, Holiday $ by week.  Regular pay explicitly
   excluded so exception-spending patterns stand out.  Job selector
   scopes the chart to a single contract job or all contract jobs.
   Mock data was extended back through 2026-03-06 so the curves have
   6 weeks of signal (holiday / normal / OT-heavy / flu / spring
   break / current).

6. **KPIs — Add KPI supports time-series**
   `src/pages/ops/OpsKpisPage.jsx`
   Single value vs Time series toggle on the Add KPI form.  In
   time-series mode you enter one or more **period + value** rows;
   the saved KPI renders as its own sparkline (last point shown as
   the headline value).  Persisted to `localStorage` under key
   `dde.ops.customKpis.v2` until the DB table lands.

   **Future DB schema (noted in the page's top comment):**
   ```
   kpi(id, name, kind ['single'|'timeseries'], value, color, created_at, created_by)
   kpi_point(id, kpi_id, period, value, note)
   ```

7. **Permissions tab — updated options**
   `src/pages/ops/OpsPermissionsPage.jsx`
   - Added `Payroll` to the tab-visibility list.
   - Added new field-masking toggles: GP %, Direct Cost, Cost bucket
     split, Labor hours, Productivity / earned-value, Revenue per
     field hour, Retainage held, Retainage due schedule, Weekly A/R
     email settings, PO list, PO outstanding $, Service work-orders,
     Payroll register detail, Employee pay rates.
   - Expanded role dropdown: Admin, Owner, Manager, PM, Finance,
     Accountant, Payroll, Foreman, Viewer.

8. **Mock data fixes**
   `src/lib/opsMockData.js`
   - Fixed *Angalena* DuBaldo spelling (was *Angelina*) on the
     PERM_USERS row (name + email).
   - Added 5 additional weeks of PAYROLL_LINES (2026-04-03 through
     2026-03-06) so the time-series viz has real signal.

## Install

1. Unzip over the UAT repo.  Every file keeps its existing path under
   `src/` — the overwrite map is:
   ```
   src/App.jsx
   src/components/ops/OpsLayout.jsx
   src/lib/opsEmailTemplate.js
   src/lib/opsMockData.js
   src/pages/ops/OpsArPage.jsx
   src/pages/ops/OpsKpisPage.jsx
   src/pages/ops/OpsOverviewPage.jsx
   src/pages/ops/OpsPayrollPage.jsx
   src/pages/ops/OpsPermissionsPage.jsx
   ```
2. No new dependencies — nothing to `npm install`.
3. `npm run build` should pass.  Netlify will pick it up automatically
   on the next push.

## Notes

- All new UI reads only from the existing `useOpsData()` hook plus
  `useAuth()`; no new context providers or Supabase calls are
  introduced in this batch.
- The A/R email HTML output is unchanged visually — same Sage-style
  days buckets with the new `Current / 1-30 / 31-60 / 61-90 / >90`
  labels.  Recipients will see the same email, just with the renamed
  buckets.
