# UAT → Production Promotion Guide
## DDE Spark Portal — Executive Dashboard

> **Before you start:** This guide assumes UAT has been fully tested and signed off.
> Work through each section in order — some steps depend on previous ones.

---

## 1. Supabase — Schema & Views

All SQL changes need to be applied to the **production** Supabase project before the code goes live.

### 1a. Run the updated `ops_views.sql`

1. Open the **production** Supabase project → SQL Editor
2. Open `sagesync/ops_views.sql` from the repo
3. Run the entire file
4. Verify no errors

**What this updates:**
- `ops.ar_invoices` — adds `isRetainage` flag, adds service invoice UNION ALL
- `ops.payroll_lines` — rewritten to use `jct` + timecard join for reg/OT split
- `ops.payroll_non_job_time` — reads sick/vac/hol directly from `payroll_records` per employee
- `ops.bank_balances` — new view for cashflow bank account cards
- `ops.cashflow_weekly` — rewritten with real GL/AR/AP data

### 1b. Update `ops.ar_payment_history`

Run this in the **production** SQL Editor:

```sql
CREATE OR REPLACE VIEW ops.ar_payment_history AS
WITH per_customer AS (
    SELECT
        ar.source_company,
        COALESCE(NULLIF(j.contact, ''), j.job_name) AS name,
        SUM(GREATEST(0,
            COALESCE(ar.invoice_total, 0) - COALESCE(ar.invoice_balance, 0)
        )) FILTER (
            WHERE COALESCE(ar.status, 1) != 5
            AND NOT (
                COALESCE(ar.retainage, 0) > 0
                AND ABS(ar.invoice_balance - ar.retainage) < 1.00
            )
        ) AS paid,
        MAX(ar.invoice_date) FILTER (
            WHERE COALESCE(ar.status, 1) != 5
        ) AS last_invoice_date,
        ARRAY_AGG(
            CASE
                WHEN COALESCE(ar.invoice_balance, 0) <= COALESCE(ar.retainage, 0) + 1.00
                THEN 0
                ELSE GREATEST(0, CURRENT_DATE - ar.due_date)
            END
            ORDER BY ar.invoice_date DESC NULLS LAST
        ) FILTER (
            WHERE ar.due_date IS NOT NULL
            AND COALESCE(ar.status, 1) != 5
        ) AS deltas
    FROM sage.ar_invoices ar
    LEFT JOIN sage.jobs j
        ON j.source_company = ar.source_company
       AND j.recnum = ar.job_recnum
    GROUP BY ar.source_company,
             COALESCE(NULLIF(j.contact, ''), j.job_name)
)
SELECT
    source_company, name,
    COALESCE(paid, 0) AS paid,
    COALESCE(deltas[1:18], ARRAY[]::integer[]) AS deltas,
    CASE
        WHEN array_length(deltas, 1) IS NULL THEN 'flat'
        WHEN array_length(deltas, 1) < 8     THEN 'flat'
        WHEN (deltas[1] + COALESCE(deltas[2],0) + COALESCE(deltas[3],0) + COALESCE(deltas[4],0))::numeric / 4.0
           < (COALESCE(deltas[5],0) + COALESCE(deltas[6],0) + COALESCE(deltas[7],0) + COALESCE(deltas[8],0))::numeric / 4.0 - 2
            THEN 'up'
        WHEN (deltas[1] + COALESCE(deltas[2],0) + COALESCE(deltas[3],0) + COALESCE(deltas[4],0))::numeric / 4.0
           > (COALESCE(deltas[5],0) + COALESCE(deltas[6],0) + COALESCE(deltas[7],0) + COALESCE(deltas[8],0))::numeric / 4.0 + 2
            THEN 'down'
        ELSE 'flat'
    END AS trend,
    last_invoice_date IS NOT NULL
        AND last_invoice_date >= CURRENT_DATE - INTERVAL '90 days' AS active
FROM per_customer
WHERE name IS NOT NULL
  AND COALESCE(paid, 0) >= 0
  AND last_invoice_date IS NOT NULL
ORDER BY paid DESC
LIMIT 25;
```

### 1c. Update Supabase max rows setting

1. Production Supabase → **Project Settings → API**
2. Find **Max Rows** (PostgREST setting)
3. Set to **50000** (UAT was increased to this during development — production needs to match)

### 1d. Add RLS policy for `user_permissions`

Run in the **production** SQL Editor:

