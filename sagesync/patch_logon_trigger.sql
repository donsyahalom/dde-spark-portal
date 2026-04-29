-- ============================================================
--  patch_logon_trigger.sql
--  ------------------------------------------------------------
--  Sage 100 Contractor installs a server-level LOGON trigger
--  called [SageApplicationsOnly] that rejects any connection
--  not coming from a Sage application. It raises error 17892 /
--  Sage error 50004 for plain SQL logins (like sage_reader)
--  even after db_datareader has been granted.
--
--  This script REPLACES that trigger with a version that has
--  one extra early-return clause: if the connecting login is
--  'sage_reader', the trigger returns before running any of the
--  Sage app-name checks. Everything else (all existing Sage
--  rules, sa bypass, sysadmin bypass, SSMS, Profiler, Report
--  Server) is preserved byte-for-byte.
--
--  BEFORE RUNNING:
--    1. You must be connected to DEMA-SAGE\SAGE100CON as a
--       sysadmin (Windows auth).
--    2. Save the current trigger body somewhere (just in case)
--       with:
--           SELECT definition FROM sys.server_sql_modules
--           WHERE object_id = OBJECT_ID('SageApplicationsOnly');
--
--  AFTER RUNNING:
--    - Test with:  File > Connect > Database Engine, using
--      SQL auth as sage_reader. You should get a successful
--      connection instead of error 17892.
--    - Re-test the ODBC DSN "Sage100Con" in ODBC Data Sources
--      (64-bit).
--
--  IMPORTANT: Sage patches and upgrades may regenerate this
--  trigger. If that happens you'll need to re-run this script.
-- ============================================================

USE [master];
GO

CREATE OR ALTER TRIGGER [SageApplicationsOnly] ON ALL SERVER
FOR LOGON
AS
BEGIN
    IF (ORIGINAL_LOGIN() = N'sa') RETURN; -- sa can always connect
    IF (SUSER_SNAME()    = N'sa') RETURN; -- sa can always connect

    -- === Addition: allow Sage -> Supabase sync reader ===========
    -- sage_reader is a dedicated read-only SQL login used by the
    -- nightly/weekly sync script. It has db_datareader on the
    -- DuBaldo Electric database and nothing else.
    IF (ORIGINAL_LOGIN() = N'sage_reader') RETURN;
    -- === end addition ============================================

    DECLARE @msg      nvarchar(max) = N'';
    DECLARE @AppName  sysname = APP_NAME();
    DECLARE @HostName sysname = HOST_NAME();
    DECLARE @pos      int     = CHARINDEX(N'¦', @HostName, 1);
    DECLARE @Login    sysname = SUSER_SNAME();

    IF (@pos > 0)
        SET @HostName = LEFT(@HostName, @pos - 1);

    -- sysadmins can always connect, except via SSMS (which has
    -- its own branch below so non-sysadmins never use SSMS).
    IF (EXISTS(
            SELECT *
            FROM   sys.server_principals     [logins]
            JOIN   sys.server_role_members
                    ON sys.server_role_members.member_principal_id = [logins].[principal_id]
            JOIN   sys.server_principals     [roles]
                    ON [roles].[principal_id] = sys.server_role_members.role_principal_id
            WHERE  [logins].[name] = SUSER_SNAME()
              AND  [roles].[name]  = N'sysadmin'
        ))
        AND (@AppName NOT LIKE 'Microsoft SQL Server Management Studio%')
        RETURN;

    -- Sage 100 Contractor Server Applications
    IF (@AppName LIKE N'Sage.100.Contractor.%') RETURN;

    -- Sage 100 Contractor (desktop)
    IF (@AppName LIKE N'Sage100Contractor¦%') RETURN;

    -- SSMS, only for sysadmins
    IF (@AppName LIKE N'Microsoft SQL Server Management Studio%')
        IF (EXISTS(
                SELECT *
                FROM   sys.server_principals     [logins]
                JOIN   sys.server_role_members
                        ON sys.server_role_members.member_principal_id = [logins].[principal_id]
                JOIN   sys.server_principals     [roles]
                        ON [roles].[principal_id] = sys.server_role_members.role_principal_id
                WHERE  [logins].[name] = SUSER_SNAME()
                  AND  [roles].[name]  = N'sysadmin'
            ))
            RETURN;

    -- SQL Server Profiler
    IF (@AppName LIKE N'SQL Server Profiler%') RETURN;

    -- Reporting Services (specific service account + host)
    IF (@AppName LIKE N'Report Server')
        IF (ORIGINAL_LOGIN() IN (N'NT SERVICE\ReportServer$SAGE100CON'))
            IF (@HostName IN (N'DEMA-SAGE'))
                RETURN;

    -- Not on any whitelist: reject.
    SET @msg = N'SAGE ERROR 50004: The application ''' + @AppName
             + N''' is not allowed to connect to this server. Host: '
             + @HostName + N'   User: ' + @Login;
    RAISERROR (@msg, 20, 1) WITH LOG;
    ROLLBACK;
END
GO

PRINT 'Trigger [SageApplicationsOnly] replaced. sage_reader can now connect.';
