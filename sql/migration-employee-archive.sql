-- ============================================================
-- DDE Spark Portal — Migration: add employee archive support
-- Run in Supabase SQL Editor on UAT first, then PROD
-- Safe to re-run (IF NOT EXISTS / DO blocks throughout)
-- ============================================================

-- 1. Add is_archived and archived_at to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT null;

-- 2. Index — fast lookup of active employees (the common case)
CREATE INDEX IF NOT EXISTS employees_active_idx
  ON employees (is_archived)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS employees_archived_idx
  ON employees (is_archived, archived_at)
  WHERE is_archived = true;

-- 3. Verify — should show 0 archived employees after migration
SELECT
  COUNT(*) FILTER (WHERE is_archived = false) AS active_employees,
  COUNT(*) FILTER (WHERE is_archived = true)  AS archived_employees
FROM employees
WHERE is_admin = false;
