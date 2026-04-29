"""
backfill.py
-----------
One-shot historical loader for the Sage 100 Contractor v27 -> Supabase sync.

This script pulls EVERY row from each Sage table (no `since` filter) and
streams it directly into Supabase Postgres via a server-to-server
connection (port 5432) using psycopg2 + COPY-style batched inserts.
It is intentionally separate from sync.py so that:

  - The daily sync stays simple (PostgREST upserts via the supabase-py
    client) and the backfill can grind through millions of rows without
    being throttled by PostgREST rate limits.
  - You can re-run a single table if it fails in the middle of a
    backfill, without touching anything else.
  - The backfill writes a per-table watermark to sage.backfill_runs so
    a re-run can skip tables already finished.

Usage:
    py backfill.py                       # backfill every table
    py backfill.py --dry-run             # connect & count rows, no writes
    py backfill.py --only timecard_lines # one table only
    py backfill.py --skip ar_invoices    # skip these tables (comma list)
    py backfill.py --resume              # skip tables already marked done
    py backfill.py --truncate            # TRUNCATE each table before load
                                          (use with care — wipes existing data)

Env vars (loaded from .env in the same directory; see .env.example):
    SAGE_SYNC_ENV          - "uat" or "prod" — picks which Supabase to write to
    SAGE_ODBC_DSN          - ODBC DSN for SQL Server (e.g. "Sage100Con")
    SAGE_ODBC_USER         - "sage_reader"
    SAGE_ODBC_PASSWORD     - the password for sage_reader
    SAGE_COMPANY_NAME      - tag stamped on every synced row (e.g. "DUBALDO")
    SUPABASE_UAT_URL       - https://yhvjvxibsxvqvsplauan.supabase.co
    SUPABASE_UAT_DB_HOST   - db.yhvjvxibsxvqvsplauan.supabase.co
    SUPABASE_UAT_DB_PASSWORD
    SUPABASE_UAT_SERVICE_KEY
    SUPABASE_PROD_URL      - https://tagfzkffedlbiqtlncry.supabase.co
    SUPABASE_PROD_DB_HOST  - db.tagfzkffedlbiqtlncry.supabase.co
    SUPABASE_PROD_DB_PASSWORD
    SUPABASE_PROD_SERVICE_KEY

Requires:
    py -m pip install -r requirements.txt
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
import urllib.parse
from datetime import date, datetime
from decimal import Decimal
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import psycopg2
import psycopg2.extras
import pyodbc
from dotenv import load_dotenv

import sage_queries as q1
import sage_queries_v2 as q2


# ---------------------------------------------------------------------
# Config / logging
# ---------------------------------------------------------------------

load_dotenv()

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, f"backfill_{datetime.now():%Y%m%d_%H%M%S}.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("sage-backfill")


def env(key: str, required: bool = True, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(key, default)
    if required and not val:
        log.error("Missing required env var: %s", key)
        sys.exit(2)
    return val


# Pick the active Supabase environment.
SAGE_ENV = (env("SAGE_SYNC_ENV", default="uat") or "uat").lower()
if SAGE_ENV not in ("uat", "prod"):
    log.error("SAGE_SYNC_ENV must be 'uat' or 'prod', got '%s'", SAGE_ENV)
    sys.exit(2)
prefix = "SUPABASE_UAT" if SAGE_ENV == "uat" else "SUPABASE_PROD"

SAGE_DSN      = env("SAGE_ODBC_DSN")
SAGE_USER     = env("SAGE_ODBC_USER")
SAGE_PASSWORD = env("SAGE_ODBC_PASSWORD")
COMPANY       = env("SAGE_COMPANY_NAME")
SB_URL        = env(f"{prefix}_URL")
SB_DB_HOST    = env(f"{prefix}_DB_HOST")
SB_DB_PASS    = env(f"{prefix}_DB_PASSWORD")
SB_DB_USER    = env(f"{prefix}_DB_USER",     required=False, default="postgres")
SB_DB_PORT    = int(env(f"{prefix}_DB_PORT", required=False, default="5432"))
SB_DB_NAME    = env(f"{prefix}_DB_NAME",     required=False, default="postgres")

BATCH_SIZE    = int(env("BACKFILL_BATCH_SIZE", required=False, default="1000"))


# ---------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------

def connect_sage() -> pyodbc.Connection:
    app_name = "Sage100Contractor\u00a6SupabaseSync"
    conn_str = (
        f"DSN={SAGE_DSN};UID={SAGE_USER};PWD={SAGE_PASSWORD};"
        f"APP={app_name};"
    )
    log.info("Connecting to Sage via ODBC DSN '%s' as '%s' (APP=%s)",
             SAGE_DSN, SAGE_USER, app_name)
    return pyodbc.connect(conn_str, autocommit=True, timeout=120)


def connect_pg() -> "psycopg2.extensions.connection":
    log.info("Connecting to Supabase Postgres at %s:%s/%s as %s (env=%s)",
             SB_DB_HOST, SB_DB_PORT, SB_DB_NAME, SB_DB_USER, SAGE_ENV)
    conn = psycopg2.connect(
        host=SB_DB_HOST,
        port=SB_DB_PORT,
        dbname=SB_DB_NAME,
        user=SB_DB_USER,
        password=SB_DB_PASS,
        sslmode="require",
        connect_timeout=30,
    )
    conn.autocommit = False
    return conn


# ---------------------------------------------------------------------
# Bookkeeping table
# ---------------------------------------------------------------------

DDL_BACKFILL_RUNS = """
CREATE TABLE IF NOT EXISTS sage.backfill_runs (
    id              BIGSERIAL PRIMARY KEY,
    source_company  TEXT,
    table_name      TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          TEXT,           -- 'running' | 'success' | 'failed'
    rows_loaded     BIGINT DEFAULT 0,
    error_message   TEXT,
    UNIQUE (source_company, table_name)
);
"""


def ensure_bookkeeping(pg: "psycopg2.extensions.connection") -> None:
    with pg.cursor() as cur:
        cur.execute(DDL_BACKFILL_RUNS)
    pg.commit()


def already_done(pg: "psycopg2.extensions.connection", table: str) -> bool:
    with pg.cursor() as cur:
        cur.execute(
            "SELECT status FROM sage.backfill_runs "
            "WHERE source_company=%s AND table_name=%s",
            (COMPANY, table))
        row = cur.fetchone()
        return bool(row and row[0] == "success")


def mark_started(pg: "psycopg2.extensions.connection", table: str) -> None:
    with pg.cursor() as cur:
        cur.execute("""
            INSERT INTO sage.backfill_runs (source_company, table_name, status)
            VALUES (%s, %s, 'running')
            ON CONFLICT (source_company, table_name)
            DO UPDATE SET status='running',
                          started_at=NOW(),
                          finished_at=NULL,
                          rows_loaded=0,
                          error_message=NULL
        """, (COMPANY, table))
    pg.commit()


def mark_finished(pg, table: str, rows: int, status: str,
                  error: Optional[str] = None) -> None:
    with pg.cursor() as cur:
        cur.execute("""
            UPDATE sage.backfill_runs
               SET finished_at = NOW(),
                   status      = %s,
                   rows_loaded = %s,
                   error_message = %s
             WHERE source_company=%s AND table_name=%s
        """, (status, rows, error, COMPANY, table))
    pg.commit()


# ---------------------------------------------------------------------
# Sage row reader
# ---------------------------------------------------------------------

def coerce_value(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8", errors="replace")
        except Exception:
            return None
    if isinstance(v, str):
        v = v.strip() if len(v) < 256 else v
        return v if v != "" else None
    return v


def stream_rows(sage: pyodbc.Connection, sql: str, params: Tuple,
                mapping: Dict[str, str], batch: int) -> Iterable[List[Dict]]:
    """Yield batches of mapped+coerced dicts so we never hold the whole table
    in memory."""
    cur = sage.cursor()
    cur.execute(sql, params) if params else cur.execute(sql)
    cols_src = [c[0] for c in cur.description]
    chunk: List[Dict] = []
    while True:
        rows = cur.fetchmany(batch)
        if not rows:
            break
        for r in rows:
            src = dict(zip(cols_src, r))
            new = {}
            for s, d in mapping.items():
                if s not in src:
                    continue
                new[d] = coerce_value(src[s])
            new["source_company"] = COMPANY
            chunk.append(new)
            if len(chunk) >= batch:
                yield chunk
                chunk = []
    if chunk:
        yield chunk
    cur.close()


# ---------------------------------------------------------------------
# Postgres bulk upsert
# ---------------------------------------------------------------------

def upsert_batch(pg, schema: str, table: str, rows: List[Dict],
                 conflict_cols: List[str]) -> int:
    if not rows:
        return 0
    cols = list(rows[0].keys())
    col_csv = ", ".join(f'"{c}"' for c in cols)
    update_csv = ", ".join(f'"{c}" = EXCLUDED."{c}"'
                           for c in cols if c not in conflict_cols)
    conflict_csv = ", ".join(f'"{c}"' for c in conflict_cols)
    sql = (
        f'INSERT INTO "{schema}"."{table}" ({col_csv}) VALUES %s '
        f'ON CONFLICT ({conflict_csv}) '
    )
    if update_csv:
        sql += f"DO UPDATE SET {update_csv}"
    else:
        sql += "DO NOTHING"
    values = [tuple(r.get(c) for c in cols) for r in rows]
    with pg.cursor() as cur:
        psycopg2.extras.execute_values(cur, sql, values, page_size=len(values))
    pg.commit()
    return len(values)


def truncate_table(pg, schema: str, table: str) -> None:
    log.warning("  TRUNCATE %s.%s", schema, table)
    with pg.cursor() as cur:
        cur.execute(f'TRUNCATE TABLE "{schema}"."{table}"')
    pg.commit()


# ---------------------------------------------------------------------
# Table catalog
# ---------------------------------------------------------------------

# Each entry: (target_table, conflict_cols, lambda producing (sql,params,map))
# Tables that take a `since` are passed date(1970,1,1) so the WHERE is permissive.
EPOCH = date(1970, 1, 1)

CATALOG: List[Tuple[str, List[str], Callable[[], Tuple[str, Tuple, Dict]]]] = [
    # --- v1 master / dimension tables -------------------------------
    ("gl_accounts",            ["source_company", "recnum"],          lambda: q1.q_gl_accounts()),
    ("gl_subaccounts",         ["source_company", "recnum"],          lambda: q1.q_gl_subaccounts()),
    ("vendors",                ["source_company", "recnum"],          lambda: q1.q_vendors()),
    ("employees",              ["source_company", "recnum"],          lambda: q1.q_employees()),
    ("jobs",                   ["source_company", "recnum"],          lambda: q1.q_jobs()),
    ("job_budget_lines",       ["source_company", "job_recnum",
                                "phase_recnum", "line_number"],       lambda: q1.q_job_budget_lines()),

    # --- v1 transactional (full history) ----------------------------
    ("gl_transactions",        ["source_company", "recnum"],          lambda: q1.q_gl_transactions(EPOCH)),
    ("payroll_records",        ["source_company", "recnum"],          lambda: q1.q_payroll_records(EPOCH)),
    ("ar_invoices",            ["source_company", "recnum"],          lambda: q1.q_ar_invoices(EPOCH)),
    ("ap_invoices",            ["source_company", "recnum"],          lambda: q1.q_ap_invoices(EPOCH)),
    ("job_cost_transactions",  ["source_company", "recnum"],          lambda: q1.q_job_cost_transactions(EPOCH)),

    # --- v2 payroll masters ----------------------------------------
    ("paytypes",               ["source_company", "recnum"],          lambda: q2.q_paytypes()),
    ("paygroups",              ["source_company", "recnum"],          lambda: q2.q_paygroups()),
    ("paydeductions",          ["source_company", "recnum"],          lambda: q2.q_paydeductions()),
    ("payunions",              ["source_company", "recnum"],          lambda: q2.q_payunions()),
    # benefits / employee_pay / employee_qtd / employee_hires / employee_licenses
    # are dropped pending schema redesign — real Sage tables don't match the
    # target schema (see notes in sage_queries_v2.py).
    ("costcodes",              ["source_company", "recnum"],          lambda: q2.q_costcodes()),
    ("empabsence",             ["source_company", "recnum"],          lambda: q2.q_empabsence()),

    # --- v2 timecard detail (transactional, full history) ----------
    ("timecard_lines",         ["source_company", "recnum",
                                "line_number"],                       lambda: q2.q_timecard_lines(EPOCH)),
    ("timecard_deductions",    ["source_company", "recnum",
                                "calc_number"],                       lambda: q2.q_timecard_deductions(EPOCH)),
    ("timecard_benefits",      ["source_company", "recnum",
                                "group_number", "deduction_number"],  lambda: q2.q_timecard_benefits(EPOCH)),
    ("timecard_wc",            ["source_company", "recnum",
                                "code_number"],                       lambda: q2.q_timecard_wc(EPOCH)),
    ("timecard_paygroups",     ["source_company", "recnum",
                                "group_number"],                      lambda: q2.q_timecard_paygroups(EPOCH)),

    # --- v2 service masters & transactional ------------------------
    ("service_geo",            ["source_company", "recnum"],          lambda: q2.q_service_geo()),
    ("service_types",          ["source_company", "recnum"],          lambda: q2.q_service_types()),
    ("service_clients",        ["source_company", "recnum"],          lambda: q2.q_service_clients()),
    ("service_locations",      ["source_company", "recnum",
                                "location_number"],                   lambda: q2.q_service_locations()),
    ("service_invoices",       ["source_company", "recnum"],          lambda: q2.q_service_invoices(EPOCH)),
    ("service_invoice_lines",  ["source_company", "recnum",
                                "line_number"],                       lambda: q2.q_service_invoice_lines(EPOCH)),
    ("service_payments",       ["source_company", "payment_id"],      lambda: q2.q_service_payments(EPOCH)),
    ("service_schedule",       ["source_company", "recnum",
                                "line_number"],                       lambda: q2.q_service_schedule(EPOCH)),

    # --- v2 purchase orders & change orders ------------------------
    ("purchase_orders",        ["source_company", "recnum"],          lambda: q2.q_purchase_orders()),
    ("change_order_types_prime",   ["source_company", "recnum"],      lambda: q2.q_change_order_types_prime()),
    ("change_order_types_corresp", ["source_company", "recnum"],      lambda: q2.q_change_order_types_corresp()),
    ("prime_change_orders",    ["source_company", "recnum"],          lambda: q2.q_prime_change_orders(EPOCH)),
    ("subcontract_changes",    ["source_company", "recnum",
                                "line_number"],                       lambda: q2.q_subcontract_changes(EPOCH)),
]


# ---------------------------------------------------------------------
# Aging buckets (post-load adjustment for ar_invoices, ap_invoices,
# service_invoices). Computed by a single SQL UPDATE per table — much
# faster than doing it row-by-row in Python.
# ---------------------------------------------------------------------

AGING_TABLES = ("ar_invoices", "ap_invoices", "service_invoices")

AGING_SQL_TEMPLATE = """
UPDATE sage.{table} SET
    bucket_current  = CASE WHEN inv_age <  1 THEN balance ELSE 0 END,
    bucket_1_30     = CASE WHEN inv_age >= 1   AND inv_age <= 30 THEN balance ELSE 0 END,
    bucket_31_60    = CASE WHEN inv_age >= 31  AND inv_age <= 60 THEN balance ELSE 0 END,
    bucket_61_90    = CASE WHEN inv_age >= 61  AND inv_age <= 90 THEN balance ELSE 0 END,
    bucket_over_90  = CASE WHEN inv_age >  90 THEN balance ELSE 0 END
