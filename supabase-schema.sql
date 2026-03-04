-- DDE Spark Portal - Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Global settings table
CREATE TABLE IF NOT EXISTS settings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('vesting_period_days', '30'),
  ('daily_spark_allowance', '2')
ON CONFLICT (key) DO NOTHING;

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL DEFAULT 'spark123',
  is_admin BOOLEAN DEFAULT FALSE,
  must_change_password BOOLEAN DEFAULT TRUE,
  vested_sparks INTEGER DEFAULT 0,
  unvested_sparks INTEGER DEFAULT 0,
  daily_accrual INTEGER DEFAULT 0,
  daily_sparks_remaining INTEGER DEFAULT 2,
  last_daily_reset DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default admin
INSERT INTO employees (first_name, last_name, email, password_hash, is_admin, must_change_password, vested_sparks, unvested_sparks)
VALUES ('Admin', 'User', 'admin@dde.com', 'admin123', TRUE, TRUE, 0, 0)
ON CONFLICT (email) DO NOTHING;

-- Spark transactions table
CREATE TABLE IF NOT EXISTS spark_transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  from_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  to_employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('assign', 'admin_adjust', 'initial', 'vest', 'daily_accrual')),
  note TEXT,
  vesting_date DATE,
  vested BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending vesting table (sparks waiting to vest)
CREATE TABLE IF NOT EXISTS pending_vesting (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  vests_on DATE NOT NULL,
  transaction_id UUID REFERENCES spark_transactions(id) ON DELETE CASCADE,
  vested BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_spark_transactions_to ON spark_transactions(to_employee_id);
CREATE INDEX IF NOT EXISTS idx_spark_transactions_from ON spark_transactions(from_employee_id);
CREATE INDEX IF NOT EXISTS idx_spark_transactions_date ON spark_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_pending_vesting_employee ON pending_vesting(employee_id);
CREATE INDEX IF NOT EXISTS idx_pending_vesting_date ON pending_vesting(vests_on);

-- Function to process daily resets (called via cron or on login)
CREATE OR REPLACE FUNCTION reset_daily_sparks()
RETURNS void AS $$
BEGIN
  UPDATE employees 
  SET daily_sparks_remaining = 2, last_daily_reset = CURRENT_DATE
  WHERE last_daily_reset < CURRENT_DATE AND is_admin = FALSE;
END;
$$ LANGUAGE plpgsql;

-- Function to process vesting
CREATE OR REPLACE FUNCTION process_vesting()
RETURNS void AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN 
    SELECT pv.id, pv.employee_id, pv.amount, pv.transaction_id
    FROM pending_vesting pv
    WHERE pv.vests_on <= CURRENT_DATE AND pv.vested = FALSE
  LOOP
    -- Move from unvested to vested
    UPDATE employees 
    SET vested_sparks = vested_sparks + rec.amount,
        unvested_sparks = GREATEST(0, unvested_sparks - rec.amount),
        updated_at = NOW()
    WHERE id = rec.employee_id;
    
    -- Mark as vested
    UPDATE pending_vesting SET vested = TRUE WHERE id = rec.id;
    UPDATE spark_transactions SET vested = TRUE WHERE id = rec.transaction_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (optional - disable for simplicity with anon key)
-- If you want to use RLS, you'll need to set up proper auth
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE spark_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_vesting DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;

-- Grant permissions to anon role (for public access via anon key)
GRANT ALL ON employees TO anon;
GRANT ALL ON spark_transactions TO anon;
GRANT ALL ON pending_vesting TO anon;
GRANT ALL ON settings TO anon;
GRANT EXECUTE ON FUNCTION reset_daily_sparks() TO anon;
GRANT EXECUTE ON FUNCTION process_vesting() TO anon;
