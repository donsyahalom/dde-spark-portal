-- =====================================================================
-- discover_payroll_tables.sql
-- =====================================================================
-- Purpose:
--   Enumerate every payroll-, employee-, daily-time-, benefit-,
--   accrual- and burden-related table in the Sage 100 Contractor v27
--   company database, along with their columns and row counts, so the
--   sync maintainer can add the missing queries (paycheck-calculation
--   line items, daily time detail, accrual balances, etc.) against the
--   exact schema that is installed on this box.
--
-- Safe to run:
--   Read-only. No writes, no temp tables, no schema changes.
--   Completes in a few seconds even on large DBs.
--
-- How to run:
--   1. Open SQL Server Management Studio (SSMS).
--   2. Connect to the Sage SQL instance (e.g. DEMA-SAGE\SAGE100CON)
--      with a login that has at least db_datareader + VIEW DEFINITION
--      on the company database. A Sage sysadmin login is fine.
--   3. *** IMPORTANT *** Change the database context to the COMPANY DB.
--      The default on connect is usually `master`, which contains NONE
--      of the Sage tables — running the script there returns empty
--      result sets.  Either:
--        (a) Use the "Available Databases" dropdown in the SSMS
--            toolbar to pick the DuBaldo company database (its name
--            looks like `DuBaldo Electric 4.15.22`), OR
--        (b) Edit the USE statement at the top of this script to name
--            your company database and uncomment it.
--      The preamble below double-checks this and will ERROR out with a
--      clear message if the current DB is not a Sage company DB.
--   4. Run the whole script (F5).
--   5. You will get SEVEN result-set panes back. For each one:
--        - Right-click the grid -> "Select All"
--        - Right-click again -> "Save Results As..." -> CSV
--        - Name the file after the result-set number (01_tables.csv,
--          02_columns.csv, ...).
--      Alternatively, copy-paste each grid into a single text file.
--   6. Send all 7 CSVs (or the combined text file) back to the sync
--      maintainer.
--
-- Result sets returned (in order):
--   1. Tables that contain a column named empnum     — employee-linked
--   2. Tables that contain a column named payrec     — paycheck-detail
--   3. Tables that contain a column named dlynum /
--      dlyrec / dlytme                               — daily-time linked
--   4. Candidate tables by NAME pattern              — masters we may
--                                                      want (pay calcs,
--                                                      cost-code master,
--                                                      WC, unions, etc.)
--   5. Columns for every table surfaced in #1–#4
--   6. Row counts for every table surfaced in #1–#4
--   7. SQL Server version + database name (for reference)
-- =====================================================================

SET NOCOUNT ON;


-- ---------------------------------------------------------------------
-- 0. Uncomment the line below and set it to your Sage company DB name
--    if you don't want to use the SSMS "Available Databases" dropdown.
-- ---------------------------------------------------------------------
-- USE [DuBaldo Electric 4.15.22];
-- GO


-- ---------------------------------------------------------------------
-- 0a. Sanity check: are we in the Sage company DB?
--     If dbo.employ does not exist in the current database, the rest
--     of the script will return nothing useful.  Abort loudly instead.
-- ---------------------------------------------------------------------
PRINT '--- Current database context ---';
SELECT
    DB_NAME()        AS current_db,
    SUSER_SNAME()    AS connected_as;

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables t
    WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
      AND t.name IN ('employ','payrec','actrec')
)
BEGIN
    DECLARE @msg nvarchar(1000) = N'WRONG DATABASE: current database is `'
        + DB_NAME()
        + N'`, which does NOT contain Sage tables (dbo.employ / dbo.payrec / dbo.actrec).'
        + N'  Change the SSMS "Available Databases" dropdown to the company DB '
        + N'(e.g. `DuBaldo Electric 4.15.22`) and re-run this script.';
    RAISERROR(@msg, 16, 1);
    RETURN;
END

PRINT '--- Sage tables detected in current DB — continuing ---';


