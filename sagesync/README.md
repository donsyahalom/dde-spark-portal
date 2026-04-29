# Sage 100 Contractor → Supabase sync  (v2)

A self-contained Windows automation that mirrors the Sage 100 Contractor
v27 company database into Supabase (Postgres). It has two modes:

1. **`backfill.py`** — one-shot historical load of every supported table.
   Streams rows direct to Postgres via a server-to-server connection on
   port 5432, with per-table resumability.
2. **`sync.py`** — the daily incremental maintenance sync. Pulls the
   last `LOOKBACK_DAYS` (default 3) of changes for transactional tables
   and refreshes the masters. Wired up to Task Scheduler via
   `run_sync.bat`.

Both scripts read the same `.env` and switch between UAT and PROD
Supabase with a single line (`SAGE_SYNC_ENV=uat|prod`).

Data coverage in v2:

| Area                   | Sage tables                                                  | Target `sage.*` tables |
| ---------------------- | ------------------------------------------------------------ | ---------------------- |
| General Ledger         | `actgl`, `actsub`, `trngl`                                   | `gl_accounts`, `gl_subaccounts`, `gl_transactions` |
| Payroll (header)       | `empmst`, `payrec`                                           | `employees`, `payroll_records` |
| Payroll (detail)       | `tmcdln`, `tmcddd`, `tmcdbn`, `tmcdwc`, `tmcdpg`             | `timecard_lines`, `timecard_deductions`, `timecard_benefits`, `timecard_wc`, `timecard_paygroups` |
| Payroll masters        | `paytyp`, `paygrp`, `payded`, `payuni`, `benfit`, `cstcde`, `empabs`, `emppay`, `empqtd`, `emphre`, `emplic` | matching `paytypes`, `paygroups`, `paydeductions`, `payunions`, `benefits`, `costcodes`, `empabsence`, `employee_pay`, `employee_qtd`, `employee_hires`, `employee_licenses` |
| AR / AP headers        | `vndmst`, `acrinv`, `acpinv`                                 | `vendors`, `ar_invoices`, `ap_invoices` (all with aging buckets) |
| Jobs / Job Cost        | `actrec`, `jobcst`, `bdglin`                                 | `jobs`, `job_cost_transactions`, `job_budget_lines` |
| Service (A/R + ops)    | `srvinv`, `srvlin`, `srvpmt`, `srvsch`, `reccln`, `srvloc`, `srvtyp`, `srvgeo` | `service_invoices`, `service_invoice_lines`, `service_payments`, `service_schedule`, `service_clients`, `service_locations`, `service_types`, `service_geo` |
| Purchase orders        | `pchord`                                                     | `purchase_orders` |
| Change orders          | `prmchg`, `sbcgln`, `chgtyp`, `cortyp`                       | `prime_change_orders`, `subcontract_changes`, `change_order_types_prime`, `change_order_types_corresp` |

A separate `ops.*` schema (built by `ops_views.sql` + `ops_views_v2.sql`)
exposes portal-friendly views over those raw tables with labels joined
in and aging pre-computed — that's what the Ops app reads.

---

## 1. What's in this folder

| File                            | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `schema.sql`                    | v1 Postgres DDL. Run once in Supabase.                                    |
| `schema_v2.sql`                 | v2 additions. Run once AFTER `schema.sql`.                                |
| `ops_views.sql`                 | v1 `ops.*` projections.                                                  |
| `ops_views_v2.sql`              | v2 `ops.*` projections (service / PO / CO / payroll detail).              |
| `grant_sage_reader.sql`         | Creates `sage_reader` SQL login + grants `db_datareader` on the Sage DB. |
| `patch_logon_trigger.sql`       | Whitelists this sync's `APP=` string in Sage's logon trigger.             |
| `sync.py`                       | Daily incremental runner (sections: gl, payroll, arap, jobs, payroll_v2, service, purchase_orders, change_orders). |
| `backfill.py`                   | One-shot full historical loader with per-table resumability.              |
| `sage_queries.py`               | v1 Sage SQL (GL, AR/AP, payroll header, jobs).                           |
| `sage_queries_v2.py`            | v2 Sage SQL (timecard detail, service, PO, CO, masters).                 |
| `check_setup.py`                | Pre-flight — verifies env + ODBC DSN + Supabase credentials.             |
| `run_sync.bat`                  | Task Scheduler entry for daily sync.                                      |
| `run_backfill.bat`              | Manual entry for one-shot backfill.                                       |
| `SageSupabaseSync.xml`          | Importable Task Scheduler task (daily 2am by default).                   |
| `.env.example`                  | Fully commented env template with UAT/PROD blocks.                       |
| `.env`                          | Ready-to-edit config pre-filled with DuBaldo specifics.                  |
| `requirements.txt`              | Python deps (pyodbc, supabase, python-dotenv, psycopg2-binary).          |
| `discover_payroll_tables.sql`   | SSMS discovery script for the payroll module.                            |
| `discover_service_po_tables.sql`| SSMS discovery script for service / PO / CO modules.                     |
| `Sage_Sync_Deployment_Runbook.docx` | Step-by-step ops runbook (ready to hand off).                        |

---

## 2. Two-phase rollout — the big picture

