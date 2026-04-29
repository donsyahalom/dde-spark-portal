-- =====================================================================
-- ops.* view layer — portal-facing projection over sage.* sync tables
-- =====================================================================
-- The daily sync lands *raw* Sage data in the `sage` schema (see
-- schema.sql).  The portal pages, however, consume a much narrower and
-- more UI-friendly shape defined today by `src/lib/opsMockData.js` +
-- `src/hooks/useOpsData.js`.
--
-- This file creates a companion `ops` schema whose views project the
-- raw sage.* rows into exactly that shape.  Swapping the portal from
-- fixtures to live data is then a matter of querying ops.* instead of
-- importing the mock arrays — column names match 1:1.
--
-- Design goals
-- ------------
--   * Read-only.  Nothing in ops.* mutates sage.* data.
--   * Re-runnable.  Every object uses CREATE OR REPLACE VIEW, so applying
--     the file any number of times is safe.
--   * Single source-company scope today (DuBaldo).  If a second company
--     is added later, turn each view into a parameterised function or
--     add a `source_company` filter in the portal query.
--
-- Run this once in the Supabase SQL editor AFTER `schema.sql` has been
-- applied and the first `sync.py` run has populated sage.* tables.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS ops;

GRANT USAGE ON SCHEMA ops TO service_role, authenticated, anon;

-- Default grants so every object we create here is readable by the
-- portal's anon/authenticated role without per-view boilerplate.
ALTER DEFAULT PRIVILEGES IN SCHEMA ops
    GRANT SELECT ON TABLES TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- 1. ops.jobs
