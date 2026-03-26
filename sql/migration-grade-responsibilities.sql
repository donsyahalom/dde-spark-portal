-- ============================================================
-- DDE Spark Portal — Grade Responsibilities Migration
-- Run this in your Supabase SQL Editor
-- (in addition to performance-schema.sql if not already run)
-- ============================================================

-- ── Responsibilities by job grade ─────────────────────────────
-- One row per grade (e.g. 'A1', 'J2', 'F1')
CREATE TABLE IF NOT EXISTS perf_grade_responsibilities (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_grade TEXT NOT NULL UNIQUE,   -- matches employees.job_grade
  responsibilities TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES employees(id) ON DELETE SET NULL
);

GRANT ALL ON perf_grade_responsibilities TO anon;
CREATE INDEX IF NOT EXISTS idx_perf_grade_resp_grade ON perf_grade_responsibilities(job_grade);
