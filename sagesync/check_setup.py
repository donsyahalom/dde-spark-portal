"""
check_setup.py
--------------
Pre-flight diagnostic for the Sage -> Supabase sync.

Run this on the Windows machine BEFORE the first backfill or sync run.
It reports, in order:

  1. Python version
  2. Required packages installed
  3. ODBC Driver Manager is present and lists the Sage driver
  4. DSNs available (so you can confirm SAGE_ODBC_DSN matches)
  5. Sage connection works (pulls a trivial row count)
  6. Supabase REST connection works (used by sync.py)
  7. Supabase direct Postgres connection works (used by backfill.py)

Usage (from the folder that contains .env):
    python check_setup.py

Exit code is 0 if everything works, non-zero otherwise.
"""
from __future__ import annotations

import os
import sys
import traceback

OK = "[ OK ]"
WARN = "[WARN]"
FAIL = "[FAIL]"


def step(n, label):
    print(f"\n--- Step {n}: {label} ---")


def result(status, msg):
    print(f"  {status}  {msg}")


failures = 0


# ---------------------------------------------------------------
# 1. Python version
# ---------------------------------------------------------------
step(1, "Python version")
if sys.version_info >= (3, 10):
    result(OK, f"Python {sys.version.split()[0]} (64-bit: {sys.maxsize > 2**32})")
else:
    result(FAIL, f"Python {sys.version.split()[0]} — need 3.10 or newer")
    failures += 1


# ---------------------------------------------------------------
# 2. Required packages
# ---------------------------------------------------------------
step(2, "Required packages")
for pkg in ("pyodbc", "supabase", "dotenv", "psycopg2"):
    try:
        __import__(pkg)
        result(OK, f"{pkg} importable")
    except ImportError as e:
        result(FAIL, f"{pkg} not installed  ({e})")
        failures += 1

if failures:
    print("\nInstall missing packages with:  py -m pip install -r requirements.txt")
    sys.exit(1)


# ---------------------------------------------------------------
# 3. ODBC Driver Manager & Sage driver
# ---------------------------------------------------------------
import pyodbc  # noqa: E402

step(3, "ODBC drivers installed on this machine")
drivers = pyodbc.drivers()
if drivers:
    for d in drivers:
        tag = ""
        if "sage" in d.lower():
            tag = "  <-- Sage"
        elif "sql server" in d.lower():
            tag = "  <-- SQL Server (used by DSN to talk to DEMA-SAGE)"
        print(f"      {d}{tag}")
    result(OK, f"{len(drivers)} driver(s) detected")
else:
    result(FAIL, "pyodbc reports zero ODBC drivers — install 'ODBC Driver 18 "
                 "for SQL Server' from Microsoft.")
    failures += 1


# ---------------------------------------------------------------
# 4. DSNs configured
# ---------------------------------------------------------------
step(4, "ODBC DSNs (System + User)")
dsns = pyodbc.dataSources()
if dsns:
    for name, drv in dsns.items():
        print(f"      {name}  ->  {drv}")
    result(OK, f"{len(dsns)} DSN(s) configured")
else:
    result(WARN, "No DSNs configured. Open 'ODBC Data Sources (64-bit)' and "
                 "create a System DSN named 'Sage100Con' pointing at "
                 "DEMA-SAGE\\SAGE100CON.")


# ---------------------------------------------------------------
# 5. Load .env
# ---------------------------------------------------------------
step(5, "Load .env")
try:
    from dotenv import load_dotenv
    load_dotenv()
    result(OK, ".env loaded")
except Exception as e:
    result(WARN, f"Couldn't load .env ({e}) — relying on existing env vars")

sage_env = (os.getenv("SAGE_SYNC_ENV") or "uat").lower()
if sage_env not in ("uat", "prod"):
    result(FAIL, f"SAGE_SYNC_ENV must be 'uat' or 'prod', got '{sage_env}'")
    failures += 1
else:
    result(OK, f"Active environment: {sage_env}")