```sql
CREATE POLICY up_anon_all ON public.user_permissions
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

> This allows the portal (which uses the anon key without Supabase Auth) to read and write user permissions. Without this, the Permissions tab and Admin → User Permissions page won't save.

### 1e. Verify `ops.payroll_lines` row limit

Check the production Supabase max rows is set to 50000 (done in 1c above). The payroll view returns ~14,000+ rows and will silently return only 1000 without this setting, causing the payroll page to show mock data.

---

## 2. GitHub — Merge UAT Branch to Main

1. Go to your GitHub repo → **Pull requests** → **New pull request**
2. Set **base:** `main` ← **compare:** `uat`
3. Title: `Promote UAT dashboard changes to production`
4. Review the list of changed files — confirm it includes all the files worked on
5. Click **Create pull request** → **Merge pull request** → **Confirm merge**

**Key files that should be in the diff:**
```
src/hooks/useOpsData.js
src/hooks/useOpsDataLive.js
src/context/OpsViewStateContext.jsx
src/components/ops/OpsLayout.jsx
src/pages/ops/OpsArPage.jsx
src/pages/ops/OpsApPage.jsx
src/pages/ops/OpsCashflowPage.jsx
src/pages/ops/OpsJobsPage.jsx
src/pages/ops/OpsKpisPage.jsx
src/pages/ops/OpsOverviewPage.jsx
src/pages/ops/OpsPayrollPage.jsx
src/pages/ops/OpsPnlPage.jsx
src/components/ops/OpsPaymentHistory.jsx
sagesync/ops_views.sql
```

> If any file is missing from the diff, it wasn't committed to `uat` — go back and commit it before merging.

---

## 3. Netlify — Deploy Production Site

1. Open **Netlify** → select the **production** site (not the UAT site)
2. Go to **Deploys**
3. Netlify should auto-deploy when `main` is updated via the merge above
4. If it doesn't trigger automatically: **Trigger deploy → Deploy site**
5. Wait for the build to complete (watch for any build errors in the deploy log)

### Verify environment variables on production

Go to **Site configuration → Environment variables** and confirm these are set:

| Variable | Value |
|---|---|
| `VITE_USE_LIVE_DATA` | `true` |
| `VITE_SUPABASE_URL` | *(production Supabase URL)* |
| `VITE_SUPABASE_ANON_KEY` | *(production anon key)* |

> These should already be set from the original production setup. Double-check that `VITE_SUPABASE_URL` points to the **production** Supabase project, not the UAT one.

---

## 4. Resend — No Changes Required

No email template or API key changes were made during this development cycle. The A/R email functionality uses the same Resend configuration as before. No action needed.

---

## 5. Post-Deployment Verification

Work through each tab after deployment:

| Tab | What to check |
|---|---|
| **Overview** | Cards update when switching MTD/QTD/YTD/TTM. Retainage cards show real numbers. |
| **Company P&L** | All 8 period options filter the chart and table. |
| **Jobs P&L** | Real job data loads (not mock). Date filter defaults to YTD. |
| **A/R** | Service invoices appear. Retainage toggle defaults to off. Archive button works. Page ends after email section. |
| **A/P** | $100 minimum threshold applied by default. |
| **Cashflow** | Bank account cards show real balances. Future portion has red band. |
| **Payroll** | Real employees shown. By-job shows reg + OT hours. Date filter defaults to YTD. |
| **KPI** | Page starts empty. Add a time-series card and verify sorting. |
| **Permissions** | User permissions tab populates after saving from Admin page. |

### Quick data sanity checks

Run these in the **production** Supabase SQL Editor after deploy:

```sql
-- Confirm isRetainage flag works
SELECT COUNT(*) FROM ops.ar_invoices WHERE "isRetainage" = true;

-- Confirm payroll lines are loading (should be 14k+ rows)
SELECT COUNT(*) FROM ops.payroll_lines;

-- Confirm bank balances view works
SELECT * FROM ops.bank_balances;

-- Confirm pnl_monthly has current year data
SELECT month, month_label FROM ops.pnl_monthly ORDER BY month DESC LIMIT 3;
```

---

## 6. Sagesync — No Changes Required

No changes were made to `sync.py` or `sage_queries.py`. The sync schedule and process remain unchanged. All SQL changes were view-only (no new tables, no schema changes beyond what's in `ops_views.sql`).

> **Note:** When `artrns` (AR cash receipts) is eventually added to the sync, it will enable real days-to-pay tracking in the payment history section. That's a future enhancement — the payment history section has been removed from the A/R page for now.

---

*Generated May 2026 — DDE Spark Portal UAT → Production promotion*
