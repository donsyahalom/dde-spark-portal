-- =====================================================================
--  ops_views_v2.sql
--  ---------------------------------------------------------------------
--  v2 portal-facing projections over the new sage.* tables created in
--  schema_v2.sql. Layered ON TOP of ops_views.sql — does NOT modify any
--  existing v1 view. Re-runnable (every CREATE uses OR REPLACE).
--
--  Run this in the Supabase SQL editor AFTER schema_v2.sql.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS ops;

-- =====================================================================
--  SERVICE RECEIVABLES
-- =====================================================================

-- One row per service invoice with computed aging + client/job context.
CREATE OR REPLACE VIEW ops.service_invoices AS
SELECT
    i.source_company,
    i.recnum                                                AS invoice_recnum,
    i.invoice_number,
    i.service_order_number,
    i.invoice_date,
    i.due_date,
    i.invoice_total,
    i.invoice_balance,
    i.total_paid,
    i.sales_tax,
    i.status,
    CASE i.status
        WHEN 0 THEN 'pending'
        WHEN 1 THEN 'in_progress'
        WHEN 2 THEN 'completed'
        WHEN 3 THEN 'invoiced'
        WHEN 4 THEN 'paid'
        WHEN 5 THEN 'cancelled'
        ELSE 'other'
    END                                                     AS status_label,
    i.bucket_current,
    i.bucket_1_30,
    i.bucket_31_60,
    i.bucket_61_90,
    i.bucket_over_90,
    i.client_recnum,
    c.client_name,
    c.short_name        AS client_short_name,
    c.phone1            AS client_phone,
    c.email             AS client_email,
    i.job_recnum,
    j.job_name          AS job_name,
    i.location_recnum,
    l.location_name,
    l.address1          AS site_address,
    l.city              AS site_city,
    l.state             AS site_state,
    i.scheduled_date,
    i.started_date,
    i.finished_date,
    i.billed_date,
    i.scheduled_hours,
    i.actual_hours
FROM sage.service_invoices  i
LEFT JOIN sage.service_clients   c
       ON c.source_company = i.source_company AND c.recnum = i.client_recnum
-- service_locations PK is (source_company, recnum, location_number), where
-- recnum is the parent client ref. Match the composite key, not just recnum,
-- otherwise a client with N locations fans the invoice row out N times.
LEFT JOIN sage.service_locations l
       ON l.source_company   = i.source_company
      AND l.recnum           = i.client_recnum
      AND l.location_number  = i.location_recnum
LEFT JOIN sage.jobs              j
       ON j.source_company = i.source_company AND j.recnum = i.job_recnum;

-- Outstanding service A/R only.
CREATE OR REPLACE VIEW ops.service_ar_open AS
SELECT *
FROM ops.service_invoices
WHERE invoice_balance IS NOT NULL AND invoice_balance > 0;

-- Service invoice line items joined back to header (date / client).
CREATE OR REPLACE VIEW ops.service_invoice_lines AS
SELECT
    h.source_company,
    h.recnum            AS invoice_recnum,
    l.line_number,
    h.invoice_number,
    h.invoice_date,
    h.client_recnum,
    h.job_recnum,
    h.location_recnum,
    l.description,
    l.cost_type,
    l.part_recnum,
    l.assembly_recnum,
    l.unit_description,
    l.part_quantity,
    l.part_price,
    l.extended_quantity,
    l.extended_price,
    l.current_billing
FROM sage.service_invoices       h
JOIN sage.service_invoice_lines  l
  ON l.source_company = h.source_company
 AND l.recnum         = h.recnum;

-- Today's dispatched / scheduled visits for the field board.
CREATE OR REPLACE VIEW ops.service_schedule_today AS
SELECT
    s.source_company,
    s.recnum            AS invoice_recnum,
    s.line_number,
    s.scheduled_date,
    s.scheduled_start_time,
    s.scheduled_finish_time,
    s.estimated_hours,
    s.actual_start_time,
    s.actual_finish_time,
    s.actual_hours,
    s.finished_date,
    s.priority,
    s.employee_recnum,
    e.first_name        AS employee_first_name,
    e.last_name         AS employee_last_name,
    h.invoice_number,
    h.description       AS work_description,
    h.client_recnum,
    c.client_name,
    h.location_recnum,
    l.location_name,
    l.address1          AS site_address,
    l.city              AS site_city,
    l.state             AS site_state
