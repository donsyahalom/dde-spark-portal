-- ============================================================
-- DDE Tags Migration v3
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Tags columns on employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS tags_access BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tags_role   TEXT    DEFAULT NULL;

-- 2. Tag categories
CREATE TABLE IF NOT EXISTS dde_tag_categories (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#F0C040',
  sort_order INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tag values with OCR hints + role restrictions
CREATE TABLE IF NOT EXISTS dde_tag_values (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  category_id      UUID NOT NULL REFERENCES dde_tag_categories(id) ON DELETE CASCADE,
  value            TEXT NOT NULL,
  sort_order       INT  NOT NULL DEFAULT 0,
  official_name    TEXT DEFAULT NULL,
  address          TEXT DEFAULT NULL,
  company_name     TEXT DEFAULT NULL,
  role_restriction TEXT DEFAULT 'any',
  auto_apply       BOOLEAN DEFAULT FALSE
);

-- 4. Folders
CREATE TABLE IF NOT EXISTS dde_tag_folders (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Files — status_events JSONB stores full audit trail
--    Each event: { status, user_id, timestamp, note }
--    status values: 'added' | 'approved' | 'note' | 'paid' | 'replaced' | 'assigned'
CREATE TABLE IF NOT EXISTS dde_tag_files (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name          TEXT NOT NULL,
  folder_id     UUID REFERENCES dde_tag_folders(id) ON DELETE SET NULL,
  added_by      UUID REFERENCES employees(id)       ON DELETE SET NULL,
  notes         TEXT,
  tag_value_ids UUID[]  NOT NULL DEFAULT '{}',
  assigned_to   UUID[]  NOT NULL DEFAULT '{}',
  signoffs      JSONB   NOT NULL DEFAULT '[]',
  status_events JSONB   NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_dde_files_folder   ON dde_tag_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_dde_files_added_by ON dde_tag_files(added_by);
CREATE INDEX IF NOT EXISTS idx_dde_files_created  ON dde_tag_files(created_at);
CREATE INDEX IF NOT EXISTS idx_dde_vals_category  ON dde_tag_values(category_id);

-- 7. Seed categories
INSERT INTO dde_tag_categories (name, color, sort_order) VALUES
  ('Job',           '#F0C040', 1),
  ('Vendor',        '#5EE88A', 2),
  ('Document Type', '#60a5fa', 3),
  ('Status',        '#f87171', 4)
ON CONFLICT DO NOTHING;

-- ============================================================
-- UPGRADING FROM v1 or v2? Run only these lines:
-- ============================================================
-- ALTER TABLE dde_tag_values
--   ADD COLUMN IF NOT EXISTS official_name    TEXT DEFAULT NULL,
--   ADD COLUMN IF NOT EXISTS address          TEXT DEFAULT NULL,
--   ADD COLUMN IF NOT EXISTS company_name     TEXT DEFAULT NULL,
--   ADD COLUMN IF NOT EXISTS role_restriction TEXT DEFAULT 'any',
--   ADD COLUMN IF NOT EXISTS auto_apply       BOOLEAN DEFAULT FALSE;
--
-- ALTER TABLE dde_tag_files
--   ADD COLUMN IF NOT EXISTS status_events JSONB NOT NULL DEFAULT '[]';
