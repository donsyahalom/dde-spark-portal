# Sage → Supabase Sync — Session Status

_Last updated: 2026-04-28_

## Parity test — PASSED (2026-04-28)

After Don ran the v4 backfill green and ran a manual `sync.py` to catch the
data up through today, totals tie to Sage 100 Contractor reports to the penny:

- **Total open AR** = $1,208,057.59 — matches Sage report **3-1-3-21** exactly.
- **Total open AP** = $837,328.12 — matches Sage report **4-1-3-21** exactly,
  and bucket split (current / 1-30 / 31-60 / 61-90 / over_90) ties when
  aged by `due_date` as-of the **last day of the current month** (4/30).

Two patches landed today to lock parity in:

1. `ops_views.sql` — `ops.ar_invoices` and `ops.ap_invoices` now exclude
   status IN (4, 5) (paid + voided). Sage flags voids as status=5 but does
   NOT zero `invbal`, so the unfiltered view was overstating open AR by
   ~$18.5M and open AP by ~$1.94M. Filter restored both totals to truth.

2. `sync.py` — `compute_aging_buckets()` rewritten to:
     * default `date_field` to `due_date` (was `invoice_date`);
     * anchor as-of fiscal period-end (last day of current month) — Sage's
       4-1-3-21/3-1-3-21 default behavior;
     * skip rows with status IN (4, 5) so paid/voided rows never appear
       in any aging bucket.

