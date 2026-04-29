# Sage → Supabase v2 — Implementation Guide

A linear walk-through. Do the sections in order. Each step lists what
you'll do, where, and what "success" looks like before moving on.

Total elapsed time for a clean run: **~2 hours**, most of which is the
backfill grinding in the background.

---

## Before you start — have these open / in hand

- **SSMS** (SQL Server Management Studio) connected to
  `DEMA-SAGE\SAGE100CON` as `sa` or an equivalent sysadmin.
- **Supabase dashboard** — logged in, with both projects visible:
  - UAT: `https://yhvjvxibsxvqvsplauan.supabase.co`
  - PROD: `https://tagfzkffedlbiqtlncry.supabase.co`
- **The LAN Windows box** that will actually run the sync. RDP into it
  now; you'll install Python + the ODBC driver here.
- **This folder** (`sage-supabase-sync`) unzipped on both your laptop
  (for editing `.env`) and on the LAN box at `C:\SageSync`.
- **A password** you pick for `sage_reader`. 12+ chars, mixed case,
  digit, symbol. You'll put it both in SSMS (step 2) and in `.env` (step 6).

---

## Step 1 — Apply the Supabase UAT schema  (≈ 3 min)

Location: Supabase Dashboard → UAT project → SQL editor.

Open and run these four files **in this order**. Each one prints
"Success. No rows returned." at the bottom when it's done.

1. `schema.sql` — creates the `sage` schema + v1 tables.
2. `schema_v2.sql` — adds payroll detail / service / PO / CO tables.
3. `ops_views.sql` — creates the `ops` schema + v1 views.
4. `ops_views_v2.sql` — adds v2 views (service, PO spend, CO, payroll
   daily, etc).

Verify:
```sql
SELECT table_schema, count(*)
  FROM information_schema.tables
 WHERE table_schema IN ('sage','ops')
 GROUP BY 1;
```
Expect roughly `sage ≈ 40` and `ops ≈ 20`. Exact count doesn't matter;
having rows at all proves both schemas exist.

---

## Step 2 — Reset the `sage_reader` SQL login  (≈ 2 min)

Location: SSMS, connected to `DEMA-SAGE\SAGE100CON` as `sa`.

Open `grant_sage_reader.sql`. Near the top is a line like:
```sql
DECLARE @new_password NVARCHAR(128) = N'<<PUT-STRONG-PASSWORD-HERE>>';
```
Replace the placeholder with the password you picked. Execute. It will:

- `ALTER LOGIN sage_reader WITH PASSWORD = @new_password` (creates if
  needed), `CHECK_POLICY=OFF` so Windows password policy won't lock
  automation out.
- Ensure the login is mapped as a user in the company DB with
  `db_datareader`.

Verify (still as `sa`):
```sql
EXECUTE AS LOGIN = 'sage_reader';
SELECT SUSER_NAME(), DB_NAME();
SELECT TOP 5 recnum AS jobnum, jobnme, status FROM dbo.actrec;
REVERT;
```
You should see 5 rows from `actrec`. (You already did this earlier and
confirmed it works.)

---

## Step 3 — Verify the logon-trigger whitelist  (≈ 1 min)

Location: SSMS, same connection.

Run `patch_logon_trigger.sql`. It's idempotent — if the `APP=` prefix
`Sage100Contractor¦` is already whitelisted, the script is a no-op and
prints that fact. If it isn't, the script adds it.

Sanity-check: this file has the correct **broken bar** (U+00A6)
separator, NOT a regular pipe. Don't retype it by hand.

---

## Step 4 — Prepare the LAN Windows box  (≈ 15 min)

Location: RDP into the Windows box.

1. **Copy the folder**: extract `sage-supabase-sync` to `C:\SageSync`.
   (If you put it somewhere else, update `SYNC_DIR` in `run_sync.bat`
   and `run_backfill.bat`.)

2. **Install Python 3.12**: https://www.python.org/downloads/windows/
   - Check "Add python.exe to PATH" on the first installer screen.
   - After install, open a **new** Command Prompt and run `py --version`
     to confirm it's found.