-- ---------------------------------------------------------------------
-- Mirrors the per-job row shape consumed by the Jobs page, Overview
-- cards, and A/R retainage column.  Direct-cost buckets (labor, material,
-- subs, equipment, bonds, permits, other) are rolled up from
-- sage.job_cost_transactions via cost_type (Sage: 1=Mat 2=Lab 3=Eqp
-- 4=Sub 5=Oth).  Bonds/permits aren't distinct cost_types in Sage v27 —
-- we surface them as 0 here and let accounting split them via cost
-- codes later if/when they want that granularity.
--
-- Productivity inputs (budgetLaborHrs / actualLaborHrs) come from
-- sage.job_budget_lines.hours_budget summed per job + labor hours
-- actually booked in job_cost_transactions for cost_type=2.
--
-- Retainage: sage.jobs.retainage is the *contractual* rate (sometimes
-- stored as % × 100, sometimes as $).  We surface both the held $ (the
-- only value the dashboard cares about) and the rate.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ops.jobs AS
WITH cost_roll AS (
    SELECT
        source_company,
        job_recnum,
        -- cost_type: 1 Material, 2 Labor, 3 Equipment, 4 Subcontract, 5 Other
        SUM(CASE WHEN cost_type = 2 THEN cost_amount ELSE 0 END) AS labor,
        SUM(CASE WHEN cost_type = 1 THEN cost_amount ELSE 0 END) AS material,
        SUM(CASE WHEN cost_type = 4 THEN cost_amount ELSE 0 END) AS subs,
        SUM(CASE WHEN cost_type = 3 THEN cost_amount ELSE 0 END) AS equipment,
        SUM(CASE WHEN cost_type = 5 THEN cost_amount ELSE 0 END) AS other,
        SUM(CASE WHEN cost_type = 2 THEN COALESCE(hours,0) ELSE 0 END) AS actual_labor_hrs
    FROM sage.job_cost_transactions
    GROUP BY source_company, job_recnum
),
budget_roll AS (
    SELECT
        source_company,
        job_recnum,
        SUM(COALESCE(hours_budget,0))     AS budget_labor_hrs,
        SUM(COALESCE(labor_budget,0))     AS budget_labor_dol,
        SUM(COALESCE(material_budget,0))
          + SUM(COALESCE(labor_budget,0))
          + SUM(COALESCE(equipment_budget,0))
          + SUM(COALESCE(subcontract_budget,0))
          + SUM(COALESCE(other_budget,0))    AS total_budget
    FROM sage.job_budget_lines
    GROUP BY source_company, job_recnum
),
ar_roll AS (
    -- Sum of invoiced (billed) amount per job — used as revenue proxy
    -- until Sage's native "billed to date" field is exposed.
    SELECT
        source_company,
        job_recnum,
        SUM(COALESCE(invoice_total,0)) AS billed_to_date,
        SUM(COALESCE(retainage,0))     AS retainage_held
    FROM sage.ar_invoices
    GROUP BY source_company, job_recnum
)
SELECT
    j.source_company,
    j.recnum                                             AS job_recnum,
    COALESCE(j.short_name, j.recnum::text)               AS num,
    j.job_name                                           AS name,
    -- Sage job_type: 1=Contract, 2=Service, 3=T&M, 4=Other  (v27)
    -- Anything labelled service/T&M -> 'service', else 'contract'.
    CASE WHEN j.job_type IN (2, 3) THEN 'service' ELSE 'contract' END AS type,
    j.contract_amount                                    AS contract,
    COALESCE(ar.billed_to_date, 0)                       AS revenue,
    COALESCE(c.labor,     0)                             AS labor,
    COALESCE(c.material,  0)                             AS material,
    COALESCE(c.subs,      0)                             AS subs,
    COALESCE(c.equipment, 0)                             AS equipment,
    0::numeric                                           AS bonds,      -- not a distinct cost_type in Sage v27
    0::numeric                                           AS permits,    -- "
    COALESCE(c.other,     0)                             AS other,
    COALESCE(b.budget_labor_hrs, 0)                      AS "budgetLaborHrs",
    COALESCE(c.actual_labor_hrs, 0)                      AS "actualLaborHrs",
    COALESCE(j.percent_complete, 0)                      AS "pctCmp",
    CASE j.status
        WHEN 0 THEN 'Active'
        WHEN 1 THEN 'Active'
        WHEN 2 THEN 'Hold'
        WHEN 3 THEN 'Closed'
        WHEN 4 THEN 'Closed'
        ELSE 'Active'
    END                                                  AS status,
    -- Retainage rate: Sage often stores as a fraction (0.10) or as a
    -- % (10).  Normalise to whole-percent.
    CASE
        WHEN j.retainage IS NULL           THEN 0
        WHEN j.retainage > 1               THEN j.retainage::numeric
        ELSE (j.retainage * 100)::numeric
    END                                                  AS "retainagePct",
    COALESCE(ar.retainage_held, 0)                       AS "retainageHeld",
    COALESCE(NULLIF(j.contact, ''), j.job_name)          AS customer
FROM sage.jobs j
LEFT JOIN cost_roll   c  ON (c.source_company, c.job_recnum)  = (j.source_company, j.recnum)
LEFT JOIN budget_roll b  ON (b.source_company, b.job_recnum)  = (j.source_company, j.recnum)
LEFT JOIN ar_roll     ar ON (ar.source_company, ar.job_recnum)= (j.source_company, j.recnum)
WHERE j.is_active IS NOT FALSE;


-- ---------------------------------------------------------------------
-- 2. ops.ar_invoices
-- ---------------------------------------------------------------------
-- Shape matches AR_INVOICES in opsMockData.  `type` is derived from the
-- linked job: contract job -> 'AR', service job -> 'SR'.
-- `customer` rolls up from the job's contact for now (Sage v27 has no
-- separate client master — see schema.sql note).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ops.ar_invoices AS
SELECT
    ar.source_company,
    ar.recnum                              AS recnum,
    ar.invoice_number                      AS invoice,
    CASE WHEN j.job_type IN (2, 3) THEN 'SR' ELSE 'AR' END AS type,
    COALESCE(NULLIF(j.contact, ''), j.job_name) AS customer,
    COALESCE(j.short_name, '') || ' ' || COALESCE(j.job_name, '') AS job,
    ar.invoice_date                        AS "invDate",
    ar.due_date                            AS "dueDate",
    ar.invoice_total                       AS total,
    ar.invoice_balance                     AS balance,
    GREATEST(0, (CURRENT_DATE - ar.due_date))::int AS "ageDays",
    ar.retainage                           AS retainage,
    ar.bucket_current,
    ar.bucket_1_30,
    ar.bucket_31_60,
    ar.bucket_61_90,
    ar.bucket_over_90
