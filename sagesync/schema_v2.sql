-- =====================================================================
-- Supabase / Postgres schema — v2 additions
-- =====================================================================
-- Layered ON TOP of schema.sql. Adds the payroll-detail, service,
-- purchase-order, and change-order tables under the existing `sage`
-- schema. Safe to re-run — every CREATE uses IF NOT EXISTS.
--
-- Run this once in the Supabase SQL editor AFTER schema.sql.
-- =====================================================================

-- Schema is created by schema.sql; this is a no-op if it already exists.
CREATE SCHEMA IF NOT EXISTS sage;

-- =====================================================================
--  PAYROLL DETAIL  (Timecard module — daily grain)
-- =====================================================================

CREATE TABLE IF NOT EXISTS sage.timecard_lines (
    source_company       TEXT          NOT NULL,
    recnum               BIGINT        NOT NULL,
    line_number          SMALLINT      NOT NULL,
    work_date            DATE,
    day_of_week          TEXT,
    description          TEXT,
    work_order           TEXT,
    job_recnum           BIGINT,
    equipment_recnum     BIGINT,
    phase_recnum         BIGINT,
    cost_code            NUMERIC(15,3),
    pay_type             SMALLINT,
    pay_group            INTEGER,
    pay_rate             NUMERIC(12,4),
    hours_worked         NUMERIC(10,2),
    piece_rate           NUMERIC(12,4),
    pieces               NUMERIC(14,2),
    comp_code            INTEGER,
    department           BIGINT,
    job_cost             NUMERIC(14,2),
    comp_subject         NUMERIC(14,2),
    benefit_subject      NUMERIC(14,2),
    comp_wage            NUMERIC(14,2),
    comp_gross           NUMERIC(14,2),
    absence              SMALLINT,
    ot_differential      NUMERIC(14,2),
    local_tax            INTEGER,
    certified_payroll    TEXT,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, line_number)
);
CREATE INDEX IF NOT EXISTS idx_tmc_date  ON sage.timecard_lines (work_date);
CREATE INDEX IF NOT EXISTS idx_tmc_job   ON sage.timecard_lines (job_recnum);
CREATE INDEX IF NOT EXISTS idx_tmc_phase ON sage.timecard_lines (job_recnum, phase_recnum);

CREATE TABLE IF NOT EXISTS sage.timecard_deductions (
    source_company   TEXT     NOT NULL,
    recnum           BIGINT   NOT NULL,            -- = payrec.recnum
    calc_number      INTEGER  NOT NULL,
    amount           NUMERIC(14,2),
    override         SMALLINT,
    state_wage       NUMERIC(14,2),
    state_gross      NUMERIC(14,2),
    ytd_amount       NUMERIC(14,2),
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, calc_number)
);

CREATE TABLE IF NOT EXISTS sage.timecard_benefits (
    source_company    TEXT     NOT NULL,
    recnum            BIGINT   NOT NULL,
    group_number      INTEGER  NOT NULL,
    deduction_number  INTEGER  NOT NULL,
    deduction_name    TEXT,
    deduction_rate    NUMERIC(12,4),
    offset_amount     NUMERIC(14,2),
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, group_number, deduction_number)
);

CREATE TABLE IF NOT EXISTS sage.timecard_wc (
    source_company       TEXT     NOT NULL,
    recnum               BIGINT   NOT NULL,
    code_number          INTEGER  NOT NULL,
    code_name            TEXT,
    tax_state            TEXT,
    percent_rate         NUMERIC(8,4),
    employee_hours       NUMERIC(10,2),
    employer_hours       NUMERIC(10,2),
    liability_insurance  NUMERIC(14,2),
    experience_mod       NUMERIC(8,4),
    additional_mod       NUMERIC(8,4),
    max_wage             NUMERIC(14,2),
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, code_number)
);

CREATE TABLE IF NOT EXISTS sage.timecard_paygroups (
    source_company   TEXT     NOT NULL,
    recnum           BIGINT   NOT NULL,
    group_number     INTEGER  NOT NULL,
    group_name       TEXT,
    work_class       TEXT,
    class_level      SMALLINT,
    class_percent    NUMERIC(8,4),
    class_code       TEXT,
    pay_rate1        NUMERIC(12,4),
    pay_rate2        NUMERIC(12,4),
    pay_rate3        NUMERIC(12,4),
    piece_rate       NUMERIC(12,4),
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, group_number)
);

-- ---- payroll masters (small, full refresh each run) ----------------