FROM (
    SELECT recnum,
           COALESCE(invoice_balance, 0)::numeric AS balance,
           (CURRENT_DATE - invoice_date)::INTEGER AS inv_age
      FROM sage.{table}
     WHERE invoice_date IS NOT NULL
) sub
WHERE sage.{table}.recnum = sub.recnum
  AND sage.{table}.source_company = %s;
"""


def recompute_aging(pg, table: str) -> None:
    log.info("  Recomputing aging buckets on sage.%s ...", table)
    with pg.cursor() as cur:
        cur.execute(AGING_SQL_TEMPLATE.format(table=table), (COMPANY,))
    pg.commit()


# ---------------------------------------------------------------------
# Backfill runner for one table
# ---------------------------------------------------------------------

def backfill_one(sage, pg, table: str, conflict_cols: List[str],
                 query_factory, args) -> int:
    log.info("------------------------------------------------------------")
    log.info("Backfilling sage.%s", table)
    if args.resume and already_done(pg, table):
        log.info("  Already marked done in sage.backfill_runs — skipping.")
        return 0

    sql, params, mapping = query_factory()

    if args.dry_run:
        # Just count rows.
        cur = sage.cursor()
        cur.execute(f"SELECT COUNT(*) FROM ({sql}) x", params) if params \
            else cur.execute(f"SELECT COUNT(*) FROM ({sql}) x")
        n = cur.fetchone()[0]
        cur.close()
        log.info("  DRY-RUN  source has %d rows", n)
        return n

    if args.truncate:
        try:
            truncate_table(pg, "sage", table)
        except Exception:
            log.error("  TRUNCATE failed:\n%s", traceback.format_exc())
            raise

    mark_started(pg, table)
    total = 0
    try:
        for batch in stream_rows(sage, sql, params, mapping, BATCH_SIZE):
            n = upsert_batch(pg, "sage", table, batch, conflict_cols)
            total += n
            log.info("  + %5d rows  (running total %d)", n, total)

        if table in AGING_TABLES:
            recompute_aging(pg, table)

        mark_finished(pg, table, total, "success")
        log.info("  DONE  %d rows", total)
        return total
    except Exception as e:
        # Roll back FIRST — psycopg2 leaves the connection in an aborted
        # state after a failed statement, and any subsequent execute
        # (including mark_finished's UPDATE) will hit
        # InFailedSqlTransaction. Logging the original traceback also
        # has to happen before mark_finished, since mark_finished may
        # itself fail and replace the useful traceback.
        log.error("  FAILED after %d rows:\n%s", total, traceback.format_exc())
        try:
            pg.rollback()
        except Exception:
            log.error("  rollback() failed:\n%s", traceback.format_exc())
        try:
            mark_finished(pg, table, total, "failed", str(e)[:4000])
        except Exception:
            log.error("  mark_finished() failed:\n%s", traceback.format_exc())
            try:
                pg.rollback()
            except Exception:
                pass
        raise


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Connect & count rows for each table; do not write.")
    parser.add_argument("--only",
                        help="Comma-separated list of tables to load (others skipped).")
    parser.add_argument("--skip", default="",
                        help="Comma-separated list of tables to skip.")
    parser.add_argument("--resume", action="store_true",
                        help="Skip tables already marked 'success' in sage.backfill_runs.")
    parser.add_argument("--truncate", action="store_true",
                        help="TRUNCATE each target table before load. WIPES existing data.")
    args = parser.parse_args()

    only_set = set(t.strip() for t in args.only.split(",")) if args.only else None
    skip_set = set(t.strip() for t in args.skip.split(",") if t.strip())

    log.info("============================================================")
    log.info("Sage v27 -> Supabase BACKFILL  env=%s  company=%s  dry_run=%s",
             SAGE_ENV, COMPANY, args.dry_run)
    log.info("Target Supabase: %s", SB_URL)
    log.info("============================================================")

    sage = connect_sage()
    pg   = connect_pg()
    try:
        ensure_bookkeeping(pg)
    except Exception:
        log.error("Could not create sage.backfill_runs:\n%s", traceback.format_exc())
        return 1

    failed: List[str] = []
    grand_total = 0
    started = datetime.utcnow()

    try:
        for table, conflict_cols, fn in CATALOG:
            if only_set and table not in only_set:
                continue
            if table in skip_set:
                log.info("Skipping sage.%s (--skip)", table)
                continue
            try:
                grand_total += backfill_one(sage, pg, table, conflict_cols, fn, args)
            except Exception:
                # Log BEFORE appending so the traceback is visible in the log
                # even when the inner handler in backfill_one didn't fire
                # (e.g., errors in query_factory(), mark_started(), or the
                # Supabase-side pooler timing out mid-statement).
                log.error("  UNCAUGHT in %s:\n%s", table, traceback.format_exc())
                # Always roll back BEFORE the bookkeeping write — otherwise
                # an aborted-transaction state cascades into mark_finished
                # and we lose both the row count and the error.
                try:
                    pg.rollback()
                except Exception:
                    log.error("  rollback() failed:\n%s", traceback.format_exc())
                try:
                    mark_finished(pg, table, 0, "failed", traceback.format_exc()[:4000])
                except Exception:
                    log.error("  mark_finished() failed:\n%s", traceback.format_exc())
                    try:
                        pg.rollback()
                    except Exception:
                        pass
                failed.append(table)
                # Continue with the next table instead of aborting the whole run.
    finally:
        sage.close()
        pg.close()
        finished = datetime.utcnow()
        log.info("============================================================")
        log.info("Backfill finished in %s — total rows loaded: %d",
                 finished - started, grand_total)
        if failed:
            log.warning("Failed tables (%d): %s", len(failed), ", ".join(failed))
            log.warning("Re-run with `--only %s` after fixing the cause.",
                        ",".join(failed))
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