Apply by copying patched `sync.py` + `ops_views.sql` over `C:\SageSync\`,
then either run `run_sync.bat` once to refresh `bucket_*` columns in
`sage.ar_invoices` / `sage.ap_invoices`, or wait for the next 6 AM
scheduled run.



A running log of where we are, what's working, and what's left. Keep this as
the single source of truth between sessions so we don't re-derive context.

---

## What's working today (UAT)

**Schema applied in Supabase UAT:** `schema.sql`, `schema_v2.sql`,
`ops_views.sql`, `ops_views_v2.sql` (post-patch — all column-name typos
fixed and the 3 employee_* views removed since their source tables don't
fit the target schema model).

**Backfill loaded successfully (28 of 30 tables, ~83k rows):**
- v1 (13): `gl_accounts`, `gl_subaccounts`, `vendors`, `employees`,
  `jobs`, `job_budget_lines`, `gl_transactions`, `payroll_records`,
  `ar_invoices`, `ap_invoices`, `job_cost_transactions`,
  `paytypes`, `paydeductions`
- v2 masters (4): `paygroups` (130), `payunions` (9), `costcodes` (101),
  `empabsence` (9)
- v2 timecard (5): `timecard_lines`, `timecard_deductions` (26,527),
  `timecard_benefits` (3,148), `timecard_wc` (2,198),
  `timecard_paygroups` (1,056)
- v2 service (5 of 7): `service_geo` (14), `service_types` (11),
  `service_clients` (1,362), `service_invoices` (4,193),
  `service_invoice_lines` (9,070), `service_schedule` (102)
- v2 PO + change orders (5): `purchase_orders` (32),
  `change_order_types_prime` (0), `change_order_types_corresp` (0),
  `prime_change_orders` (383), `subcontract_changes` (0)

**Daily incremental sync (`sync.py` + Task Scheduler):** not yet wired up.
Schedule it AFTER the remaining 2 tables load and you're satisfied with the
data.

---

## What's still broken (2 tables, last run 2026-04-27 09:18)

Both fail with the same `psycopg2.errors.CardinalityViolation: ON
CONFLICT DO UPDATE command cannot affect row a second time` —
i.e. a single batch contains multiple rows with the same primary-key
value, so Postgres refuses to apply two updates to the same target row
in one statement. Root cause: the `(source_company, recnum)` PK is
wrong for both. In Sage, `recnum` on these tables is a parent-table
foreign key, not a unique row identifier:

- `service_locations` — `srvloc.recnum` is the parent CLIENT ref;
  multiple locations per client share it. Real unique row =
  `(recnum, locnum)`. Fix: PK -> `(source_company, recnum, location_number)`.
- `service_payments` — `srvpmt.recnum` is the parent INVOICE ref;
  multiple payments per invoice share it. Sage's only guaranteed
  unique row id is `_idnum` (uniqueidentifier). Fix: add
  `payment_id UUID` column from Sage `_idnum`,
  PK -> `(source_company, payment_id)`.

Both target tables are empty (only failures so far), so the migration
SQL just drops/rebuilds the PKs without touching data. See `next session`
section below — the migration script is shipped as
`migrate_service_pks.sql`.

**ops_views_v2.sql also patched** to compose
`(client_recnum, location_number)` when joining `service_locations`,
preventing fan-out once locations actually load.

---

## What's intentionally dropped

After running discovery against the live Sage DB, 5 v2 tables were
removed from the catalog because the real Sage tables don't match the
target schema's data model. They'd need a schema redesign to populate:

- `benefits` — real `benfit` is just (paygrp, dednum, dedrte) lookup, not
  enrollment record.
- `employee_pay` — real `emppay` is a rate-change audit log.
- `employee_qtd` — real `empqtd` rolls (recnum, clcnum) → quarter totals.
- `employee_hires` — real `emphre` is a status-change log.
- `employee_licenses` — real `emplic` is per (empnum, typnum, licnum, expdte).

The 3 corresponding `ops.*` views were removed from `ops_views_v2.sql`.
No `ALTER TABLE` is needed — the empty `sage.*` tables can stay.

---

## What was fixed this session (timeline)

1. **`ops_views_v2.sql`** — fixed `j.jobnme` → `j.job_name` (6 places),
   rewrote `ops.purchase_order_spend` to source from `gl_transactions`
   instead of nonexistent `ap_invoices.purchase_order`, fixed
   `ar_invoice_lines` / `ap_invoice_lines` columns, removed bad
   `e.employee_id` references.

2. **`requirements.txt`** — pinned `supabase < 2.15` to dodge the
   pyiceberg wheel-build failure on Windows.

3. **Supabase Postgres connection** — switched from direct
   `db.<ref>.supabase.co` (deprecated, IPv6-only on new projects) to
   the **Session pooler** at `aws-1-us-east-2.pooler.supabase.com:5432`
   with user `postgres.yhvjvxibsxvqvsplauan`.

4. **`sage_reader` login** — root cause was that `grant_sage_reader.sql`
   was failing silently inside its dynamic-SQL EXEC. Bypassed the
   wrapper with a direct `ALTER LOGIN [sage_reader] WITH PASSWORD =
   N'<see .env>', CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF;`
   — succeeded. Sage logon trigger already whitelists `sage_reader`
   explicitly so trigger isn't an issue.

5. **`run_backfill.bat` / `run_sync.bat`** — switched
   `set "PYTHON=python"` → `set "PYTHON=py"` because Windows package
   installs under `py` don't always show up under `python`.

6. **`sage_queries_v2.py`** — rewrote 4 queries against real Sage
   columns (paygroups, payunions, costcodes, empabsence) and dropped
   5 queries that don't fit (see above).

7. **`backfill.py`** — added uncaught-exception logging in `main()`'s
   outer try so silent failures get a traceback both in the log file and
   in `sage.backfill_runs.error_message`.

---

## Next session — exactly what to do

When you're back at `C:\SageSync`:

1. **Apply the migration in Supabase UAT** — open the SQL editor and
   paste the contents of `migrate_service_pks.sql` (also in the v4 zip).
   It rebuilds the PKs on `sage.service_locations` and
   `sage.service_payments`, and clears the stale 'failed' rows in
   `sage.backfill_runs` so `--resume` actually retries them. Idempotent
   and safe — both target tables are empty.

2. **Copy patched files** from `sage-supabase-sync-v4.zip` over
   `C:\SageSync\`. Files changed in v4:
   - `backfill.py` — CATALOG conflict_cols updated for both tables.
   - `sage_queries_v2.py` — `q_service_payments` now selects Sage
     `_idnum` as `payment_id`.
   - `sync.py` — daily-sync conflict-target strings updated to match.
   - `schema_v2.sql` — fresh-install copy of the new PKs (no-op for
     existing UAT, kept in sync with the migration).
   - `ops_views_v2.sql` — composite-key join on
     `service_locations` to prevent fan-out.

3. **Resume the backfill** — should pick up just the 2 remaining tables:
   ```cmd
   cd C:\SageSync
   run_backfill.bat --resume
   ```

4. If everything's green, paste the log back as confirmation. Then we
   schedule daily incremental sync via Task Scheduler
   (`SageSupabaseSync.xml`).

   Sanity query in Supabase UAT after the resume:
   ```sql
   SELECT table_name, status, rows_loaded, finished_at
   FROM sage.backfill_runs
   WHERE source_company = 'DUBALDO'
   ORDER BY finished_at DESC NULLS LAST;
   ```

---

## Reference — credentials & endpoints

- Sage host: `DEMA-SAGE\SAGE100CON`, DB `[DuBaldo Electric 4.15.22]`
- Sage login: `sage_reader` / *(see `.env`: SAGE_ODBC_PASSWORD)*
  (set via direct `ALTER LOGIN` on 2026-04-24)
- ODBC DSN on LAN box: `Sage100Con` (System DSN, 64-bit)
- Supabase UAT: `https://yhvjvxibsxvqvsplauan.supabase.co`
- UAT pooler: `aws-1-us-east-2.pooler.supabase.com:5432`,
  user `postgres.yhvjvxibsxvqvsplauan`
- Supabase PROD: `https://tagfzkffedlbiqtlncry.supabase.co`
  (not yet provisioned — schema apply + `.env` flip pending)
- Sync folder on LAN: `C:\SageSync`
- Active env: `SAGE_SYNC_ENV=uat`

---

## Files in the package

- `backfill.py` — one-shot historical loader (PATCHED)
- `sync.py` — daily incremental sync
- `sage_queries.py` / `sage_queries_v2.py` — Sage SELECT definitions
- `schema.sql`, `schema_v2.sql` — Supabase target tables
- `ops_views.sql`, `ops_views_v2.sql` — portal-facing views
- `grant_sage_reader.sql`, `patch_logon_trigger.sql` — Sage-side setup
- `discover_payroll_tables.sql`, `discover_service_po_tables.sql` —
  schema discovery (already run, outputs in /uploads)
- `check_setup.py` — preflight diagnostic
- `run_backfill.bat`, `run_sync.bat` — Windows entry points
- `SageSupabaseSync.xml` — Task Scheduler import
- `.env.example`, `.gitignore`, `requirements.txt`
- `IMPLEMENTATION_GUIDE.md` — linear runbook
- `Sage_Sync_Deployment_Runbook.docx` — same content, polished
- `SESSION_STATUS.md` — this file