CREATE TABLE IF NOT EXISTS sage.paytypes (
    source_company TEXT NOT NULL,
    recnum         SMALLINT NOT NULL,
    type_name      TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.paygroups (
    source_company TEXT    NOT NULL,
    recnum         INTEGER NOT NULL,
    group_name     TEXT,
    work_class     TEXT,
    class_level    SMALLINT,
    description    TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.paydeductions (
    source_company       TEXT    NOT NULL,
    recnum               INTEGER NOT NULL,
    calc_name            TEXT,
    default_rate         NUMERIC(12,4),
    default_max          NUMERIC(14,2),
    social_security_tax  SMALLINT,
    medicare_tax         SMALLINT,
    federal_tax          SMALLINT,
    state_tax            SMALLINT,
    workers_comp         SMALLINT,
    liability_insurance  SMALLINT,
    local_tax            SMALLINT,
    benefit_type         SMALLINT,
    sick_eligible        SMALLINT,
    sick_max             NUMERIC(10,2),
    sick_carryover       NUMERIC(10,2),
    sick_accrual_method  SMALLINT,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.payunions (
    source_company TEXT NOT NULL,
    recnum         INTEGER NOT NULL,
    union_name     TEXT,
    description    TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.benefits (
    source_company    TEXT NOT NULL,
    recnum            BIGINT NOT NULL,
    employee_recnum   BIGINT,
    group_number      INTEGER,
    deduction_number  INTEGER,
    effective_date    DATE,
    expiry_date       DATE,
    active_amount     NUMERIC(14,2),
    active_rate       NUMERIC(12,4),
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_benefits_emp ON sage.benefits (employee_recnum);

CREATE TABLE IF NOT EXISTS sage.costcodes (
    source_company    TEXT NOT NULL,
    recnum            NUMERIC(15,3) NOT NULL,   -- hierarchical, NOT bigint
    short_name        TEXT,
    code_name         TEXT,
    cost_type         SMALLINT,
    unit_description  TEXT,
    is_active         BOOLEAN,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.empabsence (
    source_company TEXT NOT NULL,
    recnum         SMALLINT NOT NULL,
    absence_name   TEXT,
    description    TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.employee_pay (
    source_company   TEXT NOT NULL,
    recnum           BIGINT NOT NULL,
    employee_recnum  BIGINT,
    pay_rate         NUMERIC(12,4),
    effective_date   DATE,
    pay_period       SMALLINT,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_emppay_emp ON sage.employee_pay (employee_recnum);

CREATE TABLE IF NOT EXISTS sage.employee_qtd (
    source_company   TEXT NOT NULL,
    recnum           BIGINT NOT NULL,
    employee_recnum  BIGINT,
    quarter          SMALLINT,
    year             SMALLINT,
    calc_number      INTEGER,
    qtd_amount       NUMERIC(14,2),
    qtd_subject      NUMERIC(14,2),
    ytd_amount       NUMERIC(14,2),
    ytd_subject      NUMERIC(14,2),
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_empqtd_emp_year ON sage.employee_qtd (employee_recnum, year);

CREATE TABLE IF NOT EXISTS sage.employee_hires (
    source_company   TEXT NOT NULL,
    recnum           BIGINT NOT NULL,
    employee_recnum  BIGINT,
    hire_date        DATE,
    term_date        DATE,
    status_code      SMALLINT,
    notes            TEXT,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.employee_licenses (
    source_company   TEXT NOT NULL,
    recnum           BIGINT NOT NULL,
    employee_recnum  BIGINT,
    license_name     TEXT,
    license_number   TEXT,
    issue_date       DATE,
    expiry_date      DATE,
    notes            TEXT,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_emplic_expiry ON sage.employee_licenses (expiry_date);

-- =====================================================================
--  SERVICE RECEIVABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS sage.service_invoices (
    source_company         TEXT NOT NULL,
    recnum                 BIGINT NOT NULL,
    service_order_number   TEXT,
    invoice_number         TEXT,
    client_recnum          BIGINT,
    job_recnum             BIGINT,
    location_recnum        BIGINT,
    employee_recnum        BIGINT,
    salesperson_recnum     BIGINT,
    service_geo            SMALLINT,
    route_number           SMALLINT,
    order_date             DATE,
    invoice_date           DATE,
    due_date               DATE,
    discount_date          DATE,
    call_date              DATE,
    dispatch_date          DATE,
    scheduled_date         DATE,
    started_date           DATE,
    finished_date          DATE,
    billed_date            DATE,
    scheduled_hours        NUMERIC(10,2),
    actual_hours           NUMERIC(10,2),
    description            TEXT,
    contact_name           TEXT,
    phone                  TEXT,
    address1               TEXT,
    address2               TEXT,
    city                   TEXT,
    state                  TEXT,
    zip                    TEXT,
    invoice_type           INTEGER,
    status                 SMALLINT,
    priority               SMALLINT,
    invoice_source         INTEGER,
    payment_type           SMALLINT,
    invoice_total          NUMERIC(18,2),
    invoice_balance        NUMERIC(18,2),
    invoice_net            NUMERIC(18,2),
    taxable                NUMERIC(18,2),
    non_taxable            NUMERIC(18,2),
    total_paid             NUMERIC(18,2),
    sales_tax              NUMERIC(18,2),
    deposit                NUMERIC(18,2),
    discount_available     NUMERIC(18,2),
    discount_taken         NUMERIC(18,2),
    acct_period            SMALLINT,
    post_year              SMALLINT,
    entered_date           DATE,
    entered_by             TEXT,
    -- aging buckets (computed at sync time, mirrors sage.ar_invoices)
    bucket_current         NUMERIC(18,2) DEFAULT 0,
    bucket_1_30            NUMERIC(18,2) DEFAULT 0,
    bucket_31_60           NUMERIC(18,2) DEFAULT 0,
    bucket_61_90           NUMERIC(18,2) DEFAULT 0,
    bucket_over_90         NUMERIC(18,2) DEFAULT 0,
    synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_srvinv_invdte  ON sage.service_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_srvinv_client  ON sage.service_invoices (client_recnum);
CREATE INDEX IF NOT EXISTS idx_srvinv_job     ON sage.service_invoices (job_recnum);
CREATE INDEX IF NOT EXISTS idx_srvinv_status  ON sage.service_invoices (status);

CREATE TABLE IF NOT EXISTS sage.service_invoice_lines (
    source_company       TEXT NOT NULL,
    recnum               BIGINT NOT NULL,
    line_number          INTEGER NOT NULL,
    assembly_recnum      BIGINT,
    part_recnum          BIGINT,
    description          TEXT,
    alpha_number         TEXT,
    unit_description     TEXT,
    part_quantity        NUMERIC(14,4),
    part_price           NUMERIC(14,6),
    extended_quantity    NUMERIC(14,4),
    extended_price       NUMERIC(18,2),
    ticket_number        TEXT,
    cost_type            SMALLINT,
    equipment_recnum     BIGINT,
    client_recnum        BIGINT,
    account_recnum       BIGINT,
    subaccount_recnum    BIGINT,
    inventory_location   INTEGER,
    current_billing      NUMERIC(18,2),
    gst_amount           NUMERIC(14,4),
    pst_amount           NUMERIC(14,4),
    hst_amount           NUMERIC(14,4),
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, line_number)
);
CREATE INDEX IF NOT EXISTS idx_srvlin_recnum ON sage.service_invoice_lines (recnum);

-- NB: srvpmt.recnum is the parent srvinv FK; a single invoice may
-- have many payment rows, so recnum is NOT unique. Sage's only
-- guaranteed-unique row id on this table is _idnum (uniqueidentifier),
-- which we mirror as payment_id (UUID) here.
CREATE TABLE IF NOT EXISTS sage.service_payments (
    source_company  TEXT NOT NULL,
    payment_id      UUID NOT NULL,
    recnum          BIGINT NOT NULL,
    description     TEXT,
    check_number    TEXT,
    check_date      DATE,
    acct_period     SMALLINT,
    post_year       SMALLINT,
    amount          NUMERIC(18,2),
    discount_taken  NUMERIC(18,2),
    applied_credit  NUMERIC(18,2),
    ledger_recnum   BIGINT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_srvpmt_chkdte ON sage.service_payments (check_date);
CREATE INDEX IF NOT EXISTS idx_srvpmt_recnum ON sage.service_payments (recnum);

CREATE TABLE IF NOT EXISTS sage.service_schedule (
    source_company         TEXT NOT NULL,
    recnum                 BIGINT NOT NULL,
    line_number            INTEGER NOT NULL,
    employee_recnum        BIGINT,
    equipment_recnum       BIGINT,
    vendor_recnum          BIGINT,
    priority               SMALLINT,
    scheduled_date         DATE,
    scheduled_start_time   TIME,
    scheduled_finish_time  TIME,
    estimated_hours        NUMERIC(10,2),
    travel_time            TEXT,
    finished_date          DATE,
    actual_start_time      TIME,
    actual_finish_time     TIME,
    actual_hours           NUMERIC(10,2),
    billed_date            DATE,
    synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, line_number)
);
CREATE INDEX IF NOT EXISTS idx_srvsch_date ON sage.service_schedule (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_srvsch_emp  ON sage.service_schedule (employee_recnum);

CREATE TABLE IF NOT EXISTS sage.service_clients (
    source_company           TEXT NOT NULL,
    recnum                   BIGINT NOT NULL,
    short_name               TEXT,
    client_name              TEXT,
    greeting                 TEXT,
    address1                 TEXT,
    address2                 TEXT,
    city                     TEXT,
    state                    TEXT,
    zip                      TEXT,
    billing_address1         TEXT,
    billing_address2         TEXT,
    billing_city             TEXT,
    billing_state            TEXT,
    billing_zip              TEXT,
    shipping_address1        TEXT,
    shipping_address2        TEXT,
    shipping_city            TEXT,
    shipping_state           TEXT,
    shipping_zip             TEXT,
    contact1                 TEXT,
    contact2                 TEXT,
    contact3                 TEXT,
    phone1                   TEXT,
    phone2                   TEXT,
    phone3                   TEXT,
    fax                      TEXT,
    cell_phone               TEXT,
    email                    TEXT,
    email2                   TEXT,
    email3                   TEXT,
    sales_employee_recnum    BIGINT,
    tax_district             INTEGER,
    last_service_date        DATE,
    service_contract_flag    SMALLINT,
    service_contract_expiry  DATE,
    client_type              SMALLINT,
    status                   SMALLINT,
    begin_balance            NUMERIC(18,2),
    end_balance              NUMERIC(18,2),
    is_active                BOOLEAN,
    synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_srvcln_active ON sage.service_clients (is_active);
CREATE INDEX IF NOT EXISTS idx_srvcln_expiry ON sage.service_clients (service_contract_expiry);

-- NB: in Sage, srvloc.recnum is the parent client FK and a single
-- client can own multiple locations, so the natural unique row is
-- (recnum, locnum). PK reflects that.
CREATE TABLE IF NOT EXISTS sage.service_locations (
    source_company   TEXT NOT NULL,
    recnum           BIGINT NOT NULL,
    location_number  BIGINT NOT NULL,
    location_name    TEXT,
    address1         TEXT,
    address2         TEXT,
    city             TEXT,
    state            TEXT,
    zip              TEXT,
    phone            TEXT,
    contact          TEXT,
    service_geo      SMALLINT,
    tax_district     INTEGER,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, location_number)
);
CREATE INDEX IF NOT EXISTS idx_srvloc_recnum ON sage.service_locations (recnum);

CREATE TABLE IF NOT EXISTS sage.service_types (
    source_company     TEXT NOT NULL,
    recnum             INTEGER NOT NULL,
    type_name          TEXT,
    type_color         TEXT,
    department_recnum  BIGINT,
    cost_code          NUMERIC(15,3),
    cost_type          SMALLINT,
    synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.service_geo (
    source_company TEXT NOT NULL,
    recnum         SMALLINT NOT NULL,
    description    TEXT,
    color          TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

-- =====================================================================
--  PURCHASE ORDERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS sage.purchase_orders (
    source_company       TEXT NOT NULL,
    recnum               BIGINT NOT NULL,
    order_number         TEXT,
    order_date           DATE,
    vendor_recnum        BIGINT,
    attention            TEXT,
    ordered_by_recnum    BIGINT,
    job_recnum           BIGINT,
    phase_recnum         BIGINT,
    equipment_recnum     BIGINT,
    description          TEXT,
    document_number      TEXT,
    document_source      SMALLINT,
    tax_district         INTEGER,
    approved_date        DATE,
    scheduled_date       DATE,
    delivery_date        DATE,
    delivery_via         TEXT,
    order_terms          TEXT,
    order_type           SMALLINT,
    status               SMALLINT,
    ship_to_address1     TEXT,
    ship_to_address2     TEXT,
    ship_to_city         TEXT,
    ship_to_state        TEXT,
    ship_to_zip          TEXT,
    received_amount      NUMERIC(18,2),
    current_amount       NUMERIC(18,2),
    cancelled_amount     NUMERIC(18,2),
    subtotal             NUMERIC(18,2),
    sales_tax            NUMERIC(18,2),
    po_total             NUMERIC(18,2),
    po_balance           NUMERIC(18,2),
    entered_date         DATE,
    entered_by           TEXT,
    issued_date          DATE,
    issue_batch          BIGINT,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_po_job        ON sage.purchase_orders (job_recnum);
CREATE INDEX IF NOT EXISTS idx_po_vendor     ON sage.purchase_orders (vendor_recnum);
CREATE INDEX IF NOT EXISTS idx_po_status     ON sage.purchase_orders (status);

-- =====================================================================
--  CHANGE ORDERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS sage.prime_change_orders (
    source_company         TEXT NOT NULL,
    recnum                 BIGINT NOT NULL,
    change_number          TEXT,
    change_date            DATE,
    job_recnum             BIGINT,
    phase_recnum           BIGINT,
    purchase_order         TEXT,
    change_type            SMALLINT,
    status                 SMALLINT,
    description            TEXT,
    reason                 TEXT,
    change_scope           TEXT,
    submitted_date         DATE,
    approved_date          DATE,
    invoiced_date          DATE,
    entered_date           DATE,
    delivery_request_days  SMALLINT,
    days_delay             SMALLINT,
    submitted_to           TEXT,
    submitted_by_recnum    BIGINT,
    requested_amount       NUMERIC(18,2),
    approved_amount        NUMERIC(18,2),
    cost_amount            NUMERIC(18,2),
    overhead_amount        NUMERIC(18,2),
    profit_amount          NUMERIC(18,2),
    requested_profit       NUMERIC(18,2),
    margin_amount          NUMERIC(18,2),
    requested_margin       NUMERIC(10,4),
    estimated_amount       NUMERIC(18,2),
    estimated_overhead     NUMERIC(18,2),
    acct_period            SMALLINT,
    post_year              SMALLINT,
    entered_by             TEXT,
    synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);
CREATE INDEX IF NOT EXISTS idx_prmchg_job    ON sage.prime_change_orders (job_recnum);
CREATE INDEX IF NOT EXISTS idx_prmchg_status ON sage.prime_change_orders (status);
CREATE INDEX IF NOT EXISTS idx_prmchg_date   ON sage.prime_change_orders (change_date);

CREATE TABLE IF NOT EXISTS sage.subcontract_changes (
    source_company         TEXT NOT NULL,
    recnum                 BIGINT NOT NULL,
    line_number            INTEGER NOT NULL,
    description            TEXT,
    change_hours           NUMERIC(10,2),
    change_units           NUMERIC(14,4),
    budget_price           NUMERIC(18,2),
    vendor_recnum          BIGINT,
    vendor_contract_recnum BIGINT,
    contract_line_number   INTEGER,
    change_number          TEXT,
    change_status          SMALLINT,
    change_date            DATE,
    cost_code              NUMERIC(15,3),
    cost_type              SMALLINT,
    overhead_markup        NUMERIC(8,4),
    synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum, line_number)
);

CREATE TABLE IF NOT EXISTS sage.change_order_types_prime (
    source_company TEXT NOT NULL,
    recnum         SMALLINT NOT NULL,
    type_name      TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

CREATE TABLE IF NOT EXISTS sage.change_order_types_corresp (
    source_company TEXT NOT NULL,
    recnum         SMALLINT NOT NULL,
    type_name      TEXT,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, recnum)
);

-- =====================================================================
--  EXTEND sync_runs WITH v2 row counters (additive)
-- =====================================================================

ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_timecard_lines        INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_timecard_deductions   INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_timecard_benefits     INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_timecard_wc           INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_timecard_paygroups    INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_paytypes              INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_paygroups             INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_paydeductions         INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_payunions             INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_benefits              INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_costcodes             INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_empabsence            INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_employee_pay          INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_employee_qtd          INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_employee_hires        INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_employee_licenses     INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_invoices      INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_invoice_lines INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_payments      INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_schedule      INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_clients       INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_locations     INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_types         INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_service_geo           INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_purchase_orders       INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_prime_change_orders   INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_subcontract_changes   INTEGER DEFAULT 0;
ALTER TABLE sage.sync_runs ADD COLUMN IF NOT EXISTS rows_change_order_types    INTEGER DEFAULT 0;

-- Re-apply schema permissions for the new tables. (Default privileges
-- from schema.sql cover them, but this is harmless and explicit.)
GRANT ALL ON ALL TABLES    IN SCHEMA sage TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA sage TO service_role;
