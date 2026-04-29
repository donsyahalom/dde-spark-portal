"""
sage_queries.py
---------------
SQL queries against Sage 100 Contractor v27's SQL Server backend.

Schema notes from the v27 DuBaldo install (audited against the live DB):
    - Every business table lives in the `dbo` schema (there are parallel
      `dbo_Audit` and `dbo_SnapShot` schemas — we ignore them).
    - Table names are the legacy 6-char codes: lgract, lgrtrn, employ,
      payrec, actrec, actpay, acrinv, acpinv, bdglin, jobcst.
    - `recnum` is the stable bigint primary key on every table.
    - Booleans are stored as tinyint (0/1).
    - Dates use SQL Server's DATE / DATETIME types.

Each function returns (sql, params, column_mapping):
    - sql: the SELECT statement (uses `?` placeholders for pyodbc)
    - params: tuple of parameters matching the placeholders, or ()
    - column_mapping: dict mapping SELECT alias -> Supabase column name

The mapping layer lets us rename and reshape on the Python side if ever
needed; currently we just alias columns to their final Supabase names in
SQL and return identity mappings.
"""

from __future__ import annotations

from datetime import date


# ======================================================================
# General Ledger
# ======================================================================

def q_gl_accounts():
    sql = """
        SELECT
            recnum                         AS recnum,
            shtnme                         AS short_name,
            lngnme                         AS long_name,
            acttyp                         AS account_type,
            csttyp                         AS cost_type,
            endbal                         AS current_balance,
            begbal                         AS begin_balance,
            strbal                         AS start_balance,
            CASE WHEN ISNULL(subact,0)=1
                 THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS is_subaccount,
            sumact                         AS parent_account,
            CASE WHEN ISNULL(inactv,0)=1
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active
        FROM dbo.lgract
    """
    cols = ["recnum", "short_name", "long_name", "account_type", "cost_type",
            "current_balance", "begin_balance", "start_balance",
            "is_subaccount", "parent_account", "is_active"]
    return sql, (), {c: c for c in cols}


def q_gl_subaccounts():
    sql = """
        SELECT
            recnum                         AS recnum,
            ctract                         AS control_account,
            shtnme                         AS short_name,
            lngnme                         AS long_name,
            endbal                         AS current_balance,
            begbal                         AS begin_balance,
            CASE WHEN ISNULL(inactv,0)=1
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active
        FROM dbo.lgrsub
    """
    cols = ["recnum", "control_account", "short_name", "long_name",
            "current_balance", "begin_balance", "is_active"]
    return sql, (), {c: c for c in cols}


def q_gl_transactions(since: date):
    sql = """
        SELECT
            recnum       AS recnum,
            trnnum       AS trans_number,
            trndte       AS trans_date,
            actprd       AS acct_period,
            postyr       AS post_year,
            srcnum       AS source_code,
            status       AS status,
            dscrpt       AS description,
            pchord       AS purchase_order,
            vndnum       AS vendor_recnum,
            empnum       AS employee_recnum,
            payee1       AS payee1,
            payee2       AS payee2,
            chkamt       AS check_amount,
            entdte       AS entered_date,
            usrnme       AS entered_by
        FROM dbo.lgrtrn
        WHERE trndte >= ?
    """
    cols = ["recnum", "trans_number", "trans_date", "acct_period", "post_year",
            "source_code", "status", "description", "purchase_order",
            "vendor_recnum", "employee_recnum", "payee1", "payee2",
            "check_amount", "entered_date", "entered_by"]
    return sql, (since,), {c: c for c in cols}


# ======================================================================
# Payroll
# ======================================================================

