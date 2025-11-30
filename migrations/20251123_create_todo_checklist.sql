-- Create todo_checklist_items table
-- Generated 2025-11-23

BEGIN;

-- Table: todo_checklist_items
CREATE TABLE IF NOT EXISTS public.todo_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.todo_items(id) ON DELETE CASCADE,
  title text NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS todo_checklist_items_set_updated_at ON public.todo_checklist_items;
CREATE TRIGGER todo_checklist_items_set_updated_at
  BEFORE UPDATE ON public.todo_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.todo_items_set_updated_at();

-- Enable RLS
ALTER TABLE public.todo_checklist_items ENABLE ROW LEVEL SECURITY;

-- Policies
-- Inherit access from parent todo_items via todo_user_is_participant function

DROP POLICY IF EXISTS todo_checklist_select_participants ON public.todo_checklist_items;
CREATE POLICY todo_checklist_select_participants ON public.todo_checklist_items
  FOR SELECT
  USING (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_checklist_insert_participants ON public.todo_checklist_items;
CREATE POLICY todo_checklist_insert_participants ON public.todo_checklist_items
  FOR INSERT
  WITH CHECK (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_checklist_update_participants ON public.todo_checklist_items;
CREATE POLICY todo_checklist_update_participants ON public.todo_checklist_items
  FOR UPDATE
  USING (public.todo_user_is_participant(todo_id))
  WITH CHECK (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_checklist_delete_participants ON public.todo_checklist_items;
CREATE POLICY todo_checklist_delete_participants ON public.todo_checklist_items
  FOR DELETE
  USING (public.todo_user_is_participant(todo_id));

-- Indexes
CREATE INDEX IF NOT EXISTS todo_checklist_items_todo_id_idx ON public.todo_checklist_items (todo_id);

COMMIT;