FROM sage.service_schedule    s
LEFT JOIN sage.service_invoices  h
       ON h.source_company = s.source_company AND h.recnum = s.recnum
LEFT JOIN sage.service_clients   c
       ON c.source_company = h.source_company AND c.recnum = h.client_recnum
-- Composite-key match prevents fan-out across multiple locations.
LEFT JOIN sage.service_locations l
       ON l.source_company   = h.source_company
      AND l.recnum           = h.client_recnum
      AND l.location_number  = h.location_recnum
LEFT JOIN sage.employees         e
       ON e.source_company = s.source_company AND e.recnum = s.employee_recnum
WHERE s.scheduled_date >= CURRENT_DATE - INTERVAL '1 day'
  AND s.scheduled_date <= CURRENT_DATE + INTERVAL '14 days';

-- Service contracts expiring in the next 90 days.
CREATE OR REPLACE VIEW ops.service_contracts_expiring AS
SELECT
    source_company,
    recnum             AS client_recnum,
    short_name,
    client_name,
    contact1,
    phone1,
    email,
    service_contract_expiry,
    (service_contract_expiry - CURRENT_DATE)::INTEGER AS days_until_expiry,
    end_balance        AS current_balance,
    last_service_date
FROM sage.service_clients
WHERE service_contract_flag = 1
  AND service_contract_expiry IS NOT NULL
  AND service_contract_expiry BETWEEN CURRENT_DATE - INTERVAL '30 days'
                                 AND CURRENT_DATE + INTERVAL '90 days'
  AND COALESCE(is_active, TRUE) = TRUE
ORDER BY service_contract_expiry;

-- =====================================================================
--  PURCHASE ORDERS
-- =====================================================================

-- Live POs (currently 32 rows in DuBaldo) with vendor / job context.
CREATE OR REPLACE VIEW ops.purchase_orders_live AS
SELECT
    p.source_company,
    p.recnum            AS po_recnum,
    p.order_number,
    p.order_date,
    p.scheduled_date,
    p.delivery_date,
    p.status,
    CASE p.status
        WHEN 0 THEN 'open'
        WHEN 1 THEN 'partial'
        WHEN 2 THEN 'received'
        WHEN 3 THEN 'closed'
        WHEN 4 THEN 'cancelled'
        ELSE 'other'
    END                 AS status_label,
    p.vendor_recnum,
    v.vendor_name,
    p.job_recnum,
    j.job_name          AS job_name,
    p.phase_recnum,
    p.description,
    p.subtotal,
    p.sales_tax,
    p.po_total,
    p.po_balance,
    p.received_amount,
    p.current_amount,
    p.cancelled_amount,
    p.entered_by,
    p.entered_date,
    p.issued_date
FROM sage.purchase_orders p
LEFT JOIN sage.vendors v
       ON v.source_company = p.source_company AND v.recnum = p.vendor_recnum
LEFT JOIN sage.jobs    j
       ON j.source_company = p.source_company AND j.recnum = p.job_recnum;

-- Reconstruct historical PO spend from GL transactions that reference a PO.
-- source_code = 1 filters to the AP module. gl_transactions.purchase_order
-- is populated from trngl.pchord at sync time.
CREATE OR REPLACE VIEW ops.purchase_order_spend AS
SELECT
    t.source_company,
    t.purchase_order,
    t.vendor_recnum,
    v.vendor_name,
    COUNT(*)                            AS transaction_count,
    MIN(t.trans_date)                   AS first_trans_date,
    MAX(t.trans_date)                   AS last_trans_date,
    SUM(COALESCE(t.check_amount, 0))    AS total_amount
FROM sage.gl_transactions t
LEFT JOIN sage.vendors     v
       ON v.source_company = t.source_company AND v.recnum = t.vendor_recnum
WHERE t.source_code = 1
  AND t.purchase_order IS NOT NULL
  AND t.purchase_order <> ''
GROUP BY t.source_company, t.purchase_order, t.vendor_recnum, v.vendor_name;

-- =====================================================================
--  CHANGE ORDERS
-- =====================================================================

