-- =====================================================================
-- discover_service_po_tables.sql
-- =====================================================================
-- Second pass of schema discovery, focused on areas NOT covered by
-- discover_payroll_tables.sql:
--
--   - Service Receivables         (srv*)
--   - Purchase Orders             (pch*, pur*, pord*)
--   - Work Orders / Dispatch      (wrk*, dsp*, dsptch)
--   - Change Orders               (chg*, cor*)
--   - AR / AP invoice line items  (acrlin, acplin, etc.)
--   - Progress billings           (bill*, bll*, billng*, prog*)
--   - Phase masters               (phs*)
--   - Anything with an invnum /
--     ponum / wrknum / srvnum /
--     chgnum / schnum / ordnum
--     column that we haven't
--     already surfaced elsewhere.
--
-- Safe to run:
--   Read-only. No writes, no temp tables, no schema changes.
--   Completes in a few seconds.
--
-- How to run:
--   1. Open SQL Server Management Studio (SSMS).
--   2. Connect to the Sage SQL instance (e.g. DEMA-SAGE\SAGE100CON)
--      with a login that has at least db_datareader + VIEW DEFINITION
--      on the company database.
--   3. *** IMPORTANT *** Change the database context to the COMPANY DB.
--      The default on connect is usually `master`, which contains NONE
--      of the Sage tables — running the script there returns empty
--      result sets. Either:
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
--        - Name the file after the result-set number
--          (01_srv_po.csv, 02_srv_po.csv, ...).
--      Alternatively, copy-paste each grid into a single text file.
--   6. Send the 7 CSVs (or the combined text file) back to the sync
--      maintainer.
--
-- Result sets returned (in order):
--   1. Candidate tables by NAME pattern
--        (srv*, pch*, pur*, pord*, chg*, cor*, wrk*, dsp*, bill*, bll*,
--         billng*, acrlin, acrdet, acrpmt, acplin, acpdet, acppmt,
--         phs*, ord*, schdl*, schd*, prog*)
--   2. Tables with an  invnum  column       — invoice child tables
--   3. Tables with a   jobnum  column       — job-linked tables
--                                             (may overlap jobcst etc.
--                                              already pulled)
--   4. Tables with a   ponum / pchnum /
--      pordnm / pchord / ordnum /
--      wrknum / wrkord / srvnum / srvord /
--      chgnum / chgord / cornum /
--      schnum / schord column              — PO / WO / SO / CO-linked
--   5. Columns for every table surfaced in #1-#4
--   6. Row counts for every table surfaced in #1-#4
--   7. SQL Server version + database name + connected user + timestamp
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
--     If dbo.employ / dbo.payrec / dbo.actrec don't exist in the
--     current database, the rest of the script will return nothing
--     useful. Abort loudly instead.
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
-- 1. Candidate tables by NAME pattern
-- ---------------------------------------------------------------------
PRINT '--- 1. Candidate tables by name pattern ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name
FROM sys.tables t
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND (
       t.name LIKE 'srv%'
    OR t.name LIKE 'pch%'
    OR t.name LIKE 'pur%'
    OR t.name LIKE 'pord%'
    OR t.name LIKE 'po[_]%'
    OR t.name LIKE 'chg%'
    OR t.name LIKE 'cor%'
    OR t.name LIKE 'wrk%'
    OR t.name LIKE 'wo[_]%'
    OR t.name LIKE 'dsp%'
    OR t.name LIKE 'dsptch%'
    OR t.name LIKE 'bill%'
    OR t.name LIKE 'billng%'
    OR t.name LIKE 'bll%'
    OR t.name LIKE 'acrlin%'
    OR t.name LIKE 'acrdet%'
    OR t.name LIKE 'acrpmt%'
    OR t.name LIKE 'acrinv%'
    OR t.name LIKE 'acrcsh%'
    OR t.name LIKE 'acrapl%'
    OR t.name LIKE 'acplin%'
    OR t.name LIKE 'acpdet%'
    OR t.name LIKE 'acppmt%'
    OR t.name LIKE 'acpinv%'
    OR t.name LIKE 'acpchk%'
    OR t.name LIKE 'acpapl%'
    OR t.name LIKE 'phs%'
    OR t.name LIKE 'ord%'
    OR t.name LIKE 'schdl%'
    OR t.name LIKE 'schd%'
    OR t.name LIKE 'prog%'
    OR t.name LIKE 'prgbill%'
    OR t.name LIKE 'reccln%'
  )
ORDER BY t.name;


-- ---------------------------------------------------------------------
-- 2. Tables with an invnum column (invoice child tables)
-- ---------------------------------------------------------------------
PRINT '--- 2. Tables with an invnum column (invoice-linked) ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name,
    c.name                    AS linking_column,
    tp.name                   AS linking_column_type
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   tp ON tp.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND c.name = 'invnum'
ORDER BY t.name;


-- ---------------------------------------------------------------------
-- 3. Tables with a jobnum column (job-linked, broader)
--    Some of these are already covered by sage_queries.py (jobcst,
--    acrinv, acpinv, bdglin, coresp). The ones that aren't — e.g.
--    service invoices, PO headers, WO headers — are what we want
--    to add.
-- ---------------------------------------------------------------------
PRINT '--- 3. Tables with a jobnum column ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name,
    c.name                    AS linking_column,
    tp.name                   AS linking_column_type
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   tp ON tp.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND c.name = 'jobnum'
ORDER BY t.name;


-- ---------------------------------------------------------------------
-- 4. Tables with PO / WO / SO / CO linking columns
--    These are the child-table indicators for each order family.
--    Names here are best-guess based on Sage's 6-char convention;
--    the query casts a wide net and returns only the ones that
--    actually exist.
-- ---------------------------------------------------------------------
PRINT '--- 4. Tables with PO/WO/SO/CO linking columns ---';

