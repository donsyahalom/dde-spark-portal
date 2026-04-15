-- ============================================================
-- DDE Spark Portal — Compensation Feature Migration
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ── 1. Add compensation columns to employees ──────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS wage_type          TEXT    DEFAULT 'hourly',  -- 'hourly' or 'salary'
  ADD COLUMN IF NOT EXISTS wage_amount        NUMERIC DEFAULT 0,          -- hourly rate OR annual salary
  ADD COLUMN IF NOT EXISTS has_company_vehicle BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS target_bonus_pct   NUMERIC DEFAULT 0,          -- % of wage
  ADD COLUMN IF NOT EXISTS bonus_share_pct    NUMERIC DEFAULT 0,          -- % share of bonus pool
  -- per-employee visibility toggles (null = inherit global setting)
  ADD COLUMN IF NOT EXISTS show_wage          BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS show_range         BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS show_target_bonus  BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS show_bonus_share   BOOLEAN DEFAULT NULL;

-- ── 2. Grade compensation table ───────────────────────────────
CREATE TABLE IF NOT EXISTS perf_grade_compensation (
  job_grade         TEXT PRIMARY KEY,
  wage_type         TEXT    DEFAULT 'hourly',   -- 'hourly' or 'salary'
  wage_min          NUMERIC DEFAULT 0,
  wage_max          NUMERIC DEFAULT 0,
  target_bonus_pct  NUMERIC DEFAULT 0,
  bonus_share_pct   NUMERIC DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID REFERENCES employees(id) ON DELETE SET NULL
);

GRANT ALL ON perf_grade_compensation TO anon;

-- ── 3. New settings ───────────────────────────────────────────
INSERT INTO settings (key, value) VALUES
  ('vehicle_hourly_rate',    '7.74'),
  ('show_wage',              'true'),
  ('show_range',             'true'),
  ('show_target_bonus',      'true'),
  ('show_bonus_share',       'true'),
  ('total_revenue',          '0'),
  ('target_minimum',         '0'),
  ('target_bonus_share_pct', '0')
ON CONFLICT (key) DO NOTHING;
