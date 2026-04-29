-- ============================================================
--  grant_sage_reader.sql
--  ------------------------------------------------------------
--  Creates OR resets the `sage_reader` SQL login used by the
--  Sage -> Supabase sync, and grants it read-only access to the
--  DuBaldo company database.
--
--  Safe to re-run. If the login already exists it will be
--  repointed at the new password you set in @new_password below.
--
--  Run in SSMS:
--    1. Connect as Windows auth with sysadmin rights to
--       DEMA-SAGE\SAGE100CON.
--    2. Edit @new_password below to a strong password.
--    3. Execute (F5). The smoke test at the bottom must return a
--       row — if it errors, the grants didn't stick.
--    4. Put the same password in .env as SAGE_ODBC_PASSWORD.
-- ============================================================

DECLARE @new_password NVARCHAR(128) = N'<<PUT-STRONG-PASSWORD-HERE>>';

IF @new_password = N'<<PUT-STRONG-PASSWORD-HERE>>'
BEGIN
    RAISERROR('Edit @new_password at the top of this script before running.', 16, 1);
    RETURN;
END;

--------------------------------------------------------------
-- 1. Create OR alter the server-level SQL login.
--    CHECK_POLICY=OFF keeps Windows password policy from
--    expiring / locking out the automation account.
--------------------------------------------------------------
USE [master];

IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'sage_reader')
BEGIN
    DECLARE @create_sql NVARCHAR(MAX) =
        N'CREATE LOGIN [sage_reader] WITH PASSWORD = N''' +
        REPLACE(@new_password, N'''', N'''''') +
        N''', CHECK_POLICY = OFF, DEFAULT_DATABASE = [DuBaldo Electric 4.15.22];';
    EXEC (@create_sql);
    PRINT 'Login [sage_reader] CREATED.';
END
ELSE
BEGIN
    DECLARE @alter_sql NVARCHAR(MAX) =
        N'ALTER LOGIN [sage_reader] WITH PASSWORD = N''' +
        REPLACE(@new_password, N'''', N'''''') +
        N''', CHECK_POLICY = OFF;';
    EXEC (@alter_sql);
    PRINT 'Login [sage_reader] password RESET.';
END;
GO

--------------------------------------------------------------
-- 2. Map the login into the company database as a user and
--    grant read-only access.
--------------------------------------------------------------
USE [DuBaldo Electric 4.15.22];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sage_reader')
BEGIN
    CREATE USER [sage_reader] FOR LOGIN [sage_reader];
    PRINT 'User [sage_reader] created in [DuBaldo Electric 4.15.22].';
END
ELSE
BEGIN
    PRINT 'User [sage_reader] already present in [DuBaldo Electric 4.15.22].';
END;

ALTER ROLE [db_datareader] ADD MEMBER [sage_reader];

-- Belt-and-braces: explicitly DENY writes, in case something
-- else grants them later. Read-only means read-only.
DENY INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::dbo TO [sage_reader];
GO

--------------------------------------------------------------
-- 3. Smoke test — confirm the login can read a table we
--    actually query. actrec is the jobs master.
--------------------------------------------------------------
EXECUTE AS LOGIN = 'sage_reader';
SELECT TOP 3 recnum AS jobnum, jobnme, status FROM dbo.actrec;
REVERT;
GO

PRINT '---';
PRINT 'Done. Copy the password you just set into SAGE_ODBC_PASSWORD in .env.';