```
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 1  — one-shot historical load  (run once per environment)  │
│  ───────────────────────────────────                              │
│   LAN box  ──ODBC──>  Sage SQL Server   (reads)                   │
│        │                                                          │
│        └──psycopg2──>  Supabase UAT Postgres  (writes)            │
│   python backfill.py                                              │
│   Duration: ~30–90 minutes, depending on row counts.              │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 2  — daily maintenance                                     │
│  ───────────────────────────────                                  │
│   Task Scheduler (2:00 AM) -> run_sync.bat -> python sync.py      │
│   LOOKBACK_DAYS=3  (idempotent upserts — safe to re-run)          │
│   Duration: typically 2–5 minutes.                                │
└───────────────────────────────────────────────────────────────────┘
```

Switching UAT → PROD is a one-line edit of `.env`:
```
SAGE_SYNC_ENV=prod
```
Run `backfill.py` once against PROD, then leave the daily sync pointed
at PROD going forward.

---

## 3. Environment variables (supply once, never edit code)

Everything lives in `.env` next to `sync.py`. Template with comments is
in `.env.example`. Summary:

| Variable | Example | Used by |
|---|---|---|
| `SAGE_SYNC_ENV` | `uat` or `prod` | both |
| `SAGE_ODBC_DSN` | `Sage100Con` | both |
| `SAGE_ODBC_USER` | `sage_reader` | both |
| `SAGE_ODBC_PASSWORD` | *(you set this in SSMS)* | both |
| `SAGE_COMPANY_NAME` | `DUBALDO` | both |
| `SUPABASE_UAT_URL` | `https://yhvjvxibsxvqvsplauan.supabase.co` | sync.py |
| `SUPABASE_UAT_SERVICE_KEY` | UAT service-role JWT | sync.py |
| `SUPABASE_UAT_DB_HOST` | `db.yhvjvxibsxvqvsplauan.supabase.co` | backfill.py |
| `SUPABASE_UAT_DB_PASSWORD` | `DuBaldo@16!` | backfill.py |
| `SUPABASE_PROD_URL` | `https://tagfzkffedlbiqtlncry.supabase.co` | sync.py |
| `SUPABASE_PROD_SERVICE_KEY` | PROD service-role JWT | sync.py |
| `SUPABASE_PROD_DB_HOST` | `db.tagfzkffedlbiqtlncry.supabase.co` | backfill.py |
| `SUPABASE_PROD_DB_PASSWORD` | `DuBaldo@16!` | backfill.py |
| `LOOKBACK_DAYS` | `3` | sync.py |
| `BACKFILL_BATCH_SIZE` | `1000` | backfill.py |

---

## 4. Quick start — DuBaldo

See `Sage_Sync_Deployment_Runbook.docx` (or `IMPLEMENTATION_GUIDE.md`)
for the full walk-through. The 8-step short version:

1. **Supabase (UAT): apply schema**
   Open the UAT project's SQL editor and run, in this order:
   - `schema.sql`
   - `schema_v2.sql`
   - `ops_views.sql`
   - `ops_views_v2.sql`

2. **Sage SQL Server: reset `sage_reader`**
   Run `grant_sage_reader.sql` in SSMS (connected to `DEMA-SAGE\SAGE100CON`).
   It ALTERs the existing login with a new password and re-grants
   `db_datareader` on `[DuBaldo Electric 4.15.22]`.

3. **Sage SQL Server: verify logon-trigger whitelist**
   Run `patch_logon_trigger.sql` (it is idempotent — safe to re-run).

4. **LAN Windows box: install prerequisites**
   - Python 3.12 (add to PATH)
   - ODBC Driver 17 or 18 for SQL Server
   - Copy this whole folder to `C:\SageSync`

5. **Create ODBC DSN `Sage100Con`** pointing at `DEMA-SAGE\SAGE100CON`.
   Test the connection using SQL Authentication with `sage_reader`.

6. **Fill in `.env`** with the new sage_reader password and the two
   Supabase service-role JWTs. Leave `SAGE_SYNC_ENV=uat` for now.

7. **Install Python deps + run backfill**
   ```cmd
   cd C:\SageSync
   py -m pip install -r requirements.txt
   py check_setup.py            REM sanity-check env + DB connections
   run_backfill.bat             REM ~30–90 minutes
   ```

8. **Register Task Scheduler**
   Import `SageSupabaseSync.xml`, verify the action points at
   `C:\SageSync\run_sync.bat`, save. It runs daily at 2am.

---

## 5. Re-running & troubleshooting

`backfill.py` is idempotent (INSERT … ON CONFLICT DO UPDATE) so safe to
re-run. If any tables failed mid-run, just:
```cmd
run_backfill.bat --resume
```
It reads `sage.backfill_runs` and skips anything already marked
`success`.

Single-table debugging:
```cmd
run_backfill.bat --only timecard_lines
py sync.py --only service --dry-run
```

Logs go to `C:\SageSync\logs\{backfill|sync}_YYYYmmdd_HHMMSS.log`.

Every sync writes a row to `sage.sync_runs` (success / partial / failed
+ per-table counts). The Ops portal surfaces the last run via
`ops.last_sync`.

---

## 6. What changes when we cut over to production

1. Run the **Supabase** steps (apply `schema.sql`, `schema_v2.sql`,
   `ops_views.sql`, `ops_views_v2.sql`) against the PROD project.
2. Edit `.env`: `SAGE_SYNC_ENV=prod`.
3. `run_backfill.bat` once against PROD.
4. Leave the daily Task Scheduler job running — it now writes to PROD.

No code changes. No Netlify changes (the Ops portal already reads the
`SUPABASE_URL` from its own Netlify env vars; a separate cutover there
flips the portal from UAT to PROD).
