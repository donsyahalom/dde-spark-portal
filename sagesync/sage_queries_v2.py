"""
sage_queries_v2.py
------------------
Additional Sage 100 Contractor v27 queries layered on top of sage_queries.py.

Coverage in v2 (validated against the live DuBaldo install via the
discover_payroll_tables.sql + discover_service_po_tables.sql output):

    PAYROLL DETAIL (timecard module — daily grain)
        q_timecard_lines        tmcdln    11,030 rows, daily breakdown
        q_timecard_deductions   tmcddd    26,527 rows, per-check deductions
        q_timecard_benefits     tmcdbn     3,148 rows, per-check benefits
        q_timecard_wc           tmcdwc     2,198 rows, per-check WC
        q_timecard_paygroups    tmcdpg     1,056 rows, per-check pay-group
        q_paytypes              paytyp        9    master
        q_paygroups             paygrp      130    master
        q_paydeductions         payded       56    master (calc/tax types)
        q_payunions             payuni        9    master
        q_benefits              benfit      276    benefit enrollments
        q_costcodes             cstcde      101    cost-code master (DECIMAL key)
        q_empabsence            empabs        9    absence-reason master
        q_employee_pay          emppay      484    rate-change history
        q_employee_qtd          empqtd    2,012    quarterly totals
        q_employee_hires        emphre      383    hire/status history
        q_employee_licenses     emplic      352    licenses with expiry

    SERVICE RECEIVABLES
        q_service_invoices      srvinv    4,188
        q_service_invoice_lines srvlin    9,063
        q_service_payments      srvpmt    3,446
        q_service_schedule      srvsch    2,064
        q_service_clients       reccln    1,361
        q_service_locations     srvloc      704
        q_service_types         srvtyp       11    master
        q_service_geo           srvgeo       14    master

    PURCHASE ORDERS (live header only — historical PO spend reconstructed
                     via acpinv.pchord, see ops_views_v2.sql)
        q_purchase_orders       pchord       32

    CHANGE ORDERS
        q_prime_change_orders   prmchg      383
        q_subcontract_changes   sbcgln      570
        q_change_order_types    cortyp + chgtyp (master)
"""
from __future__ import annotations

from datetime import date


# ======================================================================
#  PAYROLL DETAIL  —  Timecard module (daily grain)
# ======================================================================

def q_timecard_lines(since: date):
    """tmcdln — the table the daily-burden views are built on. Each row
    is one (employee × date × job × phase × cost-code) hour entry."""
    sql = """
        SELECT
            recnum            AS recnum,
            linnum            AS line_number,
            dtewrk            AS work_date,
            daywrk            AS day_of_week,
            dscrpt            AS description,
            wrkord            AS work_order,
            jobnum            AS job_recnum,
            eqpnum            AS equipment_recnum,
            phsnum            AS phase_recnum,
            cstcde            AS cost_code,
            paytyp            AS pay_type,
            paygrp            AS pay_group,
            payrte            AS pay_rate,
            hrswrk            AS hours_worked,
            pcerte            AS piece_rate,
            pieces            AS pieces,
            cmpcde            AS comp_code,
            dptmnt            AS department,
            jobcst            AS job_cost,
            cmpsub            AS comp_subject,
            bensub            AS benefit_subject,
            cmpwge            AS comp_wage,
            cmpgrs            AS comp_gross,
            absnce            AS absence,
            ovtdif            AS ot_differential,
            loctax            AS local_tax,
            crtfid            AS certified_payroll
        FROM dbo.tmcdln
        WHERE dtewrk >= ?
    """
    cols = ["recnum", "line_number", "work_date", "day_of_week", "description",
            "work_order", "job_recnum", "equipment_recnum", "phase_recnum",
            "cost_code", "pay_type", "pay_group", "pay_rate", "hours_worked",
            "piece_rate", "pieces", "comp_code", "department",
            "job_cost", "comp_subject", "benefit_subject",
            "comp_wage", "comp_gross", "absence", "ot_differential",
            "local_tax", "certified_payroll"]
    return sql, (since,), {c: c for c in cols}


