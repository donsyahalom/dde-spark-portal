-- ============================================================
-- DDE Spark Portal — Migration: patch-2025-features
-- Run this in your Supabase SQL Editor (UAT first, then PROD)
-- ============================================================

-- 1. Add due_date to perf_cycles
ALTER TABLE perf_cycles
  ADD COLUMN IF NOT EXISTS due_date date;

-- 2. Add has_executive_dashboard to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS has_executive_dashboard boolean DEFAULT false;

-- 3. Create ops_permissions table (if not exists)
CREATE TABLE IF NOT EXISTS ops_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'viewer',
  pcs             text[] DEFAULT '{}',
  hidden_tabs     text[] DEFAULT '{}',
  hidden_fields   text[] DEFAULT '{}',
  job_access      text NOT NULL DEFAULT 'assigned',
  job_access_list text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(employee_id)
);

-- 4. Enable RLS on ops_permissions (admins only)
ALTER TABLE ops_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_permissions_admin" ON ops_permissions;
CREATE POLICY "ops_permissions_admin"
  ON ops_permissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees WHERE id = auth.uid()::uuid AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "ops_permissions_self_read" ON ops_permissions;
CREATE POLICY "ops_permissions_self_read"
  ON ops_permissions
  FOR SELECT
  USING (employee_id = auth.uid()::uuid);

-- 5. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS ops_permissions_employee_id_idx
  ON ops_permissions(employee_id);

CREATE INDEX IF NOT EXISTS employees_has_executive_dashboard_idx
  ON employees(has_executive_dashboard)
  WHERE has_executive_dashboard = true;

CREATE INDEX IF NOT EXISTS perf_cycles_due_date_idx
  ON perf_cycles(due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS perf_cycles_foreman_status_idx
  ON perf_cycles(foreman_id, status);

-- 6. notification_log — create if missing, or safely add columns to existing table
CREATE TABLE IF NOT EXISTS notification_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  notification_type text NOT NULL,
  channel           text NOT NULL DEFAULT 'email',
  subject           text,
  success           boolean DEFAULT true,
  error_msg         text
);

-- Add created_at only if it doesn't already exist
-- (table may have been created earlier without this column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'notification_log'
       AND column_name = 'created_at'
  ) THEN
    ALTER TABLE notification_log ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Base index — always safe
CREATE INDEX IF NOT EXISTS notification_log_employee_idx
  ON notification_log(employee_id);

-- created_at index — only create if the column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'notification_log'
       AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'notification_log'
       AND indexname  = 'notification_log_created_idx'
  ) THEN
    EXECUTE 'CREATE INDEX notification_log_created_idx ON notification_log(created_at DESC)';
  END IF;
END $$;