FROM sage.ar_invoices ar
LEFT JOIN sage.jobs j
       ON (j.source_company, j.recnum) = (ar.source_company, ar.job_recnum)
WHERE COALESCE(ar.invoice_balance, 0) <> 0
  AND COALESCE(ar.status, 1) NOT IN (4, 5);   -- exclude paid (4) + voided (5);
                                              -- Sage doesn't zero invbal on void,
                                              -- so we filter to match aging report 3-1-3-21.


-- ---------------------------------------------------------------------
-- 3. ops.ap_invoices
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ops.ap_invoices AS
SELECT
    ap.source_company,
    ap.recnum                              AS recnum,
    v.vendor_name                          AS vendor,
    ap.invoice_number                      AS invoice,
    COALESCE(j.job_name, '(company)')      AS job,
    ap.due_date                            AS "dueDate",
    ap.invoice_total                       AS total,
    ap.invoice_balance                     AS balance,
    GREATEST(0, (CURRENT_DATE - ap.due_date))::int AS "ageDays"
FROM sage.ap_invoices ap
LEFT JOIN sage.vendors v
       ON (v.source_company, v.recnum) = (ap.source_company, ap.vendor_recnum)
LEFT JOIN sage.jobs j
       ON (j.source_company, j.recnum) = (ap.source_company, ap.job_recnum)
WHERE COALESCE(ap.invoice_balance, 0) <> 0
  AND COALESCE(ap.status, 1) NOT IN (4, 5);   -- exclude paid (4) + voided (5);
                                              -- matches aging report 4-1-3-21.


-- ---------------------------------------------------------------------
-- 4. ops.payroll_lines
-- ---------------------------------------------------------------------
-- The portal's Payroll page consumes "employee × week × job" grain.
-- Sage's sage.payroll_records is "employee × check" grain — a single
-- payroll record covers a full pay period regardless of how many jobs
-- that employee worked.  For per-job allocation the true source is
-- sage.job_cost_transactions (rows with cost_type=2 and employee_recnum).
--
-- This view is the honest projection: one row per employee per job per
-- week, with hours & $ coming from the job-cost labor side.  Sick /
-- vacation / holiday hours aren't job-coded in Sage — they live on the
-- payroll record — so this view surfaces 0 for those and a separate
-- view (ops.payroll_non_job_time) exposes sick/vac/hol/ot-premium.
--
-- The Payroll page reads both views and joins on (week, emp) to
-- reconstitute the same shape opsMockData.PAYROLL_LINES ships today.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ops.payroll_lines AS
SELECT
    jct.source_company,
    jct.recnum                             AS recnum,
    -- Week = Monday of the week the work was done, ISO convention.
    (DATE_TRUNC('week', jct.trans_date) + INTERVAL '4 days')::date AS week,
    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS emp,
    NULL::text                             AS trade,     -- Sage has no canonical trade field; populate via mapping table later
    COALESCE(j.short_name, j.recnum::text) AS job,
    j.job_name                             AS "jobName",
    jct.hours                              AS "regHrs",
    0::numeric                             AS "otHrs",   -- OT lives on payrec, surfaced in ops.payroll_non_job_time
    0::numeric                             AS "sickHrs",
    0::numeric                             AS "vacHrs",
    0::numeric                             AS "holHrs",
    0::numeric                             AS "perDiem",
    CASE WHEN jct.hours > 0
         THEN jct.cost_amount / jct.hours
         ELSE NULL END                     AS rate,
    jct.cost_amount                        AS cost_amount
