-- =====================================================================
-- Supabase / Postgres schema for Sage 100 Contractor v27 daily sync
-- =====================================================================
-- Rewritten to match the actual v27 SQL Server schema (legacy 6-char
-- table names, recnum surrogate keys).
--
-- Run this once in the Supabase SQL editor. Safe to re-run — everything
-- uses IF NOT EXISTS.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS sage;

-- -----------------------------------------------------------------
-- 1. GENERAL LEDGER
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sage.gl_accounts (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,   -- Sage account number (e.g. 1050)
    short_name           TEXT,
    long_name            TEXT,
    account_type         SMALLINT,               -- 1=Asset 2=Liability 3=Equity 4=Income 5=Expense
    cost_type            SMALLINT,
    current_balance      NUMERIC(18,2),
    begin_balance        NUMERIC(18,2),
    start_balance        NUMERIC(18,2),
    is_subaccount        BOOLEAN,
    parent_account       BIGINT,
    is_active            BOOLEAN,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.gl_subaccounts (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    control_account      BIGINT,                 -- references gl_accounts.recnum
    short_name           TEXT,
    long_name            TEXT,
    current_balance      NUMERIC(18,2),
    begin_balance        NUMERIC(18,2),
    is_active            BOOLEAN,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.gl_transactions (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    trans_number         TEXT,
    trans_date           DATE,
    acct_period          SMALLINT,
    post_year            SMALLINT,
    source_code          SMALLINT,               -- 1=AP 2=AR 3=PR 4=GL etc
    status               SMALLINT,
    description          TEXT,
    purchase_order       TEXT,
    vendor_recnum        BIGINT,
    employee_recnum      BIGINT,
    payee1               TEXT,
    payee2               TEXT,
    check_amount         NUMERIC(18,2),
    entered_date         DATE,
    entered_by           TEXT,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE INDEX IF NOT EXISTS idx_gl_tx_date   ON sage.gl_transactions (trans_date);
CREATE INDEX IF NOT EXISTS idx_gl_tx_source ON sage.gl_transactions (source_code);

-- -----------------------------------------------------------------
-- 2. PAYROLL
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sage.employees (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    first_name           TEXT,
    last_name            TEXT,
    middle_initial       TEXT,
    full_name            TEXT,                    -- employ.fullst
    status               SMALLINT,
    is_active            BOOLEAN,
    emp_type             SMALLINT,
    pay_period           SMALLINT,
    pay_group            INTEGER,
    salary               NUMERIC(12,2),
    pay_rate1            NUMERIC(12,4),
    pay_rate2            NUMERIC(12,4),
    pay_rate3            NUMERIC(12,4),
    hire_date            DATE,
    inactive_date        DATE,
    first_work_date      DATE,
    last_raise_date      DATE,
    birth_date           DATE,
    tax_state            TEXT,
    email                TEXT,
    phone                TEXT,
    cell_phone           TEXT,
    address1             TEXT,
    address2             TEXT,
    city                 TEXT,
    state                TEXT,
    zip                  TEXT,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.payroll_records (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    employee_recnum      BIGINT,
    period_start         DATE,
    period_end           DATE,
    check_date           DATE,
    check_number         TEXT,
    pay_type             SMALLINT,
    status               SMALLINT,
    quarter              SMALLINT,
    regular_hours        NUMERIC(10,2),
    overtime_hours       NUMERIC(10,2),
    premium_hours        NUMERIC(10,2),
    sick_hours           NUMERIC(10,2),
    vacation_hours       NUMERIC(10,2),
    holiday_hours        NUMERIC(10,2),
    total_hours          NUMERIC(10,2),
    regular_pay          NUMERIC(14,2),
    overtime_pay         NUMERIC(14,2),
    premium_pay          NUMERIC(14,2),
    sick_pay             NUMERIC(14,2),
    vacation_pay         NUMERIC(14,2),
    holiday_pay          NUMERIC(14,2),
    miscellaneous_pay    NUMERIC(14,2),
    gross_pay            NUMERIC(14,2),
    deductions_total     NUMERIC(14,2),
    additions_total      NUMERIC(14,2),
    net_pay              NUMERIC(14,2),
    ytd_gross            NUMERIC(14,2),
    ytd_net              NUMERIC(14,2),
    tax_state            TEXT,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE INDEX IF NOT EXISTS idx_pr_check_date ON sage.payroll_records (check_date);
CREATE INDEX IF NOT EXISTS idx_pr_employee   ON sage.payroll_records (employee_recnum);

-- -----------------------------------------------------------------
-- 3. ACCOUNTS RECEIVABLE / PAYABLE
-- -----------------------------------------------------------------
-- NOTE: Sage 100 Contractor v27 has no separate "clients" master table.
-- Each job (actrec) carries its own contact/address info and references
-- a client via clnnum. See the sage.jobs table below.

CREATE TABLE IF NOT EXISTS sage.vendors (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    vendor_name          TEXT,
    short_name           TEXT,
    owner_name           TEXT,
    address1             TEXT,
    address2             TEXT,
    city                 TEXT,
    state                TEXT,
    zip                  TEXT,
    phone                TEXT,
    fax                  TEXT,
    cell_phone           TEXT,
    email                TEXT,
    fed_id               TEXT,
    state_id             TEXT,
    vendor_type          SMALLINT,
    begin_balance        NUMERIC(18,2),
    end_balance          NUMERIC(18,2),
    is_active            BOOLEAN,
    is_hotlist           BOOLEAN,
    print_1099           BOOLEAN,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.ar_invoices (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    invoice_number       TEXT,
    job_recnum           BIGINT,
    phase_recnum         BIGINT,
    invoice_date         DATE,
    due_date             DATE,
    discount_date        DATE,
    invoice_type         SMALLINT,
    status               SMALLINT,
    description          TEXT,
    invoice_total        NUMERIC(18,2),
    invoice_balance      NUMERIC(18,2),
    invoice_net          NUMERIC(18,2),
    amount_paid          NUMERIC(18,2),
    total_paid           NUMERIC(18,2),
    retainage            NUMERIC(18,2),
    sales_tax            NUMERIC(18,2),
    hold_amount          NUMERIC(18,2),
    -- aging buckets (computed at sync time)
    bucket_current       NUMERIC(18,2) DEFAULT 0,
    bucket_1_30          NUMERIC(18,2) DEFAULT 0,
    bucket_31_60         NUMERIC(18,2) DEFAULT 0,
    bucket_61_90         NUMERIC(18,2) DEFAULT 0,
    bucket_over_90       NUMERIC(18,2) DEFAULT 0,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.ap_invoices (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    invoice_number       TEXT,
    vendor_recnum        BIGINT,
    job_recnum           BIGINT,
    phase_recnum         BIGINT,
    invoice_date         DATE,
    due_date             DATE,
    discount_date        DATE,
    invoice_type         SMALLINT,
    status               SMALLINT,
    description          TEXT,
    invoice_total        NUMERIC(18,2),
    invoice_balance      NUMERIC(18,2),
    invoice_net          NUMERIC(18,2),
    amount_paid          NUMERIC(18,2),
    total_paid           NUMERIC(18,2),
    retainage            NUMERIC(18,2),
    sales_tax            NUMERIC(18,2),
    hold_amount          NUMERIC(18,2),
    bucket_current       NUMERIC(18,2) DEFAULT 0,
    bucket_1_30          NUMERIC(18,2) DEFAULT 0,
    bucket_31_60         NUMERIC(18,2) DEFAULT 0,
    bucket_61_90         NUMERIC(18,2) DEFAULT 0,
    bucket_over_90       NUMERIC(18,2) DEFAULT 0,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE INDEX IF NOT EXISTS idx_ar_inv_date ON sage.ar_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_ar_inv_job  ON sage.ar_invoices (job_recnum);
CREATE INDEX IF NOT EXISTS idx_ap_inv_date ON sage.ap_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_ap_inv_vnd  ON sage.ap_invoices (vendor_recnum);

-- -----------------------------------------------------------------
-- 4. JOBS / JOB COST
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sage.jobs (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    job_name             TEXT,
    short_name           TEXT,                   -- often the user-facing job #
    client_number        BIGINT,
    contact              TEXT,
    address1             TEXT,
    address2             TEXT,
    city                 TEXT,
    state                TEXT,
    zip                  TEXT,
    county               TEXT,
    phone                TEXT,
    fax                  TEXT,
    status               SMALLINT,
    job_type             SMALLINT,
    contract_amount      NUMERIC(18,2),
    retainage            NUMERIC(18,2),
    finance_charge       NUMERIC(18,2),
    begin_balance        NUMERIC(18,2),
    end_balance          NUMERIC(18,2),
    bid_date             DATE,
    contract_date        DATE,
    start_date           DATE,
    complete_date        DATE,
    awarded_date         DATE,
    actual_start_date    DATE,
    actual_complete_date DATE,
    percent_complete     INTEGER,
    type_of_work         TEXT,
    is_active            BOOLEAN,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.job_cost_transactions (
    source_company       TEXT        NOT NULL,
    recnum               BIGINT      NOT NULL,
    job_recnum           BIGINT,
    phase_recnum         BIGINT,
    cost_code            NUMERIC(12,4),
    cost_type            SMALLINT,            -- 1=Mat 2=Lab 3=Eqp 4=Sub 5=Oth (per Sage)
    vendor_recnum        BIGINT,
    equipment_recnum     BIGINT,
    employee_recnum      BIGINT,
    payroll_recnum       BIGINT,
    ar_invoice_recnum    BIGINT,
    trans_number         TEXT,
    trans_date           DATE,
    entered_date         DATE,
    acct_period          SMALLINT,
    post_year            SMALLINT,
    source_code          SMALLINT,
    status               SMALLINT,
    billing_status       SMALLINT,
    description          TEXT,
    hours                NUMERIC(10,2),
    cost_amount          NUMERIC(18,2),
    billing_amount       NUMERIC(18,2),
    billing_quantity     NUMERIC(18,2),
    billing_total        NUMERIC(18,2),
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE INDEX IF NOT EXISTS idx_jct_job       ON sage.job_cost_transactions (job_recnum);
CREATE INDEX IF NOT EXISTS idx_jct_date      ON sage.job_cost_transactions (trans_date);
CREATE INDEX IF NOT EXISTS idx_jct_cost_type ON sage.job_cost_transactions (cost_type);

-- Budget lines — "wide" layout matching Sage's bdglin (one row per
-- job/phase/cost-code with separate columns per cost type).
CREATE TABLE IF NOT EXISTS sage.job_budget_lines (
    source_company       TEXT        NOT NULL,
    job_recnum           BIGINT      NOT NULL,    -- bdglin.recnum = job id
    phase_recnum         BIGINT      NOT NULL,
    line_number          INTEGER     NOT NULL,
    cost_code            NUMERIC(12,4),
    hours_budget         NUMERIC(18,2),
    material_budget      NUMERIC(18,2),
    labor_budget         NUMERIC(18,2),
    equipment_budget     NUMERIC(18,2),
    subcontract_budget   NUMERIC(18,2),
    other_budget         NUMERIC(18,2),
    total_budget         NUMERIC(18,2),
    hours_original       NUMERIC(18,2),
    material_original    NUMERIC(18,2),
    labor_original       NUMERIC(18,2),
    equipment_original   NUMERIC(18,2),
    subcontract_original NUMERIC(18,2),
    other_original       NUMERIC(18,2),
    total_original       NUMERIC(18,2),
    unit_description     TEXT,
    estimated_units      NUMERIC(18,4),
    unit_cost            NUMERIC(18,4),
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, job_recnum, phase_recnum, line_number)
);

CREATE INDEX IF NOT EXISTS idx_jbl_job ON sage.job_budget_lines (job_recnum);

-- -----------------------------------------------------------------
-- 5. SYNC LOG
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sage.sync_runs (
    id                     BIGSERIAL PRIMARY KEY,
    source_company         TEXT,
    started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at            TIMESTAMPTZ,
    status                 TEXT,
    rows_gl_accounts       INTEGER DEFAULT 0,
    rows_gl_subaccounts    INTEGER DEFAULT 0,
    rows_gl_transactions   INTEGER DEFAULT 0,
    rows_employees         INTEGER DEFAULT 0,
    rows_payroll           INTEGER DEFAULT 0,
    rows_vendors           INTEGER DEFAULT 0,
    rows_ar_invoices       INTEGER DEFAULT 0,
    rows_ap_invoices       INTEGER DEFAULT 0,
    rows_jobs              INTEGER DEFAULT 0,
    rows_job_cost_tx       INTEGER DEFAULT 0,
    rows_job_budget_lines  INTEGER DEFAULT 0,
    error_message          TEXT
);

-- ==========================================================================
--  Permissions
--  ------------------------------------------------------------------------
--  Supabase's API roles do not automatically get access to non-public
--  schemas. Without these grants the service_role key gets a
--  "permission denied for schema sage" (SQLSTATE 42501) from PostgREST.
-- ==========================================================================

GRANT USAGE ON SCHEMA sage TO service_role, authenticated, anon;

GRANT ALL ON ALL TABLES    IN SCHEMA sage TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA sage TO service_role;

-- Apply the same rights to anything we create later in this schema.
ALTER DEFAULT PRIVILEGES IN SCHEMA sage
    GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sage
    GRANT ALL ON SEQUENCES TO service_role;