def q_timecard_deductions(since: date):
    """tmcddd — per-check deduction lines. Joined to payrec by recnum.

    Note: tmcddd.ovrrid is nvarchar(2) in Sage ('T'/'F'/'N'/'Y' or empty),
    but the target sage.timecard_deductions.override column is SMALLINT.
    Coerce the text flag to 1/0 in the SELECT so psycopg2 doesn't reject
    'N' as InvalidTextRepresentation."""
    sql = """
        SELECT
            d.recnum          AS recnum,
            d.clcnum          AS calc_number,
            d.amount          AS amount,
            CASE
                WHEN d.ovrrid IN ('T', 'Y', '1') THEN 1
                WHEN d.ovrrid IN ('F', 'N', '0', '') THEN 0
                WHEN d.ovrrid IS NULL THEN NULL
                ELSE TRY_CAST(d.ovrrid AS SMALLINT)
            END               AS override,
            d.stewge          AS state_wage,
            d.stegrs          AS state_gross,
            d.ytdamt          AS ytd_amount
        FROM dbo.tmcddd d
        JOIN dbo.payrec p ON p.recnum = d.recnum
        WHERE p.chkdte >= ?
    """
    cols = ["recnum", "calc_number", "amount", "override",
            "state_wage", "state_gross", "ytd_amount"]
    return sql, (since,), {c: c for c in cols}


def q_timecard_benefits(since: date):
    """tmcdbn — per-check benefit allocations."""
    sql = """
        SELECT
            b.recnum          AS recnum,
            b.grpnum          AS group_number,
            b.dednum          AS deduction_number,
            b.dednme          AS deduction_name,
            b.dedrte          AS deduction_rate,
            b.offset          AS offset_amount
        FROM dbo.tmcdbn b
        JOIN dbo.payrec p ON p.recnum = b.recnum
        WHERE p.chkdte >= ?
    """
    cols = ["recnum", "group_number", "deduction_number", "deduction_name",
            "deduction_rate", "offset_amount"]
    return sql, (since,), {c: c for c in cols}


def q_timecard_wc(since: date):
    """tmcdwc — per-check workers' comp."""
    sql = """
        SELECT
            w.recnum          AS recnum,
            w.cdenum          AS code_number,
            w.cdenme          AS code_name,
            w.taxste          AS tax_state,
            w.pctrte          AS percent_rate,
            w.emehrs          AS employee_hours,
            w.emrhrs          AS employer_hours,
            w.libins          AS liability_insurance,
            w.expmod          AS experience_mod,
            w.addmod          AS additional_mod,
            w.maxwge          AS max_wage
        FROM dbo.tmcdwc w
        JOIN dbo.payrec p ON p.recnum = w.recnum
        WHERE p.chkdte >= ?
    """
    cols = ["recnum", "code_number", "code_name", "tax_state", "percent_rate",
            "employee_hours", "employer_hours", "liability_insurance",
            "experience_mod", "additional_mod", "max_wage"]
    return sql, (since,), {c: c for c in cols}


def q_timecard_paygroups(since: date):
    """tmcdpg — per-check pay-group / certified-payroll bracket."""
    sql = """
        SELECT
            g.recnum          AS recnum,
            g.grpnum          AS group_number,
            g.grpnme          AS group_name,
            g.wrkcls          AS work_class,
            g.clslvl          AS class_level,
            g.clsprc          AS class_percent,
            g.clscde          AS class_code,
            g.payrt1          AS pay_rate1,
            g.payrt2          AS pay_rate2,
            g.payrt3          AS pay_rate3,
            g.pcerte          AS piece_rate
        FROM dbo.tmcdpg g
        JOIN dbo.payrec p ON p.recnum = g.recnum
        WHERE p.chkdte >= ?
    """
    cols = ["recnum", "group_number", "group_name", "work_class",
            "class_level", "class_percent", "class_code",
            "pay_rate1", "pay_rate2", "pay_rate3", "piece_rate"]
    return sql, (since,), {c: c for c in cols}


# ----------------------------------------------------------------------
#  PAYROLL MASTERS (full-refresh on every run — small tables)
# ----------------------------------------------------------------------