def q_employees():
    sql = """
        SELECT
            recnum       AS recnum,
            fstnme       AS first_name,
            lstnme       AS last_name,
            midini       AS middle_initial,
            fullst       AS full_name,
            status       AS status,
            CASE WHEN ISNULL(inactv,0)=1
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active,
            emptyp       AS emp_type,
            payprd       AS pay_period,
            paygrp       AS pay_group,
            salary       AS salary,
            payrt1       AS pay_rate1,
            payrt2       AS pay_rate2,
            payrt3       AS pay_rate3,
            dtehre       AS hire_date,
            dteina       AS inactive_date,
            fstwrk       AS first_work_date,
            lstrse       AS last_raise_date,
            dtebth       AS birth_date,
            taxste       AS tax_state,
            e_mail       AS email,
            phnnum       AS phone,
            cllphn       AS cell_phone,
            addrs1       AS address1,
            addrs2       AS address2,
            ctynme       AS city,
            state_       AS state,
            zipcde       AS zip
        FROM dbo.employ
    """
    cols = ["recnum", "first_name", "last_name", "middle_initial", "full_name",
            "status", "is_active", "emp_type", "pay_period", "pay_group",
            "salary", "pay_rate1", "pay_rate2", "pay_rate3",
            "hire_date", "inactive_date", "first_work_date", "last_raise_date",
            "birth_date", "tax_state", "email", "phone", "cell_phone",
            "address1", "address2", "city", "state", "zip"]
    return sql, (), {c: c for c in cols}


def q_payroll_records(since: date):
    sql = """
        SELECT
            recnum       AS recnum,
            empnum       AS employee_recnum,
            strprd       AS period_start,
            payprd       AS period_end,
            chkdte       AS check_date,
            chknum       AS check_number,
            paytyp       AS pay_type,
            status       AS status,
            qtrnum       AS quarter,
            reghrs       AS regular_hours,
            ovthrs       AS overtime_hours,
            prmhrs       AS premium_hours,
            sckhrs       AS sick_hours,
            vachrs       AS vacation_hours,
            holhrs       AS holiday_hours,
            ttlhrs       AS total_hours,
            regpay       AS regular_pay,
            ovtpay       AS overtime_pay,
            prmpay       AS premium_pay,
            sckpay       AS sick_pay,
            vacpay       AS vacation_pay,
            holpay       AS holiday_pay,
            mscpay       AS miscellaneous_pay,
            grspay       AS gross_pay,
            dedttl       AS deductions_total,
            addttl       AS additions_total,
            netpay       AS net_pay,
            ytdgrs       AS ytd_gross,
            ytdnet       AS ytd_net,
            taxste       AS tax_state
        FROM dbo.payrec
        WHERE chkdte >= ?
    """
    cols = ["recnum", "employee_recnum", "period_start", "period_end",
            "check_date", "check_number", "pay_type", "status", "quarter",
            "regular_hours", "overtime_hours", "premium_hours", "sick_hours",
            "vacation_hours", "holiday_hours", "total_hours",
            "regular_pay", "overtime_pay", "premium_pay", "sick_pay",
            "vacation_pay", "holiday_pay", "miscellaneous_pay",
            "gross_pay", "deductions_total", "additions_total", "net_pay",
            "ytd_gross", "ytd_net", "tax_state"]
    return sql, (since,), {c: c for c in cols}


# ======================================================================
# AR / AP
# ======================================================================

def q_vendors():
    sql = """
        SELECT
            recnum       AS recnum,
            vndnme       AS vendor_name,
            shtnme       AS short_name,
            ownnme       AS owner_name,
            addrs1       AS address1,
            addrs2       AS address2,
            ctynme       AS city,
            state_       AS state,
            zipcde       AS zip,
            phnnum       AS phone,
            faxnum       AS fax,
            cllphn       AS cell_phone,
            e_mail       AS email,
            fedidn       AS fed_id,
            steidn       AS state_id,
            vndtyp       AS vendor_type,
            begbal       AS begin_balance,
            endbal       AS end_balance,
            CASE WHEN ISNULL(inactv,0)=1
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active,
            CASE WHEN ISNULL(hotlst,0)=1
                 THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS is_hotlist,
            CASE WHEN ISNULL(prt199,0)=1
                 THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS print_1099
        FROM dbo.actpay
    """
    cols = ["recnum", "vendor_name", "short_name", "owner_name",
            "address1", "address2", "city", "state", "zip",
            "phone", "fax", "cell_phone", "email",
            "fed_id", "state_id", "vendor_type",
            "begin_balance", "end_balance",
            "is_active", "is_hotlist", "print_1099"]
    return sql, (), {c: c for c in cols}


