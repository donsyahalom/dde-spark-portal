-- =====================================================================
-- patch_features.sql — admin overrides, OT modeling, real bank list,
-- cashflow projection by actual due-date week
-- =====================================================================
-- Run this whole file in the Supabase SQL editor for the UAT project.
-- Re-runnable: every object uses CREATE OR REPLACE / DROP-then-CREATE.
-- No portal redeploy needed.
--
-- Adds:
--   * ops.job_type_overrides   — admin-set Contract↔Service flips
--   * ops.gl_cash_accounts      — cash/bank accounts found in COA by
--                                 name heuristic (fallback to 1000-1199)
--   * ops.payroll_modeled_ot    — proportional OT allocation per
--                                 (week, employee, job)
--   * ops.dashboard_users       — Sparks-portal users who can see /ops
--
-- Replaces:
--   * ops.jobs                  — honors job_type_overrides
--   * ops.ar_invoices           — honors job_type_overrides for AR/SR
--   * ops.kpis                  — uses ops.gl_cash_accounts
--   * ops.cashflow_weekly       — buckets invoices into actual due-week
--                                 (computed from due_date), uses
--                                 ops.gl_cash_accounts
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Admin overrides table — Contract ↔ Service flips
-- ---------------------------------------------------------------------
-- Persisted, all users see the same value once an admin saves.  RLS
-- guards mutations to admins only; SELECT is open to authenticated /
-- anon so the portal can read overrides without a service-role call.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.job_type_overrides (
    source_company TEXT     NOT NULL,
    job_recnum     BIGINT   NOT NULL,
    override_type  TEXT     NOT NULL CHECK (override_type IN ('contract', 'service')),
    set_by_email   TEXT,
    set_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_company, job_recnum)
);

ALTER TABLE ops.job_type_overrides ENABLE ROW LEVEL SECURITY;

-- Anyone with the anon/authenticated keys can read overrides.
DROP POLICY IF EXISTS read_overrides ON ops.job_type_overrides;
CREATE POLICY read_overrides ON ops.job_type_overrides
    FOR SELECT
    USING (true);

-- Mutations gated by the public.employees admin flag.  We look up the
-- caller's row by their auth.email() and require is_admin=TRUE.
DROP POLICY IF EXISTS mutate_overrides ON ops.job_type_overrides;
CREATE POLICY mutate_overrides ON ops.job_type_overrides
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE  LOWER(e.email) = LOWER(auth.email())
              AND  e.is_admin = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE  LOWER(e.email) = LOWER(auth.email())
              AND  e.is_admin = TRUE
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON ops.job_type_overrides TO authenticated;
GRANT SELECT                          ON ops.job_type_overrides TO anon;


-- ---------------------------------------------------------------------
-- 2. ops.jobs — same shape as before, plus override-aware `type`
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.jobs;