def q_paytypes():
    sql = """
        SELECT recnum, typnme AS type_name
        FROM dbo.paytyp
    """
    return sql, (), {"recnum": "recnum", "type_name": "type_name"}


def q_paygroups():
    sql = """
        SELECT
            recnum, grpnme AS group_name, wrkcls AS work_class,
            clslvl AS class_level
        FROM dbo.paygrp
    """
    cols = ["recnum", "group_name", "work_class", "class_level"]
    return sql, (), {c: c for c in cols}


def q_paydeductions():
    """payded — calculation/deduction master. Note: bnftyp links benefit
    type, ssctax/medcre/fedtax/stetax/wkrcmp/libins/loctax are tax flags."""
    sql = """
        SELECT
            recnum,
            clcnme AS calc_name,
            dftrte AS default_rate,
            dftmax AS default_max,
            ssctax AS social_security_tax,
            medcre AS medicare_tax,
            fedtax AS federal_tax,
            stetax AS state_tax,
            wkrcmp AS workers_comp,
            libins AS liability_insurance,
            loctax AS local_tax,
            bnftyp AS benefit_type,
            sckelg AS sick_eligible,
            sckmax AS sick_max,
            sckcry AS sick_carryover,
            sckaco AS sick_accrual_method
        FROM dbo.payded
    """
    cols = ["recnum", "calc_name", "default_rate", "default_max",
            "social_security_tax", "medicare_tax", "federal_tax",
            "state_tax", "workers_comp", "liability_insurance", "local_tax",
            "benefit_type", "sick_eligible", "sick_max", "sick_carryover",
            "sick_accrual_method"]
    return sql, (), {c: c for c in cols}


def q_payunions():
    sql = """
        SELECT recnum, uninme AS union_name
        FROM dbo.payuni
    """
    return sql, (), {"recnum": "recnum",
                     "union_name": "union_name"}


# q_benefits: DROPPED. The real benfit table is (paygrp, dednum, dedrte) only —
# a paygroup->deduction rate lookup, NOT an employee enrollment table. The
# target sage.benefits schema models employee enrollments (empnum, dates,
# amounts) which do not exist in the source. Remove from catalog until the
# schema is redesigned to match the real Sage data model.


def q_costcodes():
    """cstcde — cost-code master. Note: recnum is DECIMAL(15,3), not
    bigint, because cost codes are hierarchical (e.g. 01.0000.010).
    inactv is nvarchar(2) in Sage (typically 'T' or '' / NULL)."""
    sql = """
        SELECT
            recnum,
            cdenme AS code_name,
            untdsc AS unit_description,
            CASE WHEN inactv = 'T'
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active
        FROM dbo.cstcde
    """
    cols = ["recnum", "code_name", "unit_description", "is_active"]
    return sql, (), {c: c for c in cols}


def q_empabsence():
    sql = """
        SELECT recnum, resabs AS absence_name
        FROM dbo.empabs
    """
    return sql, (), {"recnum": "recnum",
                     "absence_name": "absence_name"}


# q_employee_pay: DROPPED. Real emppay has no recnum, and its columns
# (chgdte, rtetyp, orgamt, chgamt, pctchg, newamt) model a rate-change
# log, not the (pay_rate, effective_date, pay_period) rate-period table
# the target schema expects. Flag for schema redesign.

# q_employee_qtd: DROPPED. Real empqtd does not have empnum, qtrnum,
# yearno, qtdamt, qtdsbj, ytdamt, or ytdsbj. It stores one row per
# (recnum, clcnum) with dedrte/dedmax and fstqtr..fthqtr rolling totals.
# Incompatible with the target schema's year/quarter/ytd model.

# q_employee_hires: DROPPED. Real emphre has no recnum and no trmdte;
# it is a per-employee status-change log keyed on (empnum, chgdte).
# The target sage.employee_hires schema (hire_date, term_date,
# status_code) does not match.

# q_employee_licenses: DROPPED. Real emplic has no recnum, no licnme,
# and no issdte. It stores one row per (empnum, typnum, licnum, expdte).
# Target schema expects license_name + issue_date which don't exist.


