-- ============================================================
-- DDE Spark Portal — Migration v4
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- 1. New columns on employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS carrier TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS job_grade TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS job_title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_management BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_spark_list BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS watchlist UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS redeemed_sparks INTEGER DEFAULT 0;

-- 2. New settings
INSERT INTO settings (key, value) VALUES
  ('spark_frequency',          'daily'),
  ('management_daily_accrual', '5'),
  ('management_per_person_cap','2'),
  ('biweekly_reference_date',  CURRENT_DATE::TEXT),
  ('go_live_date',             ''),
  ('leaderboard_range',        'all_time'),
  ('leaderboard_range_from',   ''),
  ('leaderboard_range_to',     ''),
  ('log_range',                'all_time'),
  ('log_range_days',           '14'),
  ('reminder_offsets',         '48,24'),
  ('reminder_enabled',         'false')
ON CONFLICT (key) DO NOTHING;

-- 3. transaction_likes
CREATE TABLE IF NOT EXISTS transaction_likes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  transaction_id UUID REFERENCES spark_transactions(id) ON DELETE CASCADE,
  from_employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(transaction_id, from_employee_id)
);
GRANT ALL ON transaction_likes TO anon;
ALTER TABLE transaction_likes DISABLE ROW LEVEL SECURITY;

-- 4. spark_cashouts
CREATE TABLE IF NOT EXISTS spark_cashouts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  admin_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  sparks_redeemed INTEGER NOT NULL,
  redemption_value TEXT,
  note TEXT,
  cashed_out_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT ALL ON spark_cashouts TO anon;
ALTER TABLE spark_cashouts DISABLE ROW LEVEL SECURITY;

-- 5. spark_transactions new cols + constraint fix
ALTER TABLE spark_transactions
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS is_list_distribution BOOLEAN DEFAULT FALSE;
ALTER TABLE spark_transactions DROP CONSTRAINT IF EXISTS spark_transactions_transaction_type_check;
ALTER TABLE spark_transactions ADD CONSTRAINT spark_transactions_transaction_type_check
  CHECK (transaction_type IN ('assign','admin_adjust','initial','vest','daily_accrual','cashout'));

-- 6. daily_given
CREATE TABLE IF NOT EXISTS daily_given (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  from_employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  to_employee_id   UUID REFERENCES employees(id) ON DELETE CASCADE,
  given_date DATE NOT NULL,
  amount INTEGER DEFAULT 0,
  UNIQUE(from_employee_id, to_employee_id, given_date)
);
GRANT ALL ON daily_given TO anon;
ALTER TABLE daily_given DISABLE ROW LEVEL SECURITY;

-- 7. Message board
CREATE TABLE IF NOT EXISTS message_board (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  author_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  title TEXT,
  body TEXT NOT NULL,
  push_email BOOLEAN DEFAULT FALSE,
  push_sms   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT ALL ON message_board TO anon;
ALTER TABLE message_board DISABLE ROW LEVEL SECURITY;

-- 8. Company documents with versioning
CREATE TABLE IF NOT EXISTS company_documents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN DEFAULT TRUE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📄',
  file_url TEXT,
  file_name TEXT,
  uploaded_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT ALL ON company_documents TO anon;
ALTER TABLE company_documents DISABLE ROW LEVEL SECURITY;

-- 9. Notification log
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN DEFAULT TRUE,
  error_msg TEXT
);
GRANT ALL ON notification_log TO anon;
ALTER TABLE notification_log DISABLE ROW LEVEL SECURITY;