CREATE VIEW ops.jobs AS
WITH cost_roll AS (
    SELECT
        source_company,
        job_recnum,
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
        SUM(COALESCE(material_budget,0))
          + SUM(COALESCE(labor_budget,0))
          + SUM(COALESCE(equipment_budget,0))
          + SUM(COALESCE(subcontract_budget,0))
          + SUM(COALESCE(other_budget,0))    AS total_budget
    FROM sage.job_budget_lines
    GROUP BY source_company, job_recnum
),
ar_roll AS (
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
    -- Type honors admin override first, falls back to Sage's job_type.
    COALESCE(
        ovr.override_type,
        CASE WHEN j.job_type IN (2, 3) THEN 'service' ELSE 'contract' END
    )                                                    AS type,
    -- Surface whether the type is overridden so the UI can flag it.
    (ovr.override_type IS NOT NULL)                      AS "typeOverridden",
    j.contract_amount                                    AS contract,
    COALESCE(ar.billed_to_date, 0)                       AS revenue,
    COALESCE(c.labor,     0)                             AS labor,
    COALESCE(c.material,  0)                             AS material,
    COALESCE(c.subs,      0)                             AS subs,
    COALESCE(c.equipment, 0)                             AS equipment,
    0::numeric                                           AS bonds,
    0::numeric                                           AS permits,
    COALESCE(c.other,     0)                             AS other,
    COALESCE(b.budget_labor_hrs, 0)                      AS "budgetLaborHrs",
    COALESCE(c.actual_labor_hrs, 0)                      AS "actualLaborHrs",
    COALESCE(
        NULLIF(
            CASE
                WHEN j.percent_complete IS NULL THEN 0
                WHEN j.percent_complete > 1     THEN j.percent_complete::numeric
                ELSE (j.percent_complete * 100)::numeric
            END,
            0
        ),
        CASE
            WHEN COALESCE(b.total_budget, 0) > 0
            THEN LEAST(100::numeric,
                       ROUND((COALESCE(c.labor,0) + COALESCE(c.material,0)
                              + COALESCE(c.subs,0) + COALESCE(c.equipment,0)
                              + COALESCE(c.other,0))
                             * 100.0 / b.total_budget, 1))
            ELSE 0::numeric
        END
    )                                                    AS "pctCmp",
    CASE j.status
        WHEN 0 THEN 'Active'
        WHEN 1 THEN 'Active'
        WHEN 2 THEN 'Hold'
        WHEN 3 THEN 'Closed'
        WHEN 4 THEN 'Closed'
        ELSE 'Active'
    END                                                  AS status,
    CASE
        WHEN j.retainage IS NULL           THEN 0
        WHEN j.retainage > 1               THEN j.retainage::numeric
        ELSE (j.retainage * 100)::numeric
    END                                                  AS "retainagePct",
    COALESCE(ar.retainage_held, 0)                       AS "retainageHeld",
    COALESCE(NULLIF(j.contact, ''), j.job_name)          AS customer
FROM sage.jobs j
LEFT JOIN cost_roll   c   ON (c.source_company,   c.job_recnum)   = (j.source_company, j.recnum)
LEFT JOIN budget_roll b   ON (b.source_company,   b.job_recnum)   = (j.source_company, j.recnum)
LEFT JOIN ar_roll     ar  ON (ar.source_company,  ar.job_recnum)  = (j.source_company, j.recnum)
LEFT JOIN ops.job_type_overrides ovr
                          ON (ovr.source_company, ovr.job_recnum) = (j.source_company, j.recnum)
WHERE j.is_active IS NOT FALSE;

GRANT SELECT ON ops.jobs TO authenticated, anon;


-- ---------------------------------------------------------------------
-- 3. ops.ar_invoices — same shape, but `type` honors the job's override
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.ar_invoices;

CREATE VIEW ops.ar_invoices AS
SELECT
    ar.source_company,
    ar.recnum                              AS recnum,
    ar.invoice_number                      AS invoice,
    -- AR for contract jobs, SR for service.  Override > job_type.
    CASE
        WHEN COALESCE(ovr.override_type,
                      CASE WHEN j.job_type IN (2, 3) THEN 'service' ELSE 'contract' END
        ) = 'service' THEN 'SR'
        ELSE 'AR'
    END                                    AS type,
    COALESCE(NULLIF(j.contact, ''), j.job_name) AS customer,
    COALESCE(j.short_name, '') || ' ' || COALESCE(j.job_name, '') AS job,
    ar.job_recnum                          AS "jobRecnum",
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
LEFT JOIN ops.job_type_overrides ovr
       ON (ovr.source_company, ovr.job_recnum) = (j.source_company, j.recnum)
WHERE COALESCE(ar.invoice_balance, 0) <> 0;

GRANT SELECT ON ops.ar_invoices TO authenticated, anon;


-- ---------------------------------------------------------------------
-- 4. ops.gl_cash_accounts — bank/cash account list for the Cashflow page
-- ---------------------------------------------------------------------
-- Heuristic: any active asset account whose short or long name contains
-- 'cash', 'bank', 'checking', 'savings', 'mma', 'money market',
-- 'operating', or 'payroll account'.  As a safety net, also includes
-- account-number range 1000-1199 (Sage's convention).
--
-- If the heuristic picks up the wrong accounts, override by adding a
-- WHERE clause filter to a specific recnum list.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.gl_cash_accounts;

CREATE VIEW ops.gl_cash_accounts AS
SELECT
    source_company,
    recnum                                  AS account_recnum,
    short_name,
    long_name,
    COALESCE(NULLIF(short_name,''), long_name, recnum::text) AS label,
    COALESCE(current_balance, 0)            AS balance
FROM sage.gl_accounts
WHERE COALESCE(is_active, TRUE)
  AND account_type = 1                     -- Asset
  AND (
       (recnum BETWEEN 1000 AND 1199)
    OR LOWER(COALESCE(short_name,''))  ~ '\m(cash|bank|checking|savings|mma|operating|payroll)\M'
    OR LOWER(COALESCE(long_name, ''))  ~ '\m(cash|bank|checking|savings|mma|money\s+market|operating)\M'
  );

GRANT SELECT ON ops.gl_cash_accounts TO authenticated, anon;


-- ---------------------------------------------------------------------
-- 5. ops.kpis — uses gl_cash_accounts
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.kpis;

CREATE VIEW ops.kpis AS
WITH
ar_tot AS (
    SELECT source_company,
           SUM(COALESCE(invoice_balance,0)) AS ar_balance,
           AVG(NULLIF(GREATEST(0,(CURRENT_DATE-due_date))::int,0)) AS dso
    FROM sage.ar_invoices
    GROUP BY source_company
),
ap_tot AS (
    SELECT source_company,
           SUM(COALESCE(invoice_balance,0)) AS ap_balance,
           AVG(NULLIF(GREATEST(0,(CURRENT_DATE-due_date))::int,0)) AS dpo
    FROM sage.ap_invoices
    GROUP BY source_company
),
cash_tot AS (
    SELECT source_company,
           SUM(balance) AS cash_on_hand,
           COUNT(*)     AS cash_account_count
    FROM ops.gl_cash_accounts
    GROUP BY source_company
),
rev_ytd AS (
    SELECT source_company,
           SUM(COALESCE(invoice_total,0)) AS revenue_ytd
    FROM sage.ar_invoices
    WHERE invoice_date >= DATE_TRUNC('year', CURRENT_DATE)::date
    GROUP BY source_company
),
rev_prior_ytd AS (
    SELECT source_company,
           SUM(COALESCE(invoice_total,0)) AS revenue_prior_ytd
    FROM sage.ar_invoices
    WHERE invoice_date >= (DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year')::date
      AND invoice_date <  (DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year'
                           + (CURRENT_DATE - DATE_TRUNC('year', CURRENT_DATE)::date) * INTERVAL '1 day')::date
    GROUP BY source_company
),
cost_ytd AS (
    SELECT source_company,
           SUM(COALESCE(cost_amount,0)) AS direct_cost_ytd
    FROM sage.job_cost_transactions
    WHERE trans_date >= DATE_TRUNC('year', CURRENT_DATE)::date
    GROUP BY source_company
),
companies AS (
    SELECT DISTINCT source_company FROM sage.jobs
)
SELECT
    c.source_company,
    COALESCE(r.revenue_ytd, 0)                         AS revenue_ytd,
    COALESCE(r.revenue_ytd, 0)
        - COALESCE(cc.direct_cost_ytd, 0)              AS gross_profit_ytd,
    (COALESCE(r.revenue_ytd, 0) - COALESCE(cc.direct_cost_ytd, 0))
        - ROUND(COALESCE(r.revenue_ytd, 0) * 0.09)     AS net_profit_ytd,
    CASE WHEN COALESCE(rp.revenue_prior_ytd, 0) > 0
         THEN ROUND(((COALESCE(r.revenue_ytd, 0) - rp.revenue_prior_ytd)
                     / rp.revenue_prior_ytd) * 100, 1)
         ELSE NULL
    END                                                AS yoy_revenue_pct,
    CASE WHEN COALESCE(r.revenue_ytd, 0) > 0
         THEN ROUND(((COALESCE(r.revenue_ytd, 0) - COALESCE(cc.direct_cost_ytd, 0))
                     / r.revenue_ytd) * 100, 1)
         ELSE NULL
    END                                                AS gp_pct,
    COALESCE(cash.cash_on_hand, 0)                     AS cash_on_hand,
    COALESCE(cash.cash_account_count, 0)               AS cash_account_count,
    COALESCE(ar.ar_balance, 0)                         AS ar_balance,
    ROUND(COALESCE(ar.dso, 0))::int                    AS dso_days,
    COALESCE(ap.ap_balance, 0)                         AS ap_balance,
    ROUND(COALESCE(ap.dpo, 0))::int                    AS dpo_days
FROM companies c
LEFT JOIN ar_tot         ar   ON ar.source_company   = c.source_company
LEFT JOIN ap_tot         ap   ON ap.source_company   = c.source_company
LEFT JOIN cash_tot       cash ON cash.source_company = c.source_company
LEFT JOIN rev_ytd        r    ON r.source_company    = c.source_company
LEFT JOIN rev_prior_ytd  rp   ON rp.source_company   = c.source_company
LEFT JOIN cost_ytd       cc   ON cc.source_company   = c.source_company;

GRANT SELECT ON ops.kpis TO authenticated, anon;


-- ---------------------------------------------------------------------
-- 6. ops.cashflow_weekly — bucket invoices by ACTUAL due-date week
-- ---------------------------------------------------------------------
-- For each open AR / AP invoice we compute the week_offset between
-- today and the invoice's due_date.  Overdue (offset <= 0) lands in
-- week 1.  Anything beyond week 13 is computed but the portal clips
-- the chart to weeks 1-13, so far-future inflows just disappear from
-- the chart (which matches Don's "compute properly, only display 13").
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.cashflow_weekly;

CREATE VIEW ops.cashflow_weekly AS
WITH companies AS (
    SELECT DISTINCT source_company FROM sage.jobs
),
weeks AS (
    SELECT generate_series(1, 13) AS week_num
),
ar_per_week AS (
    SELECT
        source_company,
        GREATEST(1,
                 CEIL(EXTRACT(EPOCH FROM (due_date - CURRENT_DATE)) / 86400.0 / 7.0)::int
        )                                       AS week_num,
        SUM(COALESCE(invoice_balance, 0))       AS amount
    FROM sage.ar_invoices
    WHERE COALESCE(invoice_balance, 0) > 0
      AND due_date IS NOT NULL
    GROUP BY 1, 2
),
ap_per_week AS (
    SELECT
        source_company,
        GREATEST(1,
                 CEIL(EXTRACT(EPOCH FROM (due_date - CURRENT_DATE)) / 86400.0 / 7.0)::int
        )                                       AS week_num,
        SUM(COALESCE(invoice_balance, 0))       AS amount
    FROM sage.ap_invoices
    WHERE COALESCE(invoice_balance, 0) > 0
      AND due_date IS NOT NULL
    GROUP BY 1, 2
),
cash_open AS (
    SELECT source_company,
           SUM(balance) AS opening_cash
    FROM ops.gl_cash_accounts
    GROUP BY source_company
),
projected AS (
    SELECT
        c.source_company,
        w.week_num,
        COALESCE(ar.amount, 0)        AS inflow,
        COALESCE(ap.amount, 0)        AS outflow,
        COALESCE(co.opening_cash, 0)  AS opening_cash
    FROM companies c
    CROSS JOIN weeks w
    LEFT JOIN ar_per_week ar
           ON (ar.source_company, ar.week_num) = (c.source_company, w.week_num)
    LEFT JOIN ap_per_week ap
           ON (ap.source_company, ap.week_num) = (c.source_company, w.week_num)
    LEFT JOIN cash_open   co
           ON  co.source_company       = c.source_company
)
SELECT
    source_company,
    week_num,
    'wk ' || week_num::text AS week_label,
    ROUND(inflow)::numeric  AS inflow,
    ROUND(outflow)::numeric AS outflow,
    ROUND(
        opening_cash
        + SUM(inflow - outflow) OVER (
              PARTITION BY source_company ORDER BY week_num
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
    )::numeric AS cash
FROM projected
ORDER BY source_company, week_num;

GRANT SELECT ON ops.cashflow_weekly TO authenticated, anon;


-- ---------------------------------------------------------------------
-- 7. ops.payroll_modeled_ot — proportional OT allocation per job
-- ---------------------------------------------------------------------
-- Sage doesn't allocate overtime hours to a specific job — the OT total
-- lives on the pay record.  We approximate by spreading each employee's
-- weekly OT proportionally across the jobs they worked that week, using
-- their actual labor hours per job (cost_type=2) as the weight.
--
-- The Payroll page reads this view ON DEMAND when the user clicks
-- "Model OT" — and treats the output as additive OT hours per
-- (week, emp, job) row (not a replacement for raw payroll_lines).
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.payroll_modeled_ot;

CREATE VIEW ops.payroll_modeled_ot AS
WITH job_hrs_per_week AS (
    SELECT
        jct.source_company,
        (DATE_TRUNC('week', jct.trans_date) + INTERVAL '4 days')::date AS week,
        jct.employee_recnum,
        jct.job_recnum,
        SUM(COALESCE(jct.hours, 0))   AS reg_hrs_for_job,
        SUM(COALESCE(jct.cost_amount, 0)) AS reg_pay_for_job
    FROM sage.job_cost_transactions jct
    WHERE jct.cost_type = 2
      AND jct.employee_recnum IS NOT NULL
      AND jct.trans_date IS NOT NULL
    GROUP BY 1, 2, 3, 4
),
emp_week_total AS (
    SELECT
        source_company,
        week,
        employee_recnum,
        SUM(reg_hrs_for_job) AS total_reg_hrs
    FROM job_hrs_per_week
    GROUP BY 1, 2, 3
),
ot_per_week AS (
    SELECT
        pr.source_company,
        (DATE_TRUNC('week', pr.period_end) + INTERVAL '4 days')::date AS week,
        pr.employee_recnum,
        SUM(COALESCE(pr.overtime_hours, 0)) AS ot_hrs,
        SUM(COALESCE(pr.overtime_pay,   0)) AS ot_pay
    FROM sage.payroll_records pr
    WHERE pr.employee_recnum IS NOT NULL
      AND pr.period_end IS NOT NULL
    GROUP BY 1, 2, 3
)
SELECT
    j.source_company,
    j.week,
    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS emp,
    COALESCE(jb.short_name, jb.recnum::text)        AS job,
    jb.job_name                                     AS "jobName",
    j.job_recnum,
    -- Allocated OT = (this job's reg_hrs / employee's total reg_hrs that week) × ot_hrs
    ROUND(
        CASE WHEN ewt.total_reg_hrs > 0
             THEN (j.reg_hrs_for_job / ewt.total_reg_hrs) * COALESCE(ot.ot_hrs, 0)
             ELSE 0
        END, 2
    ) AS "modeledOtHrs",
    ROUND(
        CASE WHEN ewt.total_reg_hrs > 0
             THEN (j.reg_hrs_for_job / ewt.total_reg_hrs) * COALESCE(ot.ot_pay, 0)
             ELSE 0
        END, 2
    ) AS "modeledOtPay"
FROM job_hrs_per_week j
JOIN emp_week_total ewt
  ON (ewt.source_company, ewt.week, ewt.employee_recnum)
   = (j.source_company,   j.week,   j.employee_recnum)
LEFT JOIN ot_per_week ot
  ON (ot.source_company, ot.week, ot.employee_recnum)
   = (j.source_company,  j.week,  j.employee_recnum)
JOIN sage.employees e
  ON (e.source_company, e.recnum) = (j.source_company, j.employee_recnum)
LEFT JOIN sage.jobs jb
  ON (jb.source_company, jb.recnum) = (j.source_company, j.job_recnum)
WHERE COALESCE(ot.ot_hrs, 0) > 0;

GRANT SELECT ON ops.payroll_modeled_ot TO authenticated, anon;


-- ---------------------------------------------------------------------
-- 8. ops.dashboard_users — Sparks-portal users with /ops access
-- ---------------------------------------------------------------------
-- Source of truth for the Permissions tab: the same table the
-- ops route guard (App.jsx → OpsRoute) checks.  Anyone with admin
-- flag or job_grade='Owner' can see /ops, so they show up here.
--
-- job_grade may not exist in every Sparks deploy yet — the COALESCE
-- and try/catch in the column expression below keep this view safe.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS ops.dashboard_users;

CREATE VIEW ops.dashboard_users AS
SELECT
    e.id::text                                              AS sparks_id,
    TRIM(CONCAT_WS(' ', e.first_name, e.last_name))         AS name,
    e.email,
    CASE
        WHEN e.is_admin THEN 'admin'
        ELSE 'owner'
    END                                                     AS role,
    e.is_admin                                              AS is_admin
FROM public.employees e
WHERE e.is_admin = TRUE
   OR LOWER(COALESCE(
        -- job_grade column may or may not exist; guard with to_jsonb
        (to_jsonb(e) ->> 'job_grade'), ''
      )) = 'owner'
ORDER BY e.is_admin DESC, e.last_name, e.first_name;

GRANT SELECT ON ops.dashboard_users TO authenticated, anon;
