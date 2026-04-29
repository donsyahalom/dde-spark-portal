-- =====================================================================
-- Migration: fix CardinalityViolation on service_locations + service_payments
-- =====================================================================
-- Both tables had PK (source_company, recnum), but in Sage:
--   * srvloc.recnum is the parent CLIENT ref — multiple locations
--     per client share the same recnum. Real unique row = (recnum, locnum).
--   * srvpmt.recnum is the parent INVOICE ref — multiple payments
--     per invoice share the same recnum. Sage's only guaranteed unique
--     row id is _idnum (uniqueidentifier). We mirror that as payment_id.
--
-- Both target tables are empty in UAT (loads have only failed so far),
-- so this migration is safe to run as-is. Idempotent.
-- =====================================================================

-- ---------- service_locations: PK -> (source_company, recnum, location_number)

ALTER TABLE sage.service_locations DROP CONSTRAINT IF EXISTS service_locations_pkey;

-- Drop any rows where location_number is NULL (defensive — should be none)
DELETE FROM sage.service_locations WHERE location_number IS NULL;

ALTER TABLE sage.service_locations ALTER COLUMN location_number SET NOT NULL;

ALTER TABLE sage.service_locations
    ADD CONSTRAINT service_locations_pkey
    PRIMARY KEY (source_company, recnum, location_number);

CREATE INDEX IF NOT EXISTS idx_srvloc_recnum ON sage.service_locations (recnum);


-- ---------- service_payments: add payment_id UUID, PK -> (source_company, payment_id)

ALTER TABLE sage.service_payments DROP CONSTRAINT IF EXISTS service_payments_pkey;

ALTER TABLE sage.service_payments ADD COLUMN IF NOT EXISTS payment_id UUID;

-- Defensive: if any rows exist without payment_id, mint UUIDs so SET NOT NULL succeeds.
UPDATE sage.service_payments SET payment_id = gen_random_uuid() WHERE payment_id IS NULL;

ALTER TABLE sage.service_payments ALTER COLUMN payment_id SET NOT NULL;

ALTER TABLE sage.service_payments
    ADD CONSTRAINT service_payments_pkey
    PRIMARY KEY (source_company, payment_id);

CREATE INDEX IF NOT EXISTS idx_srvpmt_recnum ON sage.service_payments (recnum);


-- ---------- Clear stale 'failed' bookkeeping so --resume retries them

UPDATE sage.backfill_runs
SET status = NULL, error_message = NULL, finished_at = NULL, rows_loaded = 0
WHERE source_company = 'DUBALDO'
  AND table_name IN ('service_locations', 'service_payments')
  AND status = 'failed';