-- Prime change orders with type label and job name.
CREATE OR REPLACE VIEW ops.change_orders AS
SELECT
    c.source_company,
    c.recnum               AS co_recnum,
    c.change_number,
    c.change_date,
    c.submitted_date,
    c.approved_date,
    c.invoiced_date,
    c.status,
    CASE c.status
        WHEN 0 THEN 'draft'
        WHEN 1 THEN 'submitted'
        WHEN 2 THEN 'approved'
        WHEN 3 THEN 'rejected'
        WHEN 4 THEN 'invoiced'
        WHEN 5 THEN 'paid'
        WHEN 6 THEN 'closed'
        ELSE 'other'
    END                    AS status_label,
    c.job_recnum,
    j.job_name             AS job_name,
    c.phase_recnum,
    c.purchase_order,
    c.change_type,
    t.type_name            AS change_type_name,
    c.description,
    c.reason,
    c.requested_amount,
    c.approved_amount,
    c.cost_amount,
    c.profit_amount,
    c.margin_amount,
    c.estimated_amount,
    c.acct_period,
    c.post_year,
    c.entered_by
FROM sage.prime_change_orders         c
LEFT JOIN sage.change_order_types_prime t
       ON t.source_company = c.source_company AND t.recnum = c.change_type
LEFT JOIN sage.jobs                    j
       ON j.source_company = c.source_company AND j.recnum = c.job_recnum;

-- Open change orders only (draft / submitted / approved-but-not-invoiced).
CREATE OR REPLACE VIEW ops.change_orders_pending AS
SELECT *
FROM ops.change_orders
WHERE status IN (0, 1, 2);

-- Subcontract change order lines.
CREATE OR REPLACE VIEW ops.subcontract_change_lines AS
SELECT
    s.source_company,
    s.recnum,
    s.line_number,
    s.change_number,
    s.change_date,
    s.change_status,
    s.description,
    s.cost_code,
    s.cost_type,
    s.change_hours,
    s.change_units,
    s.budget_price,
    s.overhead_markup,
    s.vendor_recnum,
    v.vendor_name
FROM sage.subcontract_changes s
LEFT JOIN sage.vendors        v
       ON v.source_company = s.source_company AND v.recnum = s.vendor_recnum;

-- =====================================================================
--  AR / AP INVOICE LINE ITEMS
--  (These are reconstructed from sage.job_cost_transactions whose
--   source_code identifies the originating module.)
-- =====================================================================

-- AR invoice lines = job-cost rows whose source = AR (source_code 2).
CREATE OR REPLACE VIEW ops.ar_invoice_lines AS
SELECT
    t.source_company,
    t.recnum,
    t.ar_invoice_recnum,
    t.trans_date         AS invoice_date,
    t.acct_period,
    t.post_year,
    t.job_recnum,
    j.job_name           AS job_name,
    t.phase_recnum,
    t.cost_code,
    t.cost_type,
    t.description,
    t.hours,
    t.billing_quantity,
    t.cost_amount,
    t.billing_amount,
    t.billing_total,
    t.trans_number       AS transaction_number
FROM sage.job_cost_transactions t
LEFT JOIN sage.jobs j
       ON j.source_company = t.source_company AND j.recnum = t.job_recnum
WHERE t.source_code = 2;

-- AP invoice lines = job-cost rows whose source = AP (source_code 1).
CREATE OR REPLACE VIEW ops.ap_invoice_lines AS
SELECT
    t.source_company,
    t.recnum,
    t.trans_date         AS invoice_date,
    t.acct_period,
    t.post_year,
    t.vendor_recnum,
    v.vendor_name,
    t.job_recnum,
    j.job_name           AS job_name,
    t.phase_recnum,
    t.cost_code,
    t.cost_type,
    t.description,
    t.hours,
    t.billing_quantity,
    t.cost_amount,
    t.billing_amount,
    t.trans_number       AS transaction_number
FROM sage.job_cost_transactions t
LEFT JOIN sage.vendors v
       ON v.source_company = t.source_company AND v.recnum = t.vendor_recnum
LEFT JOIN sage.jobs    j
       ON j.source_company = t.source_company AND j.recnum = t.job_recnum
WHERE t.source_code = 1;

-- =====================================================================
--  PAYROLL DETAIL  (timecard module)
-- =====================================================================

-- Daily payroll grain — one row per (employee × date × job × cost-code).
CREATE OR REPLACE VIEW ops.payroll_daily AS
SELECT
    t.source_company,
    t.recnum             AS payroll_recnum,
    t.line_number,
    t.work_date,
    t.day_of_week,
    t.description,
    t.work_order,
    t.job_recnum,
    j.job_name           AS job_name,
    t.phase_recnum,
    t.cost_code,
    cc.code_name         AS cost_code_name,
    t.pay_type,
    pt.type_name         AS pay_type_name,
    t.pay_group,
    pg.group_name        AS pay_group_name,
    t.hours_worked,
    t.pay_rate,
    t.comp_wage          AS gross_wage,
    t.comp_subject       AS comp_subject_amount,
    t.benefit_subject    AS benefit_subject_amount,
    t.absence,
    t.certified_payroll