# ======================================================================
#  SERVICE RECEIVABLES
# ======================================================================

def q_service_invoices(since: date):
    """srvinv — service invoice header. Carries the full
    call/dispatch/schedule/start/finish timeline as well as the dollars."""
    sql = """
        SELECT
            recnum,
            ordnum AS service_order_number,
            invnum AS invoice_number,
            clnnum AS client_recnum,
            jobnum AS job_recnum,
            locnum AS location_recnum,
            empnum AS employee_recnum,
            slspsn AS salesperson_recnum,
            srvgeo AS service_geo,
            rutnum AS route_number,
            orddte AS order_date,
            invdte AS invoice_date,
            duedte AS due_date,
            dscdte AS discount_date,
            clldte AS call_date,
            dspdte AS dispatch_date,
            schdte AS scheduled_date,
            strdte AS started_date,
            findte AS finished_date,
            bildte AS billed_date,
            schhrs AS scheduled_hours,
            acthrs AS actual_hours,
            dscrpt AS description,
            ctcnme AS contact_name,
            phnnum AS phone,
            addrs1 AS address1,
            addrs2 AS address2,
            ctynme AS city,
            state_ AS state,
            zipcde AS zip,
            invtyp AS invoice_type,
            status AS status,
            priort AS priority,
            invsrc AS invoice_source,
            pmttyp AS payment_type,
            invttl AS invoice_total,
            invbal AS invoice_balance,
            invnet AS invoice_net,
            taxabl AS taxable,
            nontax AS non_taxable,
            ttlpad AS total_paid,
            slstax AS sales_tax,
            depost AS deposit,
            dscavl AS discount_available,
            dsctkn AS discount_taken,
            actper AS acct_period,
            postyr AS post_year,
            entdte AS entered_date,
            usrnme AS entered_by
        FROM dbo.srvinv
        WHERE COALESCE(invdte, orddte) >= ?
           OR COALESCE(invbal, 0) <> 0
    """
    cols = ["recnum", "service_order_number", "invoice_number", "client_recnum",
            "job_recnum", "location_recnum", "employee_recnum",
            "salesperson_recnum", "service_geo", "route_number",
            "order_date", "invoice_date", "due_date", "discount_date",
            "call_date", "dispatch_date", "scheduled_date",
            "started_date", "finished_date", "billed_date",
            "scheduled_hours", "actual_hours", "description",
            "contact_name", "phone", "address1", "address2",
            "city", "state", "zip",
            "invoice_type", "status", "priority", "invoice_source",
            "payment_type",
            "invoice_total", "invoice_balance", "invoice_net",
            "taxable", "non_taxable", "total_paid", "sales_tax",
            "deposit", "discount_available", "discount_taken",
            "acct_period", "post_year", "entered_date", "entered_by"]
    return sql, (since,), {c: c for c in cols}


def q_service_invoice_lines(since: date):
    """srvlin — service invoice line items. Filtered by the parent invoice's
    date so we don't pull every line ever every run."""
    sql = """
        SELECT
            l.recnum         AS recnum,
            l.linnum         AS line_number,
            l.asmnum         AS assembly_recnum,
            l.prtnum         AS part_recnum,
            l.dscrpt         AS description,
            l.alpnum         AS alpha_number,
            l.untdsc         AS unit_description,
            l.prtqty         AS part_quantity,
            l.prtprc         AS part_price,
            l.extqty         AS extended_quantity,
            l.extprc         AS extended_price,
            l.tktnum         AS ticket_number,
            l.csttyp         AS cost_type,
            l.eqpnum         AS equipment_recnum,
            l.clnnum         AS client_recnum,
            l.actnum         AS account_recnum,
            l.subact         AS subaccount_recnum,
            l.invloc         AS inventory_location,
            l.curbll         AS current_billing,
            l.gstamt         AS gst_amount,
            l.pstamt         AS pst_amount,
            l.hstamt         AS hst_amount
        FROM dbo.srvlin l
        JOIN dbo.srvinv h ON h.recnum = l.recnum
        WHERE COALESCE(h.invdte, h.orddte) >= ?
           OR COALESCE(h.invbal, 0) <> 0
    """
    cols = ["recnum", "line_number", "assembly_recnum", "part_recnum",
            "description", "alpha_number", "unit_description",
            "part_quantity", "part_price", "extended_quantity",
            "extended_price", "ticket_number", "cost_type",
            "equipment_recnum", "client_recnum",
            "account_recnum", "subaccount_recnum", "inventory_location",
            "current_billing", "gst_amount", "pst_amount", "hst_amount"]
    return sql, (since,), {c: c for c in cols}


