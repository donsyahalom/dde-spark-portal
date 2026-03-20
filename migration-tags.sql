-- ============================================================
-- DDE Tags Migration  (v2 — run this full script once)
-- Run in your Supabase SQL Editor
-- ============================================================

-- 1. Add tags columns to employees
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

-- 3. Tag values  (includes OCR hints + access rules)
CREATE TABLE IF NOT EXISTS dde_tag_values (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  category_id      UUID NOT NULL REFERENCES dde_tag_categories(id) ON DELETE CASCADE,
  value            TEXT NOT NULL,
  sort_order       INT  NOT NULL DEFAULT 0,
  -- OCR matching fields
  official_name    TEXT DEFAULT NULL,   -- full legal name on invoices
  address          TEXT DEFAULT NULL,   -- job-site or billing address
  company_name     TEXT DEFAULT NULL,   -- vendor name on bills
  -- access / behaviour
  role_restriction TEXT DEFAULT 'any',  -- 'any' | 'viewer' | 'signoff'
  auto_apply       BOOLEAN DEFAULT FALSE -- auto-tag on every new file
);

-- 4. Folders
CREATE TABLE IF NOT EXISTS dde_tag_folders (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Files
CREATE TABLE IF NOT EXISTS dde_tag_files (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name          TEXT NOT NULL,
  folder_id     UUID REFERENCES dde_tag_folders(id) ON DELETE SET NULL,
  added_by      UUID REFERENCES employees(id)       ON DELETE SET NULL,
  notes         TEXT,
  tag_value_ids UUID[]  NOT NULL DEFAULT '{}',
  assigned_to   UUID[]  NOT NULL DEFAULT '{}',
  signoffs      JSONB   NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_dde_files_folder   ON dde_tag_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_dde_files_added_by ON dde_tag_files(added_by);
CREATE INDEX IF NOT EXISTS idx_dde_files_created  ON dde_tag_files(created_at);
CREATE INDEX IF NOT EXISTS idx_dde_vals_category  ON dde_tag_values(category_id);

-- 7. Seed example categories
INSERT INTO dde_tag_categories (name, color, sort_order) VALUES
  ('Job',           '#F0C040', 1),
  ('Vendor',        '#5EE88A', 2),
  ('Document Type', '#60a5fa', 3),
  ('Status',        '#f87171', 4)
ON CONFLICT DO NOTHING;

-- 8. Realtime — enable for all DDE Tags tables
-- (Supabase Realtime must also be enabled in the Dashboard for these tables)
-- ALTER TABLE dde_tag_categories REPLICA IDENTITY FULL;
-- ALTER TABLE dde_tag_values     REPLICA IDENTITY FULL;
-- ALTER TABLE dde_tag_folders    REPLICA IDENTITY FULL;
-- ALTER TABLE dde_tag_files      REPLICA IDENTITY FULL;
-- Uncomment the lines above if you want full-row change data in realtime payloads.

-- ============================================================
-- If upgrading from v1 (already ran migration-tags.sql before):
-- run only these lines:
-- ============================================================
-- ALTER TABLE dde_tag_values
--   ADD COLUMN IF NOT EXISTS official_name    TEXT DEFAULT NULL,
--   ADD COLUMN IF NOT EXISTS address          TEXT DEFAULT NULL,
--   ADD COLUMN IF NOT EXISTS company_name     TEXT DEFAULT NULL,
--   ADD COLUMN IF NOT EXISTS role_restriction TEXT DEFAULT 'any',
--   ADD COLUMN IF NOT EXISTS auto_apply       BOOLEAN DEFAULT FALSE;