-- 10. Indexes
CREATE INDEX IF NOT EXISTS idx_txn_likes_txn ON transaction_likes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_cashouts_employee ON spark_cashouts(employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_given_from ON daily_given(from_employee_id, given_date);
CREATE INDEX IF NOT EXISTS idx_mb_created ON message_board(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_slug ON company_documents(slug);
CREATE INDEX IF NOT EXISTS idx_docs_current ON company_documents(is_current);
CREATE INDEX IF NOT EXISTS idx_notif_log_emp ON notification_log(employee_id);

-- 11. get_ct_today
CREATE OR REPLACE FUNCTION get_ct_today()
RETURNS DATE AS $$
BEGIN RETURN (NOW() AT TIME ZONE 'America/New_York')::DATE; END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION get_ct_today() TO anon;

-- 12. reset_daily_sparks (frequency-aware)
CREATE OR REPLACE FUNCTION reset_daily_sparks()
RETURNS void AS $$
DECLARE
  ct_today DATE; freq TEXT; emp RECORD; should_reset BOOLEAN;
BEGIN
  ct_today := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  SELECT value INTO freq FROM settings WHERE key = 'spark_frequency';
  freq := COALESCE(freq, 'daily');
  FOR emp IN SELECT * FROM employees WHERE is_admin = FALSE LOOP
    should_reset := FALSE;
    IF freq = 'daily'     THEN should_reset := emp.last_daily_reset < ct_today;
    ELSIF freq = 'weekly'    THEN should_reset := ct_today - emp.last_daily_reset >= 7;
    ELSIF freq = 'biweekly'  THEN should_reset := ct_today - emp.last_daily_reset >= 14;
    ELSIF freq = 'monthly'   THEN should_reset :=
      EXTRACT(month FROM emp.last_daily_reset) <> EXTRACT(month FROM ct_today) OR
      EXTRACT(year  FROM emp.last_daily_reset) <> EXTRACT(year  FROM ct_today);
    END IF;
    IF should_reset THEN
      UPDATE employees SET daily_sparks_remaining = daily_accrual, last_daily_reset = ct_today WHERE id = emp.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION reset_daily_sparks() TO anon;

-- 13. process_vesting
CREATE OR REPLACE FUNCTION process_vesting()
RETURNS void AS $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT pv.id, pv.employee_id, pv.amount, pv.transaction_id
             FROM pending_vesting pv WHERE pv.vests_on <= CURRENT_DATE AND pv.vested = FALSE
  LOOP
    UPDATE employees SET vested_sparks = vested_sparks + rec.amount,
      unvested_sparks = GREATEST(0, unvested_sparks - rec.amount), updated_at = NOW()
    WHERE id = rec.employee_id;
    UPDATE pending_vesting SET vested = TRUE WHERE id = rec.id;
    UPDATE spark_transactions SET vested = TRUE WHERE id = rec.transaction_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION process_vesting() TO anon;

-- 14. get_next_reset
CREATE OR REPLACE FUNCTION get_next_reset(freq TEXT)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  ct_today DATE; ref_date DATE; days_until INT; next_reset DATE;
BEGIN
  ct_today := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  IF freq = 'daily' THEN next_reset := ct_today + 1;
  ELSIF freq = 'weekly' THEN
    days_until := 7 - EXTRACT(dow FROM ct_today)::INT;
    IF days_until = 0 THEN days_until := 7; END IF;
    next_reset := ct_today + days_until;
  ELSIF freq = 'biweekly' THEN
    SELECT value::DATE INTO ref_date FROM settings WHERE key = 'biweekly_reference_date';
    days_until := 14 - ((ct_today - ref_date) % 14);
    IF days_until = 14 THEN days_until := 0; END IF;
    next_reset := ct_today + days_until;
  ELSIF freq = 'monthly' THEN
    next_reset := (date_trunc('month', ct_today) + interval '1 month' - interval '1 day')::DATE;
    IF next_reset <= ct_today THEN
      next_reset := (date_trunc('month', ct_today + interval '1 month') + interval '1 month' - interval '1 day')::DATE;
    END IF;
  ELSE next_reset := ct_today + 1;
  END IF;
  RETURN (next_reset::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE 'America/New_York';
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION get_next_reset(TEXT) TO anon;

-- 15. apply_go_live_reset
CREATE OR REPLACE FUNCTION apply_go_live_reset()
RETURNS void AS $$
BEGIN
  UPDATE employees SET vested_sparks = 0, unvested_sparks = 0, redeemed_sparks = 0,
    daily_sparks_remaining = daily_accrual, last_daily_reset = CURRENT_DATE, updated_at = NOW()
  WHERE is_admin = FALSE;
  DELETE FROM pending_vesting;
  UPDATE spark_transactions SET vested = TRUE WHERE vested = FALSE;
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION apply_go_live_reset() TO anon;

-- 16. Storage bucket for documents (run once)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('company-docs', 'company-docs', true) ON CONFLICT DO NOTHING;

-- v4.1 addition: minimum redemption amount setting
INSERT INTO settings (key, value) VALUES ('min_redemption_amount', '20') ON CONFLICT (key) DO NOTHING;

-- ── Migration v4 addendum: custom_lists table ──────────────────────────────
CREATE TABLE IF NOT EXISTS custom_lists (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  list_type TEXT NOT NULL,   -- 'job_grade' | 'job_title'
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 999,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(list_type, value)
);
GRANT ALL ON custom_lists TO anon;
ALTER TABLE custom_lists DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_custom_lists_type ON custom_lists(list_type, sort_order);

-- Seed the default job grades (sort_order matches position in the hardcoded array)
INSERT INTO custom_lists (list_type, value, sort_order) VALUES
  ('job_grade','Pre1',1),
  ('job_grade','A1',2),('job_grade','A2',3),('job_grade','A3',4),('job_grade','A4',5),
  ('job_grade','J1',6),('job_grade','J2',7),('job_grade','J3',8),('job_grade','J4',9),
  ('job_grade','F1',10),('job_grade','F2',11),('job_grade','F3',12),('job_grade','F4',13),
  ('job_grade','P1',14),('job_grade','P2',15),('job_grade','P3',16),('job_grade','P4',17),
  ('job_grade','Owner',18)
ON CONFLICT (list_type, value) DO NOTHING;

INSERT INTO custom_lists (list_type, value, sort_order) VALUES
  ('job_title','Pre-Apprentice',1),
  ('job_title','Apprentice',2),
  ('job_title','Journeyman',3),
  ('job_title','Foreman',4),
  ('job_title','Project Manager',5),
  ('job_title','Owner',6)
ON CONFLICT (list_type, value) DO NOTHING;

-- min_redemption_amount setting
INSERT INTO settings (key, value) VALUES ('min_redemption_amount','20') ON CONFLICT (key) DO NOTHING;