-- ---------------------------------------------------------------------
-- 1. Employee-linked tables (any dbo.* with an empnum column)
-- ---------------------------------------------------------------------
PRINT '--- 1. Tables with an empnum column (employee-linked) ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name,
    c.name                    AS linking_column,
    tp.name                   AS linking_column_type
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   tp ON tp.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND c.name = 'empnum'
ORDER BY t.name;


-- ---------------------------------------------------------------------
-- 2. Paycheck-detail-linked tables (any dbo.* with a payrec column)
-- ---------------------------------------------------------------------
PRINT '--- 2. Tables with a payrec column (paycheck-linked) ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name,
    c.name                    AS linking_column,
    tp.name                   AS linking_column_type
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   tp ON tp.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND c.name = 'payrec'
ORDER BY t.name;


-- ---------------------------------------------------------------------
-- 3. Daily-time-linked tables (any dbo.* with a daily-time-ish column)
-- ---------------------------------------------------------------------
PRINT '--- 3. Tables with a daily-time-style column ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name,
    c.name                    AS linking_column,
    tp.name                   AS linking_column_type
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   tp ON tp.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND c.name IN ('dlynum','dlyrec','dlytme','tmenum','tmerec','tmecrd')
ORDER BY t.name, c.name;


-- ---------------------------------------------------------------------
-- 4. Candidate tables by NAME pattern
--    Catches master tables that may not link by empnum/payrec:
--      pay*   — payroll tables
--      dly*   — daily time
--      tme*   — timecards
--      accr*, pacc* — accruals
--      emp*   — employee-adjacent
--      bene*, benf* — benefits
--      ded*, dedn*  — deductions
--      uni*, unn*, union* — unions
--      wc*, wrk*, wrkcmp* — workers comp
--      fring*, frng*, frg* — fringes
--      cstcde, cstyp, phase, phsdsc — cost-code / phase masters
-- ---------------------------------------------------------------------
PRINT '--- 4. Candidate tables by NAME pattern ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name
FROM sys.tables t
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND (
       t.name LIKE 'pay%'
    OR t.name LIKE 'dly%'
    OR t.name LIKE 'tme%'
    OR t.name LIKE 'tm[a-z]%'
    OR t.name LIKE 'accr%'
    OR t.name LIKE 'pacc%'
    OR t.name LIKE 'emp%'
    OR t.name LIKE 'bene%'
    OR t.name LIKE 'benf%'
    OR t.name LIKE 'ded%'
    OR t.name LIKE 'dedn%'
    OR t.name LIKE 'uni%'
    OR t.name LIKE 'unn%'
    OR t.name LIKE 'union%'
    OR t.name LIKE 'wc%'
    OR t.name LIKE 'wrk%'
    OR t.name LIKE 'wrkcmp%'
    OR t.name LIKE 'fring%'
    OR t.name LIKE 'frng%'
    OR t.name LIKE 'frg%'
    OR t.name IN ('cstcde','cstyp','phase','phsdsc','cstcd','cstdsc')
  )
ORDER BY t.name;


-- ---------------------------------------------------------------------
-- 5. Column lists for every table surfaced in 1-4
--    Big result set — this is the authoritative answer about
--    what each candidate table actually looks like.
-- ---------------------------------------------------------------------
PRINT '--- 5. Columns for every surfaced table ---';

