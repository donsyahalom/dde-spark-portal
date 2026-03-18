-- ── DDE Spark Portal — Migration v6 ──────────────────────────────────────────
-- Adds: teams, team_members, dashboard_access tables
-- Adds: spark_value setting ($ per spark)
-- PM and Foreman leads are stored as UUID arrays (multi-select support)
-- Run this AFTER migration-v5.sql has been applied.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. spark_value setting (default $1.00 per spark)
INSERT INTO settings (key, value) VALUES ('spark_value', '1.00')
ON CONFLICT (key) DO NOTHING;

-- 2. Teams table
--    pm_ids / foreman_ids are UUID arrays so multiple leads can be assigned
CREATE TABLE IF NOT EXISTS teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pm_ids UUID[] DEFAULT '{}',
  foreman_ids UUID[] DEFAULT '{}',
  team_lead_can_view_dashboard BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT ALL ON teams TO anon;
ALTER TABLE teams DISABLE ROW LEVEL SECURITY;

-- 3. Team members (many-to-many employees <-> teams)
CREATE TABLE IF NOT EXISTS team_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, employee_id)
);
GRANT ALL ON team_members TO anon;
ALTER TABLE team_members DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_emp ON team_members(employee_id);

-- 4. Dashboard access grants
--    access_level: 'full' (incl $) | 'team' (excl $, own teams only)
CREATE TABLE IF NOT EXISTS dashboard_access (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'team' CHECK (access_level IN ('full', 'team')),
  granted_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id)
);
GRANT ALL ON dashboard_access TO anon;
ALTER TABLE dashboard_access DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dashboard_access_emp ON dashboard_access(employee_id);

-- 5. If teams table already existed with single-UUID columns, migrate them to arrays
DO $$
BEGIN
  -- Rename old single-value columns if present, copy into arrays, then drop
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'pm_id'
  ) THEN
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS pm_ids UUID[] DEFAULT '{}';
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS foreman_ids UUID[] DEFAULT '{}';
    UPDATE teams SET pm_ids = ARRAY[pm_id] WHERE pm_id IS NOT NULL;
    UPDATE teams SET foreman_ids = ARRAY[foreman_id] WHERE foreman_id IS NOT NULL;
    ALTER TABLE teams DROP COLUMN IF EXISTS pm_id;
    ALTER TABLE teams DROP COLUMN IF EXISTS foreman_id;
  END IF;
END $$;

-- 6. Add is_optional flag to employees
--    Optional employees are included in the "Including Optional" calculation
--    but excluded from the "Excluding Optional" calculation (same as PM4/Owner).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_optional BOOLEAN DEFAULT FALSE;

-- 7. Add sort_order to teams for manual ordering
ALTER TABLE teams ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 999;
-- Seed existing teams with sequential order by name
DO $$
DECLARE r RECORD; i INT := 1;
BEGIN
  FOR r IN SELECT id FROM teams ORDER BY name LOOP
    UPDATE teams SET sort_order = i WHERE id = r.id;
    i := i + 1;
  END LOOP;
END $$;