FROM sage.timecard_lines t
LEFT JOIN sage.jobs       j  ON j.source_company  = t.source_company AND j.recnum  = t.job_recnum
LEFT JOIN sage.costcodes  cc ON cc.source_company = t.source_company AND cc.recnum = t.cost_code
LEFT JOIN sage.paytypes   pt ON pt.source_company = t.source_company AND pt.recnum = t.pay_type
LEFT JOIN sage.paygroups  pg ON pg.source_company = t.source_company AND pg.recnum = t.pay_group;

-- Burdened labor cost (wage + benefits + WC) rolled up by job + week.
CREATE OR REPLACE VIEW ops.payroll_burden_by_job AS
SELECT
    t.source_company,
    t.job_recnum,
    DATE_TRUNC('week', t.work_date)::DATE   AS week_starting,
    SUM(t.hours_worked)                      AS hours,
    SUM(t.comp_wage)                         AS gross_wage,
    SUM(COALESCE(t.comp_wage,0)) AS labor_cost
FROM sage.timecard_lines t
WHERE t.job_recnum IS NOT NULL
GROUP BY t.source_company, t.job_recnum, DATE_TRUNC('week', t.work_date);

-- Per-check benefit allocations.
CREATE OR REPLACE VIEW ops.payroll_benefits_by_check AS
SELECT
    b.source_company,
    b.recnum            AS payroll_recnum,
    b.group_number,
    b.deduction_number,
    b.deduction_name,
    b.deduction_rate,
    b.offset_amount,
    p.check_number,
    p.check_date,
    p.employee_recnum,
    e.first_name,
    e.last_name
FROM sage.timecard_benefits b
LEFT JOIN sage.payroll_records p
       ON p.source_company = b.source_company AND p.recnum = b.recnum
LEFT JOIN sage.employees e
       ON e.source_company = p.source_company AND e.recnum = p.employee_recnum;

-- Per-check deduction allocations.
CREATE OR REPLACE VIEW ops.payroll_deductions_by_check AS
SELECT
    d.source_company,
    d.recnum            AS payroll_recnum,
    d.calc_number,
    pd.calc_name        AS deduction_name,
    d.amount,
    d.state_wage,
    d.state_gross,
    d.ytd_amount,
    p.check_number,
    p.check_date,
    p.employee_recnum,
    e.first_name,
    e.last_name
FROM sage.timecard_deductions d
LEFT JOIN sage.paydeductions  pd
       ON pd.source_company = d.source_company AND pd.recnum = d.calc_number
LEFT JOIN sage.payroll_records p
       ON p.source_company = d.source_company AND p.recnum = d.recnum
LEFT JOIN sage.employees e
       ON e.source_company = p.source_company AND e.recnum = p.employee_recnum;

-- WC by job (assumes one WC code per check; aggregates by job).
CREATE OR REPLACE VIEW ops.payroll_wc_by_job AS
SELECT
    w.source_company,
    t.job_recnum,
    w.code_number,
    w.code_name,
    w.tax_state,
    SUM(w.employee_hours)        AS employee_hours,
    SUM(w.employer_hours)        AS employer_hours,
    SUM(w.liability_insurance)   AS liability_insurance
FROM sage.timecard_wc          w
JOIN sage.timecard_lines       t
  ON t.source_company = w.source_company AND t.recnum = w.recnum
GROUP BY w.source_company, t.job_recnum, w.code_number, w.code_name, w.tax_state;

-- The following views are dropped because the underlying Sage tables
-- (benfit, empqtd, emplic) do not expose the columns the target schema
-- assumed. Re-enable once the target schemas are redesigned.
DROP VIEW IF EXISTS ops.employee_benefits_enrollment;
DROP VIEW IF EXISTS ops.employee_ytd_totals;
DROP VIEW IF EXISTS ops.employee_licenses_expiring;

-- =====================================================================
--  Permissions for the new ops views.
-- =====================================================================
GRANT USAGE ON SCHEMA ops TO authenticated, anon, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA ops TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops
    GRANT SELECT ON TABLES TO authenticated, anon, service_role;
