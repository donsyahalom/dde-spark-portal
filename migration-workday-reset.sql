-- Migration: Daily spark reset now skips weekends (Saturday & Sunday)
-- When spark_frequency = 'daily', resets only occur on work days (Mon–Fri).
-- All other frequencies (weekly, biweekly, monthly) are unaffected.

CREATE OR REPLACE FUNCTION reset_daily_sparks()
RETURNS void AS $$
DECLARE
  ct_today DATE;
  freq TEXT;
  dow INT;
BEGIN
  ct_today := (NOW() AT TIME ZONE 'America/New_York')::DATE;

  -- Read the spark_frequency setting (defaults to 'daily')
  SELECT value INTO freq FROM settings WHERE key = 'spark_frequency';
  freq := COALESCE(freq, 'daily');

  -- When frequency is daily, skip weekends (dow: 0=Sunday, 6=Saturday)
  IF freq = 'daily' THEN
    dow := EXTRACT(DOW FROM ct_today);
    IF dow = 0 OR dow = 6 THEN
      RETURN; -- Weekend: do not reset
    END IF;
  END IF;

  UPDATE employees
  SET daily_sparks_remaining = daily_accrual,
      last_daily_reset = ct_today
  WHERE last_daily_reset < ct_today AND is_admin = FALSE;
END;
$$ LANGUAGE plpgsql;