3. **Install the ODBC driver**: Microsoft ODBC Driver 18 for SQL Server
   (x64). https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server
   - Version 17 is fine too if already present — we don't care which.

4. **Create the ODBC DSN**:
   - Start → "ODBC Data Sources (64-bit)" (make sure it's the 64-bit
     applet, not 32-bit).
   - System DSN tab → Add → "ODBC Driver 18 for SQL Server".
   - Name: **`Sage100Con`** (must match exactly).
   - Server: `DEMA-SAGE\SAGE100CON`
   - Next → choose **"With SQL Server authentication"**, enter
     `sage_reader` + the password you set in Step 2.
   - Next → check **"Change the default database to"** and pick
     `DuBaldo Electric 4.15.22`.
   - Finish → **Test Data Source** → must say TESTS COMPLETED
     SUCCESSFULLY.

---

## Step 5 — Install Python dependencies  (≈ 2 min)

On the LAN box, open Command Prompt:
```cmd
cd C:\SageSync
py -m pip install --upgrade pip
py -m pip install -r requirements.txt
```

Expect four packages to install: `pyodbc`, `supabase`, `python-dotenv`,
`psycopg2-binary`. No errors.

---

## Step 6 — Fill in `.env`  (≈ 3 min)

Open `C:\SageSync\.env` in Notepad (or paste from your laptop copy).
Replace the three `<<...>>` placeholders:

| Placeholder | Value to paste |
|---|---|
| `<<PASTE_NEW_SAGE_READER_PASSWORD_HERE>>` | The password you set in Step 2. |
| `<<PASTE_UAT_SERVICE_ROLE_JWT_HERE>>` | Supabase UAT project → Settings → API → `service_role` key. The long JWT that starts `eyJ…`. |
| `<<PASTE_PROD_SERVICE_ROLE_JWT_HERE>>` | Supabase PROD project → same place. |

Leave everything else as-is. `SAGE_SYNC_ENV=uat` means both scripts will
target the UAT Supabase project until you flip it later.

**Never commit `.env` to GitHub.** The `.env.example` is the one that
gets checked in.

---

## Step 7 — Pre-flight check  (≈ 1 min)

```cmd
cd C:\SageSync
py check_setup.py
```
This verifies:
- All required env vars are present
- The ODBC DSN resolves and `sage_reader` can connect
- The Supabase service-role key can hit the `sage` schema

If anything fails, the error message names the specific env var or
connection that's wrong. Fix, re-run. Don't proceed until this passes.

---

## Step 8 — Run the historical backfill  (≈ 30–90 min)

```cmd
cd C:\SageSync
run_backfill.bat
```

What to expect:
- You'll see `Backfilling sage.<table>` lines for ~40 tables.
- Each batch of 1000 rows gets a `+ 1000 rows` log line.
- Big tables: `gl_transactions` (~5–10 min), `job_cost_transactions`
  (~5–10 min), `timecard_lines` (~2–3 min). Everything else is faster.
- Total: 30 min on a fast LAN, up to 90 min on a slow one.

Logs stream to the console **and** to
`C:\SageSync\logs\backfill_YYYYMMDD_HHMMSS.log`.

On completion the final lines look like:
```
Backfill finished in 0:42:15 — total rows loaded: 812,347
```

If any tables failed (network blip, deadlock, whatever), the script
**does not abort** — it moves on and reports failures at the end. Re-run
with `--resume` to pick up only the failed tables:
```cmd
run_backfill.bat --resume
```

### How to verify the backfill landed

Supabase UAT → SQL editor:
```sql
SELECT table_name, rows_loaded, status
  FROM sage.backfill_runs
 WHERE source_company='DUBALDO'
 ORDER BY rows_loaded DESC;
```
You should see a row per table with `status='success'` and the row
counts roughly matching what you saw in your discovery queries.

Quick smoke test on the ops views:
```sql
SELECT * FROM ops.jobs                    LIMIT 5;
SELECT * FROM ops.ar_invoices             LIMIT 5;
SELECT * FROM ops.service_invoices        LIMIT 5;
SELECT * FROM ops.purchase_orders_live    LIMIT 5;
SELECT * FROM ops.change_orders_pending   LIMIT 5;
SELECT * FROM ops.payroll_daily           LIMIT 5;
```
Each should return data. If any is empty, the corresponding `sage.*`
table either truly has zero rows (rare), or failed to load — check
`sage.backfill_runs` for that table.