def q_service_payments(since: date):
    """srvpmt — payments applied against service invoices.

    Note: srvpmt.recnum is the parent srvinv reference, NOT a unique
    row id — a single invoice may have many payment rows. We surface
    Sage's _idnum (uniqueidentifier) as payment_id so the target table
    has a real PK. Cast to NVARCHAR so pyodbc returns it as a stable
    36-char string that psycopg2 can hand to a Postgres UUID column."""
    sql = """
        SELECT
            CAST(_idnum AS NVARCHAR(36)) AS payment_id,
            recnum         AS recnum,
            dscrpt         AS description,
            chknum         AS check_number,
            chkdte         AS check_date,
            actper         AS acct_period,
            postyr         AS post_year,
            amount         AS amount,
            dsctkn         AS discount_taken,
            aplcrd         AS applied_credit,
            lgrrec         AS ledger_recnum
        FROM dbo.srvpmt
        WHERE chkdte >= ?
    """
    cols = ["payment_id", "recnum", "description", "check_number", "check_date",
            "acct_period", "post_year", "amount", "discount_taken",
            "applied_credit", "ledger_recnum"]
    return sql, (since,), {c: c for c in cols}


def q_service_schedule(since: date):
    """srvsch — dispatched / scheduled service visits."""
    sql = """
        SELECT
            recnum         AS recnum,
            linnum         AS line_number,
            empnum         AS employee_recnum,
            eqpnum         AS equipment_recnum,
            vndnum         AS vendor_recnum,
            priort         AS priority,
            schdte         AS scheduled_date,
            schstr         AS scheduled_start_time,
            schfin         AS scheduled_finish_time,
            esthrs         AS estimated_hours,
            tvltim         AS travel_time,
            findte         AS finished_date,
            actstr         AS actual_start_time,
            actfin         AS actual_finish_time,
            acthrs         AS actual_hours,
            bildte         AS billed_date
        FROM dbo.srvsch
        WHERE COALESCE(schdte, findte) >= ?
    """
    cols = ["recnum", "line_number", "employee_recnum", "equipment_recnum",
            "vendor_recnum", "priority", "scheduled_date",
            "scheduled_start_time", "scheduled_finish_time", "estimated_hours",
            "travel_time", "finished_date", "actual_start_time",
            "actual_finish_time", "actual_hours", "billed_date"]
    return sql, (since,), {c: c for c in cols}


def q_service_clients():
    """reccln — service client master (separate from job customers)."""
    sql = """
        SELECT
            recnum,
            shtnme AS short_name,
            clnnme AS client_name,
            grting AS greeting,
            addrs1 AS address1,
            addrs2 AS address2,
            ctynme AS city,
            state_ AS state,
            zipcde AS zip,
            bilad1 AS billing_address1,
            bilad2 AS billing_address2,
            bilcty AS billing_city,
            bilste AS billing_state,
            bilzip AS billing_zip,
            shpad1 AS shipping_address1,
            shpad2 AS shipping_address2,
            shpcty AS shipping_city,
            shpste AS shipping_state,
            shpzip AS shipping_zip,
            contct AS contact1,
            contc2 AS contact2,
            contc3 AS contact3,
            phnnum AS phone1,
            phn002 AS phone2,
            phn003 AS phone3,
            faxnum AS fax,
            cllphn AS cell_phone,
            e_mail AS email,
            email2 AS email2,
            email3 AS email3,
            empnum AS sales_employee_recnum,
            taxdst AS tax_district,
            lstdte AS last_service_date,
            srvcon AS service_contract_flag,
            srvexp AS service_contract_expiry,
            clntyp AS client_type,
            status AS status,
            begbal AS begin_balance,
            endbal AS end_balance,
            CASE WHEN ISNULL(inactv,0)=1
                 THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS is_active
        FROM dbo.reccln
    """
    cols = ["recnum", "short_name", "client_name", "greeting",
            "address1", "address2", "city", "state", "zip",
            "billing_address1", "billing_address2", "billing_city",
            "billing_state", "billing_zip",
            "shipping_address1", "shipping_address2", "shipping_city",
            "shipping_state", "shipping_zip",
            "contact1", "contact2", "contact3",
            "phone1", "phone2", "phone3", "fax", "cell_phone",
            "email", "email2", "email3",
            "sales_employee_recnum", "tax_district",
            "last_service_date", "service_contract_flag",
            "service_contract_expiry", "client_type", "status",
            "begin_balance", "end_balance", "is_active"]
    return sql, (), {c: c for c in cols}


