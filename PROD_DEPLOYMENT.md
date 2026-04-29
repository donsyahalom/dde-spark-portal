# DDE Spark Portal — Production Deployment Guide

This document covers everything needed to move from UAT to PROD, including the
Ops dashboard switch from mock data to live Supabase data.

---

## 1. Pre-flight checklist

Before touching anything, confirm these in UAT:

- [ ] All SQL migrations have been run and verified in UAT
- [ ] Reminder emails fire correctly (check `notification_log` table)
- [ ] Performance review trigger sends confirmation email
- [ ] Archive/unarchive works and blocks login correctly
- [ ] User permissions page saves and loads correctly
- [ ] Compensation settings toggle hides/shows My Pay tab correctly

---

## 2. Create the PROD Supabase project

If you already have a PROD Supabase project, skip to step 3.

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `dde-spark-portal` (or similar), choose your region
3. Save the **Project URL** and **anon key** — you'll need them shortly

---

## 3. Run all SQL migrations on PROD (in order)

Open the **SQL Editor** in your PROD Supabase project and run these files
from the `sql/` directory **in this exact order**:

```
1. supabase-schema.sql                    ← base schema (employees, sparks, settings, etc.)
2. supabase-schema-compensation.sql       ← compensation tables
3. performance-schema.sql                 ← perf_cycles, questions, answers
4. migration-grade-responsibilities.sql   ← grade responsibilities
5. migration-v4.sql                       ← (if present)
6. migration-v5.sql                       ← (if present)
7. migration-v6.sql                       ← (if present)
8. migration-workday-reset.sql            ← pg_cron daily reset job
9. migration-tags.sql                     ← spark tags/categories
10. migration-patch-2025-features.sql     ← due_date, has_executive_dashboard, ops_permissions
11. migration-employee-archive.sql        ← is_archived column
12. migration-user-permissions.sql        ← per-user screen permissions
```

> **Tip:** If a migration errors with "already exists", that's fine — the
> `IF NOT EXISTS` guards make all migrations idempotent.

---

## 4. Copy UAT data to PROD (optional but recommended for go-live)

If you want to bring your UAT employee records over to PROD rather than
re-entering everything:

1. In UAT Supabase → **Table Editor** → `employees` → Export CSV
2. In PROD Supabase → **Table Editor** → `employees` → Import CSV
3. Repeat for: `settings`, `custom_lists`, `perf_grade_compensation`,
   `perf_grade_responsibilities`, `teams`, `team_members`

**Do NOT copy** `spark_transactions`, `daily_given`, `spark_cashouts`, or
`notification_log` — those are historical UAT test records and should start
fresh in PROD.

After import, run in PROD SQL Editor:
```sql
-- Reset all spark balances to zero for clean go-live
UPDATE employees SET
  vested_sparks = 0,
  unvested_sparks = 0,
  redeemed_sparks = 0,
  daily_sparks_remaining = daily_accrual;
```

---

## 5. Set up the PROD Netlify site

1. In Netlify → **Add new site** → Import from Git
2. Select your repo and the `main` branch (or whichever branch is PROD)
3. Build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Add environment variables under **Site → Environment variables**:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your PROD Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your PROD Supabase anon key |
| `SUPABASE_URL` | Your PROD Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your PROD Supabase service role key (**keep secret**) |
| `RESEND_API_KEY` | Your Resend API key |
| `APP_URL` | Your PROD Netlify domain (e.g. `https://dde-spark-portal.netlify.app`) |
| `VITE_ENV` | *(leave blank or omit entirely — do NOT set to `UAT`)* |

> **Critical:** `VITE_ENV=UAT` is what displays the orange UAT banner.
> Never set this on PROD. If it's absent or any other value, the banner
> won't show.

5. Deploy the site.

---

## 6. Deploy Supabase Edge Functions to PROD

From your local terminal, with the Supabase CLI pointed at your PROD project:

```bash
supabase link --project-ref YOUR_PROD_PROJECT_REF
supabase functions deploy send-spark-summary
supabase functions deploy send-notification
```

Set the function secrets in PROD (Supabase dashboard → Edge Functions → Secrets):
- `RESEND_API_KEY` — your Resend key
- `APP_URL` — your PROD domain

---

## 7. Verify scheduled functions are active

After deploying to Netlify, confirm the scheduled functions registered:

1. In Netlify → **Functions** tab → you should see:
   - `send-spark-reminders` (schedule: `0 * * * *`)
   - `send-review-reminders` (schedule: `0 14 * * *`)
2. If they don't appear, check that `netlify.toml` includes the schedule
   entries and redeploy.

---

## 8. Settings to configure on first PROD login (admin account)

Log in as admin and go to ⚙️ Admin → Settings. Configure:

| Setting | Recommended PROD value |
|---|---|
| **Go-live date** | Today's date — this lifts the email suppression gate |
| **Spark frequency** | Your chosen period (daily / weekly / monthly) |
| **Reminder offsets** | e.g. `48,24` — emails fire 48h and 24h before period end |
| **Spark value ($)** | Dollar value per spark for reporting |
| **Compensation enabled** | ✅ On (if you want My Pay visible) |
| **Show Wage / Range / Bonus** | Per your preference |

---

## 9. Switch the Ops Dashboard from mock data to live Supabase data

