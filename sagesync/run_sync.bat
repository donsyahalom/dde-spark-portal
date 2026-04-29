@echo off
REM ============================================================
REM Sage 100 Contractor -> Supabase daily sync
REM This is the entry point Task Scheduler calls.
REM Edit the two paths below to match your install.
REM ============================================================

REM -- Folder that contains sync.py and .env --------------------
set "SYNC_DIR=C:\SageSync"

REM -- Python interpreter ---------------------------------------
REM Use the "py" launcher (matches how you installed packages with
REM `py -m pip install`). Task Scheduler inherits PATH from the
REM account it runs as — `py` is always on PATH when Python is
REM installed, `python` may not be.
set "PYTHON=py"
REM Alternative A: explicit venv python:
REM set "PYTHON=C:\SageSync\.venv\Scripts\python.exe"
REM Alternative B: system python on PATH:
REM set "PYTHON=python"

cd /d "%SYNC_DIR%"
"%PYTHON%" sync.py
set RC=%ERRORLEVEL%

REM Task Scheduler picks up the exit code; anything non-zero
REM will show the task as failed in the history pane.
exit /b %RC%