def q_service_locations():
    sql = """
        SELECT
            recnum,
            locnum AS location_number,
            locnme AS location_name,
            addrs1 AS address1,
            addrs2 AS address2,
            ctynme AS city,
            state_ AS state,
            zipcde AS zip,
            phnnum AS phone,
            contct AS contact,
            srvgeo AS service_geo,
            taxdst AS tax_district
        FROM dbo.srvloc
    """
    cols = ["recnum", "location_number", "location_name",
            "address1", "address2", "city", "state", "zip",
            "phone", "contact", "service_geo", "tax_district"]
    return sql, (), {c: c for c in cols}


def q_service_types():
    sql = """
        SELECT
            recnum,
            typnme AS type_name,
            typclr AS type_color,
            dptmnt AS department_recnum,
            cstcde AS cost_code,
            csttyp AS cost_type
        FROM dbo.srvtyp
    """
    cols = ["recnum", "type_name", "type_color", "department_recnum",
            "cost_code", "cost_type"]
    return sql, (), {c: c for c in cols}


def q_service_geo():
    sql = """
        SELECT recnum, dscrpt AS description, geoclr AS color
        FROM dbo.srvgeo
    """
    return sql, (), {"recnum": "recnum",
                     "description": "description",
                     "color": "color"}


# ======================================================================
#  PURCHASE ORDERS
# ======================================================================

def q_purchase_orders():
    """pchord — currently 32 rows in DuBaldo (live POs only). Historical
    PO spend is reconstructed from acpinv.pchord. Always full-refresh."""
    sql = """
        SELECT
            recnum,
            ordnum AS order_number,
            orddte AS order_date,
            vndnum AS vendor_recnum,
            attion AS attention,
            odrdby AS ordered_by_recnum,
            jobnum AS job_recnum,
            phsnum AS phase_recnum,
            eqpmnt AS equipment_recnum,
            dscrpt AS description,
            docnum AS document_number,
            docsrc AS document_source,
            taxdst AS tax_district,
            appdte AS approved_date,
            schdte AS scheduled_date,
            deldte AS delivery_date,
            delvia AS delivery_via,
            ordtrm AS order_terms,
            ordtyp AS order_type,
            status AS status,
            addrs1 AS ship_to_address1,
            addrs2 AS ship_to_address2,
            ctynme AS ship_to_city,
            state_ AS ship_to_state,
            zipcde AS ship_to_zip,
            rcvdte AS received_amount,
            currnt AS current_amount,
            cancel AS cancelled_amount,
            subttl AS subtotal,
            slstax AS sales_tax,
            pchttl AS po_total,
            pchbal AS po_balance,
            entdte AS entered_date,
            usrnme AS entered_by,
            issdat AS issued_date,
            issbch AS issue_batch
        FROM dbo.pchord
    """
    cols = ["recnum", "order_number", "order_date", "vendor_recnum",
            "attention", "ordered_by_recnum", "job_recnum", "phase_recnum",
            "equipment_recnum", "description", "document_number",
            "document_source", "tax_district", "approved_date",
            "scheduled_date", "delivery_date", "delivery_via",
            "order_terms", "order_type", "status",
            "ship_to_address1", "ship_to_address2", "ship_to_city",
            "ship_to_state", "ship_to_zip",
            "received_amount", "current_amount", "cancelled_amount",
            "subtotal", "sales_tax", "po_total", "po_balance",
            "entered_date", "entered_by", "issued_date", "issue_batch"]
    return sql, (), {c: c for c in cols}