The Ops (Executive) Dashboard currently reads from `src/lib/opsMockData.js`.
Switching to live data requires these steps:

### 9a. Create the Supabase tables/views

Run the following in your PROD SQL Editor to create the ops data structures.
These are the tables `useOpsData.js` will query once wired:

```sql
-- Jobs / contracts table
CREATE TABLE IF NOT EXISTS ops_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number      text,
  name            text NOT NULL,
  customer        text,
  profit_center   text DEFAULT 'DDE',
  type            text DEFAULT 'contract',   -- 'contract' | 'service'
  status          text DEFAULT 'Active',
  contract_amount numeric DEFAULT 0,
  billed_to_date  numeric DEFAULT 0,
  pct_complete    numeric DEFAULT 0,
  labor_cost      numeric DEFAULT 0,
  material_cost   numeric DEFAULT 0,
  sub_cost        numeric DEFAULT 0,
  equipment_cost  numeric DEFAULT 0,
  other_cost      numeric DEFAULT 0,
  retainage_held  numeric DEFAULT 0,
  labor_hours_budget  numeric DEFAULT 0,
  labor_hours_actual  numeric DEFAULT 0,
  pm_name         text,
  foreman_name    text,
  start_date      date,
  end_date        date,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- P&L summary (one row per month per profit center)
CREATE TABLE IF NOT EXISTS ops_pnl (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profit_center   text NOT NULL,
  period_month    date NOT NULL,  -- first day of month
  revenue         numeric DEFAULT 0,
  cogs            numeric DEFAULT 0,
  burden          numeric DEFAULT 0,
  gp              numeric DEFAULT 0,
  overhead        numeric DEFAULT 0,
  net             numeric DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

-- A/R invoices
CREATE TABLE IF NOT EXISTS ops_ar_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  text,
  customer        text NOT NULL,
  type            text DEFAULT 'AR',   -- 'AR' | 'SR'
  amount          numeric DEFAULT 0,
  invoice_date    date,
  due_date        date,
  paid_date       date,
  status          text DEFAULT 'open', -- 'open' | 'paid' | 'partial'
  job_number      text,
  profit_center   text DEFAULT 'DDE',
  created_at      timestamptz DEFAULT now()
);
```

### 9b. Update `useOpsData.js`

Replace the mock import block in `src/hooks/useOpsData.js` with live queries.
The shape of the returned data stays exactly the same so no page components
need to change.

Replace the top of `useOpsData.js`:

```js
// BEFORE (mock):
import { AR_INVOICES, JOBS, PNL, ... } from '../lib/opsMockData'

// AFTER (live):
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOpsViewState } from '../context/OpsViewStateContext'

export function useOpsData() {
  const { pc, basis } = useOpsViewState()
  const [jobs, setJobs] = useState([])
  const [pnlRows, setPnlRows] = useState([])
  const [arInvoices, setArInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: j }, { data: p }, { data: ar }] = await Promise.all([
        supabase.from('ops_jobs').select('*').eq('profit_center', pc),
        supabase.from('ops_pnl').select('*').eq('profit_center', pc).order('period_month'),
        supabase.from('ops_ar_invoices').select('*').eq('profit_center', pc),
      ])
      setJobs(j || [])
      setPnlRows(p || [])
      setArInvoices(ar || [])
      setLoading(false)
    }
    load()
  }, [pc])

  // Map DB rows to the shape the pages expect
  const pnl = useMemo(() => ({
    revenue:  pnlRows.map(r => r.revenue),
    cogs:     pnlRows.map(r => r.cogs),
    burden:   pnlRows.map(r => r.burden),
    gp:       pnlRows.map(r => r.gp),
    overhead: pnlRows.map(r => r.overhead),
    net:      pnlRows.map(r => r.net),
    months:   pnlRows.map(r => new Date(r.period_month).toLocaleString('default', { month: 'short' })),
  }), [pnlRows])

  return { jobs, pnl, arInvoices, loading }
}
```

> **Important:** Do this switch after going live with the core spark portal
> so you're not debugging two things at once. The mock data is harmless and
> the Ops dashboard is only visible to owners/admins anyway.

---

## 10. Post-go-live checklist

After deploying PROD:

- [ ] Log in as admin, confirm UAT banner is **not** showing
- [ ] Set go-live date in Settings
- [ ] Send a test email/SMS from the Test Notifications section
- [ ] Trigger one performance review and confirm the confirmation email arrives
- [ ] Verify the leaderboard loads with zero spark history (clean start)
- [ ] Add at least one employee and verify they can log in
- [ ] Confirm `send-spark-reminders` and `send-review-reminders` functions
      appear in Netlify → Functions tab
- [ ] Monitor `notification_log` table for the first few days

---

## 11. UAT vs PROD — ongoing workflow

| Action | UAT | PROD |
|---|---|---|
| Branch | `uat` | `main` |
| Netlify site | `dde-spark-portal-uat.netlify.app` | `dde-spark-portal.netlify.app` |
| Supabase project | UAT project | PROD project |
| `VITE_ENV` | `UAT` | *(not set)* |
| Orange banner | ✅ Shows | ❌ Never shows |
| Test emails | Safe to send | Real employees receive them |

Always develop and test in UAT first, then merge to `main` for PROD.
