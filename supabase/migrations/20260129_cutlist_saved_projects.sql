-- Migration: Cutlist saved projects with folder organization
-- Date: 2026-01-29

-- =============================================
-- Table: cutlist_folders
-- =============================================
CREATE TABLE IF NOT EXISTS cutlist_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES cutlist_folders(id) ON DELETE CASCADE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cutlist_folders_user_id
  ON cutlist_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_cutlist_folders_parent_id
  ON cutlist_folders(parent_id);

ALTER TABLE cutlist_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own folders" ON cutlist_folders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own folders" ON cutlist_folders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own folders" ON cutlist_folders
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own folders" ON cutlist_folders
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================
-- Table: cutlist_saved_projects
-- =============================================
CREATE TABLE IF NOT EXISTS cutlist_saved_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES cutlist_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cutlist_saved_projects_user_id
  ON cutlist_saved_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_cutlist_saved_projects_folder_id
  ON cutlist_saved_projects(folder_id);

ALTER TABLE cutlist_saved_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects" ON cutlist_saved_projects
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own projects" ON cutlist_saved_projects
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own projects" ON cutlist_saved_projects
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own projects" ON cutlist_saved_projects
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================
-- Triggers for updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_cutlist_folders_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cutlist_folders_updated_at
  BEFORE UPDATE ON cutlist_folders
  FOR EACH ROW EXECUTE FUNCTION update_cutlist_folders_updated_at();

CREATE OR REPLACE FUNCTION update_cutlist_saved_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cutlist_saved_projects_updated_at
  BEFORE UPDATE ON cutlist_saved_projects
  FOR EACH ROW EXECUTE FUNCTION update_cutlist_saved_projects_updated_at();
