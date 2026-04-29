-- ============================================================
-- DDE Spark Portal — Migration: user_permissions table
-- Run in Supabase SQL Editor — UAT first, then PROD
-- ============================================================

CREATE TABLE IF NOT EXISTS user_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(employee_id)
);

ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can read/write all rows
DROP POLICY IF EXISTS "up_admin" ON user_permissions;
CREATE POLICY "up_admin" ON user_permissions FOR ALL
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid()::uuid AND is_admin = true));

-- Each employee can read their own permissions
DROP POLICY IF EXISTS "up_self_read" ON user_permissions;
CREATE POLICY "up_self_read" ON user_permissions FOR SELECT
  USING (employee_id = auth.uid()::uuid);

CREATE INDEX IF NOT EXISTS user_permissions_emp_idx ON user_permissions(employee_id);

-- Seed default (all-visible) permissions for every existing non-admin employee
-- Only inserts rows that don't already exist.
INSERT INTO user_permissions (employee_id, permissions)
SELECT id, '{
  "screens": {
    "leaderboard":   {"visible": true, "details": {"show_dollar_value": true, "show_job_grade": true, "show_spark_log": true, "show_like_button": true}},
    "my_sparks":     {"visible": true, "details": {"show_balance": true, "show_history": true, "can_send_sparks": true}},
    "compensation":  {"visible": true, "details": {"show_wage": true, "show_range": true, "show_target_bonus": true, "show_bonus_share": true}},
    "performance":   {"visible": true, "details": {"can_trigger_eval": true, "can_view_results": true}},
    "board":         {"visible": true, "details": {"show_board": true, "show_docs": true}},
    "dashboard":     {"visible": true, "details": {"show_utilization": true, "show_top_givers": true, "show_charts": true}}
  }
}'::jsonb
FROM employees
WHERE is_admin = false
  AND id NOT IN (SELECT employee_id FROM user_permissions)
ON CONFLICT (employee_id) DO NOTHING;

SELECT COUNT(*) AS seeded_rows FROM user_permissions;