def q_ar_invoices(since: date):
    """Pull AR invoices dated since `since`. We do not filter by status so
    paid invoices within the lookback window are still refreshed (in case
    they changed). The script computes aging buckets client-side."""
    sql = """
        SELECT
            recnum       AS recnum,
            invnum       AS invoice_number,
            jobnum       AS job_recnum,
            phsnum       AS phase_recnum,
            invdte       AS invoice_date,
            duedte       AS due_date,
            dscdte       AS discount_date,
            invtyp       AS invoice_type,
            status       AS status,
            dscrpt       AS description,
            invttl       AS invoice_total,
            invbal       AS invoice_balance,
            invnet       AS invoice_net,
            amtpad       AS amount_paid,
            ttlpad       AS total_paid,
            retain       AS retainage,
            slstax       AS sales_tax,
            hldamt       AS hold_amount
        FROM dbo.acrinv
        WHERE invdte >= ? OR ISNULL(invbal, 0) <> 0
    """
    cols = ["recnum", "invoice_number", "job_recnum", "phase_recnum",
            "invoice_date", "due_date", "discount_date",
            "invoice_type", "status", "description",
            "invoice_total", "invoice_balance", "invoice_net",
            "amount_paid", "total_paid", "retainage", "sales_tax",
            "hold_amount"]
    return sql, (since,), {c: c for c in cols}


def q_ap_invoices(since: date):
    sql = """
        SELECT
            recnum       AS recnum,
            invnum       AS invoice_number,
            vndnum       AS vendor_recnum,
            jobnum       AS job_recnum,
            phsnum       AS phase_recnum,
            invdte       AS invoice_date,
            duedte       AS due_date,
            dscdte       AS discount_date,
            invtyp       AS invoice_type,
            status       AS status,
            dscrpt       AS description,
            invttl       AS invoice_total,
            invbal       AS invoice_balance,
            invnet       AS invoice_net,
            amtpad       AS amount_paid,
            ttlpad       AS total_paid,
            retain       AS retainage,
            slstax       AS sales_tax,
            hldamt       AS hold_amount
        FROM dbo.acpinv
        WHERE invdte >= ? OR ISNULL(invbal, 0) <> 0
    """
    cols = ["recnum", "invoice_number", "vendor_recnum", "job_recnum",
            "phase_recnum", "invoice_date", "due_date", "discount_date",
            "invoice_type", "status", "description",
            "invoice_total", "invoice_balance", "invoice_net",
            "amount_paid", "total_paid", "retainage", "sales_tax",
            "hold_amount"]
    return sql, (since,), {c: c for c in cols}


# ======================================================================
# Jobs / Job Cost
# ======================================================================

