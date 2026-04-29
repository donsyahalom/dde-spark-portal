-- ============================================================
-- DDE Spark Portal — Clear spark log entries before 3/27/2026
-- TARGET: UAT environment
--
-- PURPOSE: Remove display-only log line items from before
-- the go-live date. Spark balances were manually adjusted
-- beforehand so this script does NOT touch employee balances,
-- vested_sparks, unvested_sparks, or daily_sparks_remaining.
-- It only removes the transaction rows and associated likes
-- so they no longer appear in the activity log.
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent).
-- ============================================================

BEGIN;

-- Preview first — run this SELECT to confirm what will be deleted
-- before committing. Comment it out if you don't need it.
SELECT
  id,
  transaction_type,
  amount,
  created_at,
  note
FROM spark_transactions
WHERE created_at < '2026-03-27T00:00:00+00:00'
  AND transaction_type = 'assign'
ORDER BY created_at DESC;

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

-- Report how many rows were removed
-- (this runs after the deletes so it should return 0 if successful)
SELECT COUNT(*) AS remaining_pre_golive_rows
FROM spark_transactions
WHERE created_at < '2026-03-27T00:00:00+00:00'
  AND transaction_type = 'assign';

COMMIT;

-- ============================================================
-- NOTE: daily_given rows from before that date are left intact
-- as they are used for the per-period send-limit logic and
-- removing them could allow re-sending. If you also want to
-- clear those display entries run the block below separately:
--
-- DELETE FROM daily_given
-- WHERE given_date < '2026-03-27';
-- ============================================================