WITH surfaced_tables AS (
    SELECT t.object_id, t.name
    FROM sys.tables t
    WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
      AND (
            -- has an employee / paycheck / daily-time linking column
            EXISTS (SELECT 1 FROM sys.columns c
                    WHERE c.object_id = t.object_id
                      AND c.name IN ('empnum','payrec','dlynum','dlyrec','dlytme'))
            -- or matches one of the NAME patterns in result set #4
            OR t.name LIKE 'pay%'
            OR t.name LIKE 'dly%'
            OR t.name LIKE 'tme%'
            OR t.name LIKE 'tm[a-z]%'
            OR t.name LIKE 'accr%'
            OR t.name LIKE 'pacc%'
            OR t.name LIKE 'emp%'
            OR t.name LIKE 'bene%'
            OR t.name LIKE 'benf%'
            OR t.name LIKE 'ded%'
            OR t.name LIKE 'dedn%'
            OR t.name LIKE 'uni%'
            OR t.name LIKE 'unn%'
            OR t.name LIKE 'union%'
            OR t.name LIKE 'wc%'
            OR t.name LIKE 'wrk%'
            OR t.name LIKE 'wrkcmp%'
            OR t.name LIKE 'fring%'
            OR t.name LIKE 'frng%'
            OR t.name LIKE 'frg%'
            OR t.name IN ('cstcde','cstyp','phase','phsdsc','cstcd','cstdsc')
          )
)
SELECT
    st.name                                  AS table_name,
    c.column_id                              AS ordinal,
    c.name                                   AS column_name,
    tp.name                                  AS data_type,
    c.max_length                             AS max_length,
    c.[precision]                            AS [precision],
    c.scale                                  AS scale,
    CASE WHEN c.is_nullable = 1
         THEN 'YES' ELSE 'NO' END            AS is_nullable
FROM surfaced_tables st
JOIN sys.columns c   ON c.object_id = st.object_id
JOIN sys.types   tp  ON tp.user_type_id = c.user_type_id
ORDER BY st.name, c.column_id;


-- ---------------------------------------------------------------------
-- 6. Row counts for every surfaced table
--    Uses sys.partitions for an approximate (but fast) count;
--    accurate enough to tell the sync author which tables are
--    transactional (lots of rows) vs master (few rows).
-- ---------------------------------------------------------------------
PRINT '--- 6. Approximate row counts for every surfaced table ---';

WITH surfaced_tables AS (
    SELECT t.object_id, t.name
    FROM sys.tables t
    WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
      AND (
            EXISTS (SELECT 1 FROM sys.columns c
                    WHERE c.object_id = t.object_id
                      AND c.name IN ('empnum','payrec','dlynum','dlyrec','dlytme'))
            OR t.name LIKE 'pay%'
            OR t.name LIKE 'dly%'
            OR t.name LIKE 'tme%'
            OR t.name LIKE 'tm[a-z]%'
            OR t.name LIKE 'accr%'
            OR t.name LIKE 'pacc%'
            OR t.name LIKE 'emp%'
            OR t.name LIKE 'bene%'
            OR t.name LIKE 'benf%'
            OR t.name LIKE 'ded%'
            OR t.name LIKE 'dedn%'
            OR t.name LIKE 'uni%'
            OR t.name LIKE 'unn%'
            OR t.name LIKE 'union%'
            OR t.name LIKE 'wc%'
            OR t.name LIKE 'wrk%'
            OR t.name LIKE 'wrkcmp%'
            OR t.name LIKE 'fring%'
            OR t.name LIKE 'frng%'
            OR t.name LIKE 'frg%'
            OR t.name IN ('cstcde','cstyp','phase','phsdsc','cstcd','cstdsc')
          )
)
SELECT
    st.name            AS table_name,
    SUM(p.[rows])      AS approx_row_count
FROM surfaced_tables st
JOIN sys.partitions p ON p.object_id = st.object_id
                     AND p.index_id IN (0, 1)
GROUP BY st.name
ORDER BY st.name;


-- ---------------------------------------------------------------------
-- 7. SQL Server version + current DB name (for the maintainer's ref)
-- ---------------------------------------------------------------------
PRINT '--- 7. Environment info ---';

SELECT
    @@VERSION        AS sql_server_version,
    DB_NAME()        AS database_name,
    SUSER_SNAME()    AS connected_as,
    GETDATE()        AS run_at_local;

-- =====================================================================
-- End of discover_payroll_tables.sql
-- =====================================================================