def q_jobs():
    sql = """
        SELECT
            recnum       AS recnum,
            jobnme       AS job_name,
            shtnme       AS short_name,
            clnnum       AS client_number,
            contct       AS contact,
            addrs1       AS address1,
            addrs2       AS address2,
            ctynme       AS city,
            state_       AS state,
            zipcde       AS zip,
            county       AS county,
            phnnum       AS phone,
            faxnum       AS fax,
            status       AS status,
            jobtyp       AS job_type,
            cntrct       AS contract_amount,
            retain       AS retainage,
            finchg       AS finance_charge,
            begbal       AS begin_balance,
            endbal       AS end_balance,
            biddte       AS bid_date,
            ctcdte       AS contract_date,
            sttdte       AS start_date,
            cmpdte       AS complete_date,
            awddte       AS awarded_date,
            strdte       AS actual_start_date,
            dtecmp       AS actual_complete_date,
            pctcmp       AS percent_complete,
            typwrk       AS type_of_work,
            CASE WHEN ISNULL(inactv,0)=1
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active
        FROM dbo.actrec
    """
    cols = ["recnum", "job_name", "short_name", "client_number", "contact",
            "address1", "address2", "city", "state", "zip", "county",
            "phone", "fax", "status", "job_type",
            "contract_amount", "retainage", "finance_charge",
            "begin_balance", "end_balance",
            "bid_date", "contract_date", "start_date", "complete_date",
            "awarded_date", "actual_start_date", "actual_complete_date",
            "percent_complete", "type_of_work", "is_active"]
    return sql, (), {c: c for c in cols}


def q_job_cost_transactions(since: date):
    """Job cost ledger detail (jobcst). Can be a large table — this is the
    biggest query in the sync. The WHERE clause keeps it bounded."""
    sql = """
        SELECT
            recnum       AS recnum,
            jobnum       AS job_recnum,
            phsnum       AS phase_recnum,
            cstcde       AS cost_code,
            csttyp       AS cost_type,
            vndnum       AS vendor_recnum,
            eqpnum       AS equipment_recnum,
            empnum       AS employee_recnum,
            payrec       AS payroll_recnum,
            acrinv       AS ar_invoice_recnum,
            trnnum       AS trans_number,
            trndte       AS trans_date,
            entdte       AS entered_date,
            actprd       AS acct_period,
            postyr       AS post_year,
            srcnum       AS source_code,
            status       AS status,
            bllsts       AS billing_status,
            dscrpt       AS description,
            csthrs       AS hours,
            cstamt       AS cost_amount,
            blgamt       AS billing_amount,
            blgqty       AS billing_quantity,
            blgttl       AS billing_total
        FROM dbo.jobcst
        WHERE trndte >= ?
    """
    cols = ["recnum", "job_recnum", "phase_recnum", "cost_code", "cost_type",
            "vendor_recnum", "equipment_recnum", "employee_recnum",
            "payroll_recnum", "ar_invoice_recnum",
            "trans_number", "trans_date", "entered_date",
            "acct_period", "post_year", "source_code",
            "status", "billing_status", "description",
            "hours", "cost_amount",
            "billing_amount", "billing_quantity", "billing_total"]
    return sql, (since,), {c: c for c in cols}


def q_job_budget_lines():
    """bdglin = budget line items. The `recnum` here is the JOB's recnum
    (bdglin is a child table keyed by job), combined with phase + line."""
    sql = """
        SELECT
            recnum       AS job_recnum,
            phsnum       AS phase_recnum,
            linnum       AS line_number,
            cstcde       AS cost_code,
            hrsbdg       AS hours_budget,
            matbdg       AS material_budget,
            labbdg       AS labor_budget,
            eqpbdg       AS equipment_budget,
            subbdg       AS subcontract_budget,
            othbdg       AS other_budget,
            ttlbdg       AS total_budget,
            hrsorg       AS hours_original,
            matorg       AS material_original,
            laborg       AS labor_original,
            eqporg       AS equipment_original,
            suborg       AS subcontract_original,
            othorg       AS other_original,
            ttlorg       AS total_original,
            untdsc       AS unit_description,
            estunt       AS estimated_units,
            untcst       AS unit_cost
        FROM dbo.bdglin
    """
    cols = ["job_recnum", "phase_recnum", "line_number", "cost_code",
            "hours_budget", "material_budget", "labor_budget",
            "equipment_budget", "subcontract_budget", "other_budget",
            "total_budget",
            "hours_original", "material_original", "labor_original",
            "equipment_original", "subcontract_original", "other_original",
            "total_original",
            "unit_description", "estimated_units", "unit_cost"]
    return sql, (), {c: c for c in cols}