FROM sage.job_cost_transactions jct
JOIN sage.employees e
  ON (e.source_company, e.recnum) = (jct.source_company, jct.employee_recnum)
LEFT JOIN sage.jobs j
  ON (j.source_company, j.recnum) = (jct.source_company, jct.job_recnum)
WHERE jct.cost_type = 2   -- Labor
  AND jct.employee_recnum IS NOT NULL;


CREATE OR REPLACE VIEW ops.payroll_non_job_time AS
-- Sick / vacation / holiday / OT premium — these are whole-pay-period
-- totals and aren't allocated per job.  Payroll page sums them into the
-- "non-regular $ over time" chart by week.
SELECT
    pr.source_company,
    pr.recnum                              AS recnum,
    (DATE_TRUNC('week', pr.period_end) + INTERVAL '4 days')::date AS week,
    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS emp,
    pr.overtime_hours                      AS "otHrs",
    pr.sick_hours                          AS "sickHrs",
    pr.vacation_hours                      AS "vacHrs",
    pr.holiday_hours                       AS "holHrs",
    pr.overtime_pay                        AS "otPay",
    pr.sick_pay                            AS "sickPay",
    pr.vacation_pay                        AS "vacPay",
    pr.holiday_pay                         AS "holPay"
FROM sage.payroll_records pr
JOIN sage.employees e
  ON (e.source_company, e.recnum) = (pr.source_company, pr.employee_recnum);


-- ---------------------------------------------------------------------
-- 5. ops.purchase_orders / ops.work_orders
-- ---------------------------------------------------------------------
-- Sage 100 Contractor v27 does not ship a first-class PO table in the
-- base schema we're syncing today.  POs live in dbo.prchrd /
-- dbo.prchli (header + lines).  We can either:
--   (a) extend sage_queries.py to pull prchrd + prchli into a new
--       sage.purchase_orders table, then project here, OR
--   (b) keep the portal's PO list on mock data until the PM team
--       confirms they actually maintain POs in Sage (many shops
--       maintain POs outside of Sage Contractor).
--
-- Decision: leave as TODO — the portal's PURCHASE_ORDERS fixture keeps
-- the Jobs page P&L commits row working; we revisit after the jobs +
-- A/R slice is live and validated.
--
-- Same story for WORK_ORDERS — service work orders live in dbo.srvord
-- which the base sync doesn't cover yet.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 6. ops.kpi_sparks (monthly roll-ups from raw transactions)
-- ---------------------------------------------------------------------
-- The Overview page's top-of-card KPI sparklines need a small monthly
-- time-series for each company metric.  These are 100% derivable from
-- sage.gl_transactions + sage.ar_invoices.  Delivered here as a
-- table-valued function so the portal can request the last N months.
--
-- Stub for now — the jobs + A/R slice is the first useOpsData migration
-- and doesn't depend on this.  Left commented so the path is explicit.
--
-- CREATE OR REPLACE FUNCTION ops.kpi_sparks(n_months int DEFAULT 12)
--     RETURNS TABLE (
--         id text, label text, month date, value numeric
--     ) ...
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 7. ops.last_sync
-- ---------------------------------------------------------------------
-- Freshness stamp for the UI so the portal can show "Last synced from
-- Sage at …" on every ops page header.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ops.last_sync AS
SELECT
    source_company,
    MAX(finished_at)    AS last_sync_at,
    MAX(status)         AS last_status
FROM sage.sync_runs
WHERE status IN ('success', 'partial')
GROUP BY source_company;


-- ---------------------------------------------------------------------
-- Permissions — make ops.* readable through the portal's anon/authed
-- keys via PostgREST.  (sage.* stays server-role-only.)
-- ---------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA ops TO authenticated, anon;
