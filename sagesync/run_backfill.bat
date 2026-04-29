@echo off
REM ============================================================
REM Sage 100 Contractor -> Supabase ONE-SHOT HISTORICAL BACKFILL
REM
REM Run this manually exactly ONCE per environment (UAT, then PROD).
REM After it finishes successfully, leave Task Scheduler running
REM run_sync.bat daily — that will keep Supabase in sync going
REM forward.
REM
REM Re-run safety:
REM   - backfill.py is idempotent (uses INSERT ... ON CONFLICT)
REM   - Pass --resume to skip tables already marked 'success' in
REM     sage.backfill_runs if an earlier attempt died partway.
REM   - Pass --truncate to wipe tables before reload (use with care).
REM ============================================================

set "SYNC_DIR=C:\SageSync"

REM -- Python interpreter ---------------------------------------
REM Use the "py" launcher (matches how you ran pip install). If you
REM installed into a venv instead, swap for the venv path.
set "PYTHON=py"
REM Alternative A: explicit venv python:
REM set "PYTHON=C:\SageSync\.venv\Scripts\python.exe"
REM Alternative B: system python on PATH:
REM set "PYTHON=python"

cd /d "%SYNC_DIR%"

echo.
echo ============================================================
echo  Sage -^> Supabase BACKFILL
echo  This will pull ALL history. Expect 30-120 minutes.
echo  Logs go to %SYNC_DIR%\logs\backfill_*.log
echo ============================================================
echo.
echo Args passed through: %*
echo.

"%PYTHON%" backfill.py %*
set RC=%ERRORLEVEL%

echo.
echo Backfill exit code: %RC%
echo.
if %RC% NEQ 0 (
    echo Some tables failed. Re-run:
    echo     run_backfill.bat --resume
    echo to skip tables already completed.
)

exit /b %RC%