# ======================================================================
#  CHANGE ORDERS
# ======================================================================

def q_prime_change_orders(since: date):
    """prmchg — prime contract change orders."""
    sql = """
        SELECT
            recnum,
            chgnum AS change_number,
            chgdte AS change_date,
            jobnum AS job_recnum,
            phsnum AS phase_recnum,
            pchord AS purchase_order,
            chgtyp AS change_type,
            status AS status,
            dscrpt AS description,
            reason AS reason,
            chgscp AS change_scope,
            subdte AS submitted_date,
            aprdte AS approved_date,
            invdte AS invoiced_date,
            entdte AS entered_date,
            delreq AS delivery_request_days,
            dysdly AS days_delay,
            submto AS submitted_to,
            submby AS submitted_by_recnum,
            reqamt AS requested_amount,
            appamt AS approved_amount,
            cstamt AS cost_amount,
            ovhamt AS overhead_amount,
            pftamt AS profit_amount,
            reqpft AS requested_profit,
            mrgamt AS margin_amount,
            reqmrg AS requested_margin,
            estamt AS estimated_amount,
            estovh AS estimated_overhead,
            actper AS acct_period,
            postyr AS post_year,
            usrnme AS entered_by
        FROM dbo.prmchg
        WHERE COALESCE(chgdte, entdte) >= ?
           OR status IN (0, 1, 2)   -- always refresh open/pending COs
    """
    cols = ["recnum", "change_number", "change_date", "job_recnum",
            "phase_recnum", "purchase_order", "change_type", "status",
            "description", "reason", "change_scope",
            "submitted_date", "approved_date", "invoiced_date",
            "entered_date", "delivery_request_days", "days_delay",
            "submitted_to", "submitted_by_recnum",
            "requested_amount", "approved_amount", "cost_amount",
            "overhead_amount", "profit_amount", "requested_profit",
            "margin_amount", "requested_margin",
            "estimated_amount", "estimated_overhead",
            "acct_period", "post_year", "entered_by"]
    return sql, (since,), {c: c for c in cols}


def q_subcontract_changes(since: date):
    """sbcgln — subcontract change-order line items."""
    sql = """
        SELECT
            s.recnum         AS recnum,
            s.linnum         AS line_number,
            s.dscrpt         AS description,
            s.chghrs         AS change_hours,
            s.chgunt         AS change_units,
            s.bdgprc         AS budget_price,
            s.vndnum         AS vendor_recnum,
            s.vndctc         AS vendor_contract_recnum,
            s.ctclin         AS contract_line_number,
            s.chgnum         AS change_number,
            s.chgsts         AS change_status,
            s.chgdte         AS change_date,
            s.cstcde         AS cost_code,
            s.csttyp         AS cost_type,
            s.ovhmrk         AS overhead_markup
        FROM dbo.sbcgln s
        WHERE s.chgdte >= ?
    """
    cols = ["recnum", "line_number", "description", "change_hours",
            "change_units", "budget_price", "vendor_recnum",
            "vendor_contract_recnum", "contract_line_number",
            "change_number", "change_status", "change_date",
            "cost_code", "cost_type", "overhead_markup"]
    return sql, (since,), {c: c for c in cols}


def q_change_order_types_prime():
    """chgtyp — prime change order type master."""
    sql = """
        SELECT recnum, typnme AS type_name
        FROM dbo.chgtyp
    """
    return sql, (), {"recnum": "recnum", "type_name": "type_name"}


def q_change_order_types_corresp():
    """cortyp — correspondence type master (used by coresp)."""
    sql = """
        SELECT recnum, typnme AS type_name
        FROM dbo.cortyp
    """
    return sql, (), {"recnum": "recnum", "type_name": "type_name"}