---

## Step 9 — Schedule the daily sync  (≈ 3 min)

Location: LAN box, Task Scheduler.

1. Task Scheduler → Action → **Import Task**. Select
   `C:\SageSync\SageSupabaseSync.xml`.
2. On the **General** tab, set the user account that will run the task.
   Use a service account or a local admin — needs to be able to read
   files in `C:\SageSync\logs`. Tick **"Run whether user is logged on
   or not"** and **"Run with highest privileges"**.
3. On the **Actions** tab, confirm the program is
   `C:\SageSync\run_sync.bat`. If you put the folder elsewhere, fix the
   path.
4. Save. Windows will prompt for the service account password.

Test it right now:
- Right-click the task → **Run**.
- Watch `C:\SageSync\logs\sync_<timestamp>.log` — should take 2–5 min.
- Supabase → `sage.sync_runs` → newest row should have `status='success'`.

---

## Step 10 — Hand off to the Ops portal (Netlify)  (no changes needed right now)

The Ops portal (the Netlify site at `ops.dubaldoelectric.com` or
wherever) reads from the **same** Supabase via the `ops.*` views. It
gets its Supabase URL + anon key from its own Netlify env vars — this
sync doesn't touch them.

- **If the portal is already pointed at UAT**: you're done. Once the
  backfill finishes, all v2 pages (Service, POs, Change Orders,
  Payroll detail) have live data to read.
- **If the portal is pointed at nothing yet**: have the portal admin
  set these two Netlify env vars on the UAT deploy:
  - `VITE_SUPABASE_URL = https://yhvjvxibsxvqvsplauan.supabase.co`
  - `VITE_SUPABASE_ANON_KEY = <UAT anon key>`
  Re-deploy. No code changes on the portal side.

---

## Step 11 — Cutover to PROD  (when you're ready)

1. In Supabase PROD's SQL editor, apply the same four SQL files from
   Step 1 (schema.sql, schema_v2.sql, ops_views.sql, ops_views_v2.sql).
2. On the LAN box, edit `C:\SageSync\.env`:
   ```
   SAGE_SYNC_ENV=prod
   ```
3. `run_backfill.bat` once.
4. (Optional) flip the portal's Netlify env to PROD URL + PROD anon key
   and redeploy.

The daily scheduled task keeps running — now writing to PROD instead of
UAT.

---

## Optional — GitHub

If you want the whole package version-controlled (recommended):

```cmd
cd C:\SageSync
git init
git add .
git status                     REM confirm .env is NOT listed
git commit -m "Initial drop — Sage→Supabase sync v2"
git branch -M main
git remote add origin git@github.com:dubaldoelectric/sage-supabase-sync.git
git push -u origin main
```

A `.gitignore` is already included that excludes `.env`, the `logs/`
folder, and Python `__pycache__`. Double-check `git status` before your
first commit — `.env` should NOT appear in the staged list.

---

## Reference — day-to-day ops

**Check last night's sync:**
```sql
SELECT id, started_at, finished_at, status,
       rows_gl_transactions, rows_job_cost_tx,
       rows_timecard_lines, rows_service_invoices,
       error_message
  FROM sage.sync_runs
 ORDER BY id DESC LIMIT 5;
```

**Force a re-sync of just one section:**
```cmd
py sync.py --only service
py sync.py --only change_orders --since 30
```

**Re-pull a specific table from scratch (dangerous — wipes target):**
```cmd
py backfill.py --only service_invoices --truncate
```

**Widen the daily lookback window** (e.g. after back-dated entries
show up a week late):
```cmd
py sync.py --since 14
```
Or permanently via `.env`: `LOOKBACK_DAYS=14`.

**Where to look when something breaks:**
1. `C:\SageSync\logs\sync_*.log` — most recent failure has the traceback.
2. `sage.sync_runs` in Supabase — per-run status + failed section names.
3. `sage.backfill_runs` — per-table backfill status if a historical
   re-load was in progress.
