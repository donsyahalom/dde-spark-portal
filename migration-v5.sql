-- ── DDE Spark Portal — Migration v5 ──────────────────────────────────────────
-- Run this AFTER migration-v4.sql has been applied.
-- Adds reason_category rows to custom_lists so they are editable in the Lists tab.
-- Also re-seeds job_grade and job_title in case the table was missed.

-- Ensure the custom_lists table exists (safe re-run of v4 DDL)
CREATE TABLE IF NOT EXISTS custom_lists (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  list_type TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 999,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(list_type, value)
);
GRANT ALL ON custom_lists TO anon;
ALTER TABLE custom_lists DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_custom_lists_type ON custom_lists(list_type, sort_order);

-- Re-seed job grades (safe: ON CONFLICT DO NOTHING)
INSERT INTO custom_lists (list_type, value, sort_order) VALUES
  ('job_grade','Pre1',1),
  ('job_grade','A1',2),('job_grade','A2',3),('job_grade','A3',4),('job_grade','A4',5),
  ('job_grade','J1',6),('job_grade','J2',7),('job_grade','J3',8),('job_grade','J4',9),
  ('job_grade','F1',10),('job_grade','F2',11),('job_grade','F3',12),('job_grade','F4',13),
  ('job_grade','P1',14),('job_grade','P2',15),('job_grade','P3',16),('job_grade','P4',17),
  ('job_grade','Owner',18)
ON CONFLICT (list_type, value) DO NOTHING;

-- Re-seed job titles (safe: ON CONFLICT DO NOTHING)
INSERT INTO custom_lists (list_type, value, sort_order) VALUES
  ('job_title','Pre-Apprentice',1),
  ('job_title','Apprentice',2),
  ('job_title','Journeyman',3),
  ('job_title','Foreman',4),
  ('job_title','Project Manager',5),
  ('job_title','Owner',6)
ON CONFLICT (list_type, value) DO NOTHING;

-- Seed reason categories (NEW in v5)
INSERT INTO custom_lists (list_type, value, sort_order) VALUES
  ('reason_category','Going Above & Beyond',1),
  ('reason_category','Teamwork & Collaboration',2),
  ('reason_category','Customer Service Excellence',3),
  ('reason_category','Safety Leadership',4),
  ('reason_category','Problem Solving',5),
  ('reason_category','Mentoring & Training',6),
  ('reason_category','Reliability & Dependability',7),
  ('reason_category','Innovation & Initiative',8),
  ('reason_category','Positive Attitude',9),
  ('reason_category','Other',10)
ON CONFLICT (list_type, value) DO NOTHING;