SELECT
    SCHEMA_NAME(t.schema_id) AS [schema],
    t.name                    AS table_name,
    c.name                    AS linking_column,
    tp.name                   AS linking_column_type
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types   tp ON tp.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
  AND c.name IN (
       -- Purchase orders
       'ponum','pchnum','pordnm','pchord','ordnum','purord','purnum',
       -- Work orders
       'wrknum','wrkord','wonum','wrkrec',
       -- Service orders / invoices
       'srvnum','srvord','srvinv','srvrec',
       -- Change orders
       'chgnum','chgord','cornum','conum',
       -- Schedules / dispatch
       'schnum','schord','dspnum','dsptch'
  )
ORDER BY t.name, c.name;


-- ---------------------------------------------------------------------
-- 5. Column lists for every table surfaced in 1-4
-- ---------------------------------------------------------------------
PRINT '--- 5. Columns for every surfaced table ---';

WITH surfaced_tables AS (
    SELECT t.object_id, t.name
    FROM sys.tables t
    WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
      AND (
            -- has an invoice / PO / WO / SO / CO linking column
            EXISTS (SELECT 1 FROM sys.columns c
                    WHERE c.object_id = t.object_id
                      AND c.name IN (
                           'invnum',
                           'ponum','pchnum','pordnm','pchord','ordnum','purord','purnum',
                           'wrknum','wrkord','wonum','wrkrec',
                           'srvnum','srvord','srvinv','srvrec',
                           'chgnum','chgord','cornum','conum',
                           'schnum','schord','dspnum','dsptch'
                      ))
            -- or matches one of the NAME patterns in result set #1
            OR t.name LIKE 'srv%'
            OR t.name LIKE 'pch%'
            OR t.name LIKE 'pur%'
            OR t.name LIKE 'pord%'
            OR t.name LIKE 'po[_]%'
            OR t.name LIKE 'chg%'
            OR t.name LIKE 'cor%'
            OR t.name LIKE 'wrk%'
            OR t.name LIKE 'wo[_]%'
            OR t.name LIKE 'dsp%'
            OR t.name LIKE 'dsptch%'
            OR t.name LIKE 'bill%'
            OR t.name LIKE 'billng%'
            OR t.name LIKE 'bll%'
            OR t.name LIKE 'acrlin%'
            OR t.name LIKE 'acrdet%'
            OR t.name LIKE 'acrpmt%'
            OR t.name LIKE 'acrinv%'
            OR t.name LIKE 'acrcsh%'
            OR t.name LIKE 'acrapl%'
            OR t.name LIKE 'acplin%'
            OR t.name LIKE 'acpdet%'
            OR t.name LIKE 'acppmt%'
            OR t.name LIKE 'acpinv%'
            OR t.name LIKE 'acpchk%'
            OR t.name LIKE 'acpapl%'
            OR t.name LIKE 'phs%'
            OR t.name LIKE 'ord%'
            OR t.name LIKE 'schdl%'
            OR t.name LIKE 'schd%'
            OR t.name LIKE 'prog%'
            OR t.name LIKE 'prgbill%'
            OR t.name LIKE 'reccln%'
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
-- ---------------------------------------------------------------------
PRINT '--- 6. Approximate row counts for every surfaced table ---';

WITH surfaced_tables AS (
    SELECT t.object_id, t.name
    FROM sys.tables t
    WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
      AND (
            EXISTS (SELECT 1 FROM sys.columns c
                    WHERE c.object_id = t.object_id
                      AND c.name IN (
                           'invnum',
                           'ponum','pchnum','pordnm','pchord','ordnum','purord','purnum',
                           'wrknum','wrkord','wonum','wrkrec',
                           'srvnum','srvord','srvinv','srvrec',
                           'chgnum','chgord','cornum','conum',
                           'schnum','schord','dspnum','dsptch'
                      ))
            OR t.name LIKE 'srv%'
            OR t.name LIKE 'pch%'
            OR t.name LIKE 'pur%'
            OR t.name LIKE 'pord%'
            OR t.name LIKE 'po[_]%'
            OR t.name LIKE 'chg%'
            OR t.name LIKE 'cor%'
            OR t.name LIKE 'wrk%'
            OR t.name LIKE 'wo[_]%'
            OR t.name LIKE 'dsp%'
            OR t.name LIKE 'dsptch%'
            OR t.name LIKE 'bill%'
            OR t.name LIKE 'billng%'
            OR t.name LIKE 'bll%'
            OR t.name LIKE 'acrlin%'
            OR t.name LIKE 'acrdet%'
            OR t.name LIKE 'acrpmt%'
            OR t.name LIKE 'acrinv%'
            OR t.name LIKE 'acrcsh%'
            OR t.name LIKE 'acrapl%'
            OR t.name LIKE 'acplin%'
            OR t.name LIKE 'acpdet%'
            OR t.name LIKE 'acppmt%'
            OR t.name LIKE 'acpinv%'
            OR t.name LIKE 'acpchk%'
            OR t.name LIKE 'acpapl%'
            OR t.name LIKE 'phs%'
            OR t.name LIKE 'ord%'
            OR t.name LIKE 'schdl%'
            OR t.name LIKE 'schd%'
            OR t.name LIKE 'prog%'
            OR t.name LIKE 'prgbill%'
            OR t.name LIKE 'reccln%'
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
-- 7. Environment info
-- ---------------------------------------------------------------------
PRINT '--- 7. Environment info ---';

SELECT
    @@VERSION        AS sql_server_version,
    DB_NAME()        AS database_name,
    SUSER_SNAME()    AS connected_as,
    GETDATE()        AS run_at_local;

-- =====================================================================
-- End of discover_service_po_tables.sql
-- =====================================================================
