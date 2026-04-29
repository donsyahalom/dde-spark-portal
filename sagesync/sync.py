"""
sync.py
-------
Daily sync from Sage 100 Contractor v27 (SQL Server backend) into Supabase.

This is the INCREMENTAL daily runner. For the first historical load, run
backfill.py instead (it streams direct to Postgres and is idempotent).

Usage:
    py sync.py                       # sync everything
    py sync.py --dry-run             # connect & count rows, no upsert
    py sync.py --only jobs           # one section only
    py sync.py --since 30            # pull transactional data from last 30 days
    py sync.py --skip change_orders  # skip a section

Sections (in run order):
    gl, payroll, arap, jobs,
    payroll_v2, service, purchase_orders, change_orders

Env vars (loaded from .env in same directory; see .env.example):
    SAGE_SYNC_ENV          - "uat" or "prod" — picks which Supabase to write to
    SAGE_ODBC_DSN          - ODBC DSN for SQL Server (e.g. "Sage100Con")
    SAGE_ODBC_USER         - "sage_reader"
    SAGE_ODBC_PASSWORD     - the password for sage_reader
    SAGE_COMPANY_NAME      - tag stamped on every synced row (e.g. "DUBALDO")
    SUPABASE_UAT_URL / SUPABASE_UAT_SERVICE_KEY
    SUPABASE_PROD_URL / SUPABASE_PROD_SERVICE_KEY
    LOOKBACK_DAYS          - default 3; how far back transactional tables pull
                             each run (3 gives a comfortable overlap; bump
                             higher if your team frequently back-dates).

Requires:
    py -m pip install -r requirements.txt
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional

import pyodbc
from dotenv import load_dotenv
from supabase import Client, create_client

import sage_queries as q
import sage_queries_v2 as q2


# ---------------------------------------------------------------------
# Config / logging
# ---------------------------------------------------------------------

load_dotenv()

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, f"sync_{datetime.now():%Y%m%d_%H%M%S}.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("sage-sync")


def env(key: str, required: bool = True, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(key, default)
    if required and not val:
        log.error("Missing required env var: %s", key)
        sys.exit(2)
    return val


SAGE_ENV = (env("SAGE_SYNC_ENV", default="uat") or "uat").lower()
if SAGE_ENV not in ("uat", "prod"):
    log.error("SAGE_SYNC_ENV must be 'uat' or 'prod', got '%s'", SAGE_ENV)
    sys.exit(2)
prefix = "SUPABASE_UAT" if SAGE_ENV == "uat" else "SUPABASE_PROD"

SAGE_DSN      = env("SAGE_ODBC_DSN")
SAGE_USER     = env("SAGE_ODBC_USER")
SAGE_PASSWORD = env("SAGE_ODBC_PASSWORD")
COMPANY       = env("SAGE_COMPANY_NAME")
SUPABASE_URL  = env(f"{prefix}_URL")
SUPABASE_KEY  = env(f"{prefix}_SERVICE_KEY")
LOOKBACK_DAYS = int(env("LOOKBACK_DAYS", required=False, default="3"))


# ---------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------

def connect_sage() -> pyodbc.Connection:
    # APP= sets the "application name" the client reports to SQL Server
    # (visible as APP_NAME() in T-SQL). Sage 100 Contractor installs a
    # server-level logon trigger [SageApplicationsOnly] that only allows
    # connections whose app name matches a Sage whitelist pattern, e.g.
    # 'Sage100Contractor\u00a6%'. We advertise ourselves with that prefix
    # so the trigger permits this read-only sync to connect. Auth and
    # permissions are unchanged -- sage_reader still uses its password
    # and only has db_datareader on the company database.
    #
    # NOTE: the separator after 'Sage100Contractor' is a broken bar
    # (U+00A6, '\u00a6'), NOT a regular pipe '|'. Using the wrong
    # character will cause the trigger to reject the connection again.
    app_name = "Sage100Contractor\u00a6SupabaseSync"
    conn_str = (
        f"DSN={SAGE_DSN};UID={SAGE_USER};PWD={SAGE_PASSWORD};"
        f"APP={app_name};"
    )
    log.info("Connecting to Sage via ODBC DSN '%s' as '%s' (APP=%s)",
             SAGE_DSN, SAGE_USER, app_name)
    return pyodbc.connect(conn_str, autocommit=True, timeout=60)


def connect_supabase() -> Client:
    log.info("Connecting to Supabase (%s) at %s", SAGE_ENV, SUPABASE_URL)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def fetch(conn: pyodbc.Connection, sql: str, params=()) -> List[Dict]:
    """Run a SELECT and return rows as list of dicts keyed by column alias."""
    cur = conn.cursor()
    cur.execute(sql, params) if params else cur.execute(sql)
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    return rows


def coerce(rows: List[Dict], mapping: Dict[str, str]) -> List[Dict]:
    """Rename columns via mapping and JSON-serialize values. Handles:
      - datetime / date  -> ISO string
      - Decimal          -> float
      - bytes            -> utf-8 string
      - strip whitespace on short strings (Sage legacy often right-pads)
    """
    out = []
    for r in rows:
        new = {}
        for src, dst in mapping.items():
            if src not in r:
                continue
            v = r[src]
            if isinstance(v, (datetime, date)):
                v = v.isoformat()
            elif isinstance(v, Decimal):
                v = float(v)
            elif isinstance(v, bytes):
                try:
                    v = v.decode("utf-8", errors="replace")
                except Exception:
                    v = None
            elif isinstance(v, str):
                v = v.strip() if len(v) < 256 else v
                v = v if v != "" else None
            new[dst] = v
        out.append(new)
    return out


def tag_company(rows: List[Dict]) -> List[Dict]:
    for r in rows:
        r["source_company"] = COMPANY
        r["synced_at"] = datetime.utcnow().isoformat()
    return rows


def _end_of_month(d: date) -> date:
    """Last calendar day of the month containing d."""
    if d.month == 12:
        return date(d.year, 12, 31)
    return date(d.year, d.month + 1, 1) - timedelta(days=1)


def compute_aging_buckets(rows: List[Dict], date_field: str = "due_date",
                          balance_field: str = "invoice_balance",
                          as_of: Optional[date] = None) -> None:
    """Fill bucket_* columns in-place using Sage's aging convention:
        - aged by `due_date` (verified against Sage 4-1-3-21 / 3-1-3-21)
        - as-of the last day of the current month (fiscal period-end)
        - skip status in (4 paid, 5 void) — they should never bucket
        - boundary: due today/future = current; due 1-30 days ago = 1-30; etc.

    Verified 2026-04-28 against Sage 100 Contractor v27 at DuBaldo Electric:
    AR total open ties to 3-1-3-21 to the penny; AP total + bucket split tie
    to 4-1-3-21 to the penny when as-of = 4/30 (period-end of run month).
    """
    if as_of is None:
        as_of = _end_of_month(date.today())
    for r in rows:
        bal = float(r.get(balance_field) or 0)
        d_raw = r.get(date_field)
        for k in ("bucket_current", "bucket_1_30", "bucket_31_60",
                  "bucket_61_90", "bucket_over_90"):
            r.setdefault(k, 0)
        # Don't bucket paid (4) or voided (5) — Sage's aging reports exclude
        # them, and our ops views filter them too. invbal isn't zeroed on
        # void in Sage so summing buckets without this guard would inflate.
        if r.get("status") in (4, 5):
            continue
        if not bal or not d_raw:
            continue
        try:
            d = date.fromisoformat(str(d_raw)[:10])
        except (TypeError, ValueError):
            continue
        days_past_due = (as_of - d).days
        if days_past_due <= 0:
            r["bucket_current"] = bal
        elif days_past_due <= 30:
            r["bucket_1_30"] = bal
        elif days_past_due <= 60:
            r["bucket_31_60"] = bal
        elif days_past_due <= 90:
            r["bucket_61_90"] = bal
        else:
            r["bucket_over_90"] = bal


def upsert(sb: Client, table: str, rows: List[Dict], on_conflict: str,
           batch: int = 500, dry_run: bool = False) -> int:
    if not rows:
        log.info("  %-28s  0 rows (skipped)", table)
        return 0
    if dry_run:
        log.info("  %-28s  %5d rows (DRY-RUN, not upserted)", table, len(rows))
        return len(rows)

    total = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        sb.schema("sage").table(table).upsert(chunk, on_conflict=on_conflict).execute()
        total += len(chunk)
    log.info("  %-28s  %5d rows upserted", table, total)
    return total


def run_query(sage, fn, *args):
    sql, params, mapping = fn(*args)
    return coerce(fetch(sage, sql, params), mapping)


# ---------------------------------------------------------------------
# Section runners — v1
# ---------------------------------------------------------------------

def section_gl(sage, sb, counts, dry_run, since):
    log.info("=== General Ledger ===")
    rows = tag_company(run_query(sage, q.q_gl_accounts))
    counts["rows_gl_accounts"] = upsert(sb, "gl_accounts", rows,
                                        "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q.q_gl_subaccounts))
    counts["rows_gl_subaccounts"] = upsert(sb, "gl_subaccounts", rows,
                                           "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q.q_gl_transactions, since))
    counts["rows_gl_transactions"] = upsert(sb, "gl_transactions", rows,
                                            "source_company,recnum", dry_run=dry_run)


def section_payroll(sage, sb, counts, dry_run, since):
    log.info("=== Payroll (header) ===")
    rows = tag_company(run_query(sage, q.q_employees))
    counts["rows_employees"] = upsert(sb, "employees", rows,
                                      "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q.q_payroll_records, since))
    counts["rows_payroll"] = upsert(sb, "payroll_records", rows,
                                    "source_company,recnum", dry_run=dry_run)


def section_arap(sage, sb, counts, dry_run, since):
    log.info("=== AR / AP ===")
    rows = tag_company(run_query(sage, q.q_vendors))
    counts["rows_vendors"] = upsert(sb, "vendors", rows,
                                    "source_company,recnum", dry_run=dry_run)

    rows = run_query(sage, q.q_ar_invoices, since)
    compute_aging_buckets(rows)
    rows = tag_company(rows)
    counts["rows_ar_invoices"] = upsert(sb, "ar_invoices", rows,
                                        "source_company,recnum", dry_run=dry_run)

    rows = run_query(sage, q.q_ap_invoices, since)
    compute_aging_buckets(rows)
    rows = tag_company(rows)
    counts["rows_ap_invoices"] = upsert(sb, "ap_invoices", rows,
                                        "source_company,recnum", dry_run=dry_run)


def section_jobs(sage, sb, counts, dry_run, since):
    log.info("=== Jobs / Job Cost ===")
    rows = tag_company(run_query(sage, q.q_jobs))
    counts["rows_jobs"] = upsert(sb, "jobs", rows,
                                 "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q.q_job_cost_transactions, since))
    counts["rows_job_cost_tx"] = upsert(sb, "job_cost_transactions", rows,
                                        "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q.q_job_budget_lines))
    counts["rows_job_budget_lines"] = upsert(
        sb, "job_budget_lines", rows,
        "source_company,job_recnum,phase_recnum,line_number",
        dry_run=dry_run)


# ---------------------------------------------------------------------
# Section runners — v2
# ---------------------------------------------------------------------

def section_payroll_v2(sage, sb, counts, dry_run, since):
    log.info("=== Payroll detail (timecard) ===")

    # Transactional (since-filtered)
    rows = tag_company(run_query(sage, q2.q_timecard_lines, since))
    counts["rows_timecard_lines"] = upsert(
        sb, "timecard_lines", rows,
        "source_company,recnum,line_number", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_timecard_deductions, since))
    counts["rows_timecard_deductions"] = upsert(
        sb, "timecard_deductions", rows,
        "source_company,recnum,calc_number", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_timecard_benefits, since))
    counts["rows_timecard_benefits"] = upsert(
        sb, "timecard_benefits", rows,
        "source_company,recnum,group_number,deduction_number", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_timecard_wc, since))
    counts["rows_timecard_wc"] = upsert(
        sb, "timecard_wc", rows,
        "source_company,recnum,code_number", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_timecard_paygroups, since))
    counts["rows_timecard_paygroups"] = upsert(
        sb, "timecard_paygroups", rows,
        "source_company,recnum,group_number", dry_run=dry_run)

    # Masters (full refresh — small tables)
    rows = tag_company(run_query(sage, q2.q_paytypes))
    counts["rows_paytypes"] = upsert(sb, "paytypes", rows,
                                     "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_paygroups))
    counts["rows_paygroups"] = upsert(sb, "paygroups", rows,
                                      "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_paydeductions))
    counts["rows_paydeductions"] = upsert(sb, "paydeductions", rows,
                                          "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_payunions))
    counts["rows_payunions"] = upsert(sb, "payunions", rows,
                                      "source_company,recnum", dry_run=dry_run)

    # benefits / employee_pay / employee_qtd / employee_hires / employee_licenses
    # are dropped pending schema redesign — real Sage tables don't match the
    # target schema (see notes in sage_queries_v2.py).

    rows = tag_company(run_query(sage, q2.q_costcodes))
    counts["rows_costcodes"] = upsert(sb, "costcodes", rows,
                                      "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_empabsence))
    counts["rows_empabsence"] = upsert(sb, "empabsence", rows,
                                       "source_company,recnum", dry_run=dry_run)


def section_service(sage, sb, counts, dry_run, since):
    log.info("=== Service receivables ===")

    # Masters first (so FKs resolve cleanly).
    rows = tag_company(run_query(sage, q2.q_service_geo))
    counts["rows_service_geo"] = upsert(sb, "service_geo", rows,
                                        "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_service_types))
    counts["rows_service_types"] = upsert(sb, "service_types", rows,
                                          "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_service_clients))
    counts["rows_service_clients"] = upsert(sb, "service_clients", rows,
                                            "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_service_locations))
    counts["rows_service_locations"] = upsert(sb, "service_locations", rows,
                                              "source_company,recnum,location_number",
                                              dry_run=dry_run)

    # Transactional
    rows = run_query(sage, q2.q_service_invoices, since)
    compute_aging_buckets(rows)
    rows = tag_company(rows)
    counts["rows_service_invoices"] = upsert(sb, "service_invoices", rows,
                                             "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_service_invoice_lines, since))
    counts["rows_service_invoice_lines"] = upsert(
        sb, "service_invoice_lines", rows,
        "source_company,recnum,line_number", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_service_payments, since))
    counts["rows_service_payments"] = upsert(sb, "service_payments", rows,
                                             "source_company,payment_id",
                                             dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_service_schedule, since))
    counts["rows_service_schedule"] = upsert(
        sb, "service_schedule", rows,
        "source_company,recnum,line_number", dry_run=dry_run)


def section_purchase_orders(sage, sb, counts, dry_run, since):
    log.info("=== Purchase orders ===")
    # pchord is small (32 rows) — full refresh.
    rows = tag_company(run_query(sage, q2.q_purchase_orders))
    counts["rows_purchase_orders"] = upsert(sb, "purchase_orders", rows,
                                            "source_company,recnum", dry_run=dry_run)


def section_change_orders(sage, sb, counts, dry_run, since):
    log.info("=== Change orders ===")
    rows = tag_company(run_query(sage, q2.q_change_order_types_prime))
    counts["rows_change_order_types"] = upsert(
        sb, "change_order_types_prime", rows,
        "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_change_order_types_corresp))
    upsert(sb, "change_order_types_corresp", rows,
           "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_prime_change_orders, since))
    counts["rows_prime_change_orders"] = upsert(
        sb, "prime_change_orders", rows,
        "source_company,recnum", dry_run=dry_run)

    rows = tag_company(run_query(sage, q2.q_subcontract_changes, since))
    counts["rows_subcontract_changes"] = upsert(
        sb, "subcontract_changes", rows,
        "source_company,recnum,line_number", dry_run=dry_run)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

SECTIONS = ("gl", "payroll", "arap", "jobs",
            "payroll_v2", "service", "purchase_orders", "change_orders")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Connect & count rows, but do not write to Supabase.")
    parser.add_argument("--only", choices=SECTIONS,
                        help="Run just one section (for debugging).")
    parser.add_argument("--skip", default="",
                        help="Comma-separated list of sections to skip.")
    parser.add_argument("--since", type=int, default=LOOKBACK_DAYS,
                        help=f"Days of history to pull for transactional tables "
                             f"(default {LOOKBACK_DAYS}).")
    args = parser.parse_args()

    skip_set = set(s.strip() for s in args.skip.split(",") if s.strip())
    since = date.today() - timedelta(days=args.since)
    log.info("Sage v27 -> Supabase sync starting  (env=%s, company=%s, "
             "since=%s, dry_run=%s)",
             SAGE_ENV, COMPANY, since, args.dry_run)

    supabase = connect_supabase()
    counts: Dict[str, int] = {}
    run_id = None
    started = datetime.utcnow()

    if not args.dry_run:
        resp = supabase.schema("sage").table("sync_runs").insert({
            "source_company": COMPANY,
            "started_at": started.isoformat(),
            "status": "running",
        }).execute()
        run_id = resp.data[0]["id"] if resp.data else None

    exit_code = 0
    failed_sections: List[str] = []
    try:
        sage = connect_sage()
        try:
            plan = [args.only] if args.only else list(SECTIONS)
            runners = {
                "gl":              lambda: section_gl(sage, supabase, counts, args.dry_run, since),
                "payroll":         lambda: section_payroll(sage, supabase, counts, args.dry_run, since),
                "arap":            lambda: section_arap(sage, supabase, counts, args.dry_run, since),
                "jobs":            lambda: section_jobs(sage, supabase, counts, args.dry_run, since),
                "payroll_v2":      lambda: section_payroll_v2(sage, supabase, counts, args.dry_run, since),
                "service":         lambda: section_service(sage, supabase, counts, args.dry_run, since),
                "purchase_orders": lambda: section_purchase_orders(sage, supabase, counts, args.dry_run, since),
                "change_orders":   lambda: section_change_orders(sage, supabase, counts, args.dry_run, since),
            }
            for name in plan:
                if name in skip_set:
                    log.info("Skipping section '%s' (--skip)", name)
                    continue
                try:
                    runners[name]()
                except Exception:
                    log.error("Section '%s' failed:\n%s", name, traceback.format_exc())
                    failed_sections.append(name)
        finally:
            sage.close()

        status = "success" if not failed_sections else "partial"
    except Exception as e:
        log.error("Fatal error: %s\n%s", e, traceback.format_exc())
        status = "failed"
        exit_code = 1
    finally:
        finished = datetime.utcnow()
        log.info("Finished in %s — status=%s", finished - started, status)
        for k, v in counts.items():
            log.info("  %s = %s", k, v)
        if failed_sections:
            log.warning("Failed sections: %s", ", ".join(failed_sections))
        if run_id and not args.dry_run:
            # Only set columns that exist in the table — sync_runs has the
            # full v1+v2 column set after schema_v2.sql runs. If a v2
            # column is missing (older schema), Supabase will reject the
            # update; we strip unknown counters defensively.
            try:
                supabase.schema("sage").table("sync_runs").update({
                    "finished_at": finished.isoformat(),
                    "status": status,
                    "error_message": ", ".join(failed_sections) or None,
                    **counts,
                }).eq("id", run_id).execute()
            except Exception as e:
                log.warning("sync_runs update failed (likely a missing column "
                            "from schema_v2.sql not having been applied): %s", e)
                # Fallback: write only the universal fields.
                supabase.schema("sage").table("sync_runs").update({
                    "finished_at": finished.isoformat(),
                    "status": status,
                    "error_message": ", ".join(failed_sections) or None,
                }).eq("id", run_id).execute()

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
