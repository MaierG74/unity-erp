-- Add attachments support for todos
-- Generated 2025-10-20

BEGIN;

-- Table: todo_attachments
CREATE TABLE IF NOT EXISTS public.todo_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.todo_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL, -- Supabase storage path
  mime_type text NOT NULL,
  file_size bigint NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Enable RLS
ALTER TABLE public.todo_attachments ENABLE ROW LEVEL SECURITY;

-- Policies: todo_attachments
DROP POLICY IF EXISTS todo_attachments_select_participants ON public.todo_attachments;
CREATE POLICY todo_attachments_select_participants ON public.todo_attachments
  FOR SELECT
  USING (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_attachments_insert_participants ON public.todo_attachments;
CREATE POLICY todo_attachments_insert_participants ON public.todo_attachments
  FOR INSERT
  WITH CHECK (public.todo_user_is_participant(todo_id) AND auth.uid() = uploaded_by);

DROP POLICY IF EXISTS todo_attachments_delete_uploader ON public.todo_attachments;
CREATE POLICY todo_attachments_delete_uploader ON public.todo_attachments
  FOR DELETE
  USING (auth.uid() = uploaded_by OR public.todo_user_can_manage(todo_id));

-- Index
CREATE INDEX IF NOT EXISTS todo_attachments_todo_id_idx ON public.todo_attachments (todo_id);

COMMIT;