prefix = "SUPABASE_UAT" if sage_env == "uat" else "SUPABASE_PROD"


# ---------------------------------------------------------------
# 6. Sage connection test
# ---------------------------------------------------------------
step(6, "Sage connection test")
dsn  = os.getenv("SAGE_ODBC_DSN")
user = os.getenv("SAGE_ODBC_USER")
pwd  = os.getenv("SAGE_ODBC_PASSWORD")

if not dsn:
    result(WARN, "SAGE_ODBC_DSN not set in .env — skipping live test")
elif not pwd or pwd.startswith("<<"):
    result(FAIL, "SAGE_ODBC_PASSWORD is still the placeholder — edit .env")
    failures += 1
else:
    print(f"      Using DSN: {dsn}")
    try:
        app_name = "Sage100Contractor\u00a6SupabaseSync"
        conn = pyodbc.connect(
            f"DSN={dsn};UID={user or ''};PWD={pwd or ''};APP={app_name};",
            timeout=15, autocommit=True)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        conn.close()
        result(OK, "Connected to Sage and ran 'SELECT 1' successfully")
    except Exception as e:
        result(FAIL, f"Sage connection failed: {e}")
        failures += 1


# ---------------------------------------------------------------
# 7. Supabase REST connection test (used by sync.py)
# ---------------------------------------------------------------
step(7, f"Supabase REST connection test  ({sage_env})")
url = os.getenv(f"{prefix}_URL")
key = os.getenv(f"{prefix}_SERVICE_KEY")
if not url or not key:
    result(WARN, f"{prefix}_URL or {prefix}_SERVICE_KEY not set — skipping test")
elif key.startswith("<<"):
    result(FAIL, f"{prefix}_SERVICE_KEY is still the placeholder — edit .env")
    failures += 1
else:
    try:
        from supabase import create_client
        sb = create_client(url, key)
        sb.schema("sage").table("sync_runs").select("id").limit(1).execute()
        result(OK, f"Connected to Supabase at {url}")
    except Exception as e:
        result(FAIL, f"Supabase REST check failed: {e}")
        print("      If the error mentions 'sync_runs' not existing, you "
              "haven't run schema.sql in Supabase yet.")
        failures += 1


# ---------------------------------------------------------------
# 8. Supabase direct Postgres connection test (used by backfill.py)
# ---------------------------------------------------------------
step(8, f"Supabase Postgres connection test  ({sage_env})")
host = os.getenv(f"{prefix}_DB_HOST")
port = int(os.getenv(f"{prefix}_DB_PORT", "5432"))
dbname = os.getenv(f"{prefix}_DB_NAME", "postgres")
pg_user = os.getenv(f"{prefix}_DB_USER", "postgres")
pg_pass = os.getenv(f"{prefix}_DB_PASSWORD")
if not host or not pg_pass:
    result(WARN, f"{prefix}_DB_HOST or {prefix}_DB_PASSWORD not set — "
                 f"skipping test (backfill.py will fail without these)")
else:
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=host, port=port, dbname=dbname,
            user=pg_user, password=pg_pass,
            sslmode="require", connect_timeout=15)
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user")
            db, usr = cur.fetchone()
        conn.close()
        result(OK, f"Connected to Postgres as {usr} on database '{db}'")
    except Exception as e:
        result(FAIL, f"Postgres connection failed: {e}")
        print("      Common causes:")
        print("        - Password wrong (check Supabase > Settings > Database)")
        print("        - Firewall / VPN blocks port 5432 outbound")
        print("        - Host should be db.<project-ref>.supabase.co")
        failures += 1


# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
print("\n" + "=" * 60)
if failures == 0:
    print("All checks passed.")
    print("Next:  run_backfill.bat   (one-shot history)")
    print("Then:  Task Scheduler runs run_sync.bat daily at 2am.")
    sys.exit(0)
else:
    print(f"{failures} check(s) failed. Fix the items marked [FAIL] and re-run.")
    sys.exit(1)
