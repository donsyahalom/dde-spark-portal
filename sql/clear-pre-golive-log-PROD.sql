-- ============================================================
-- DDE Spark Portal — Clear spark log entries before 3/27/2026
-- TARGET: PRODUCTION environment
--
-- PURPOSE: Remove display-only log line items from before
-- the go-live date. Spark balances were manually adjusted
-- beforehand so this script does NOT touch employee balances,
-- vested_sparks, unvested_sparks, or daily_sparks_remaining.
-- It only removes the transaction rows and associated likes
-- so they no longer appear in the activity log.
--
-- ⚠️  RUN THIS ON PROD SUPABASE SQL EDITOR ONLY.
-- ⚠️  Run the UAT version first to verify behavior.
-- SAFE TO RUN MULTIPLE TIMES (idempotent).
-- ============================================================

BEGIN;

-- Step 1: Remove likes on those transactions (FK constraint)
DELETE FROM transaction_likes
WHERE transaction_id IN (
  SELECT id FROM spark_transactions
  WHERE created_at < '2026-03-27T00:00:00+00:00'
    AND transaction_type = 'assign'
);

-- Step 2: Remove the transactions themselves
DELETE FROM spark_transactions
WHERE created_at < '2026-03-27T00:00:00+00:00'
  AND transaction_type = 'assign';

-- Verify: should return 0
SELECT COUNT(*) AS remaining_pre_golive_rows
FROM spark_transactions
WHERE created_at < '2026-03-27T00:00:00+00:00'
  AND transaction_type = 'assign';

COMMIT;
