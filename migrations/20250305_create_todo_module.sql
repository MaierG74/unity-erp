-- Create core tables for To-Do module (idempotent)
-- Generated 2025-03-05

BEGIN;

-- Enum: todo_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'todo_status'
  ) THEN
    CREATE TYPE public.todo_status AS ENUM (
      'open',
      'in_progress',
      'blocked',
      'done',
      'archived'
    );
  END IF;
END $$;

-- Enum: todo_priority
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'todo_priority'
  ) THEN
    CREATE TYPE public.todo_priority AS ENUM (
      'low',
      'medium',
      'high',
      'urgent'
    );
  END IF;
END $$;

-- Enum: todo_activity_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'todo_activity_type'
  ) THEN
    CREATE TYPE public.todo_activity_type AS ENUM (
      'created',
      'status_changed',
      'comment',
      'due_date_changed',
      'assignment_changed',
      'acknowledged'
    );
  END IF;
END $$;

-- Table: todo_items
CREATE TABLE IF NOT EXISTS public.todo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NULL,
  status public.todo_status NOT NULL DEFAULT 'open',
  priority public.todo_priority NOT NULL DEFAULT 'medium',
  due_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_to uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  entity_id uuid NULL,
  context_type text NULL,
  context_id uuid NULL,
  context_path text NULL,
  context_snapshot jsonb NULL,
  completed_at timestamptz NULL,
  completed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Ensure timestamps update automatically
CREATE OR REPLACE FUNCTION public.todo_items_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS todo_items_set_updated_at ON public.todo_items;
CREATE TRIGGER todo_items_set_updated_at
  BEFORE UPDATE ON public.todo_items
  FOR EACH ROW
  EXECUTE FUNCTION public.todo_items_set_updated_at();

-- Table: todo_watchers
CREATE TABLE IF NOT EXISTS public.todo_watchers (
  todo_id uuid NOT NULL REFERENCES public.todo_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (todo_id, user_id)
);

-- Table: todo_activity
CREATE TABLE IF NOT EXISTS public.todo_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.todo_items(id) ON DELETE CASCADE,
  event_type public.todo_activity_type NOT NULL,
  payload jsonb NULL,
  note text NULL,
  performed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Table: todo_comments (optional thin table for richer comment bodies)
CREATE TABLE IF NOT EXISTS public.todo_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.todo_items(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Utility functions for RLS reuse
CREATE OR REPLACE FUNCTION public.todo_user_is_participant(p_todo_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.todo_items ti
    WHERE ti.id = p_todo_id
      AND (ti.created_by = v_user_id OR ti.assigned_to = v_user_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.todo_watchers tw
    WHERE tw.todo_id = p_todo_id AND tw.user_id = v_user_id
  );
END;
$$;

COMMENT ON FUNCTION public.todo_user_is_participant IS 'Returns true when the current auth user participates in the todo (creator, assignee, or watcher).';

CREATE OR REPLACE FUNCTION public.todo_user_can_manage(p_todo_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.todo_items ti
    WHERE ti.id = p_todo_id
      AND (ti.created_by = v_user_id OR ti.assigned_to = v_user_id)
  );
END;
$$;

COMMENT ON FUNCTION public.todo_user_can_manage IS 'Returns true when the current auth user is the creator or assignee for the todo.';

-- Enable RLS
ALTER TABLE public.todo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_comments ENABLE ROW LEVEL SECURITY;

-- Policies: todo_items
DROP POLICY IF EXISTS todo_items_select_participants ON public.todo_items;
CREATE POLICY todo_items_select_participants ON public.todo_items
  FOR SELECT
  USING (public.todo_user_is_participant(id));

DROP POLICY IF EXISTS todo_items_insert_creator ON public.todo_items;
CREATE POLICY todo_items_insert_creator ON public.todo_items
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS todo_items_update_creator ON public.todo_items;
CREATE POLICY todo_items_update_creator ON public.todo_items
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS todo_items_update_assignee ON public.todo_items;
CREATE POLICY todo_items_update_assignee ON public.todo_items
  FOR UPDATE
  USING (auth.uid() = assigned_to)
  WITH CHECK (auth.uid() = assigned_to);

-- Policies: todo_watchers
DROP POLICY IF EXISTS todo_watchers_select_participants ON public.todo_watchers;
CREATE POLICY todo_watchers_select_participants ON public.todo_watchers
  FOR SELECT
  USING (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_watchers_insert_managers ON public.todo_watchers;
CREATE POLICY todo_watchers_insert_managers ON public.todo_watchers
  FOR INSERT
  WITH CHECK (public.todo_user_can_manage(todo_id));

DROP POLICY IF EXISTS todo_watchers_delete_managers ON public.todo_watchers;
CREATE POLICY todo_watchers_delete_managers ON public.todo_watchers
  FOR DELETE
  USING (public.todo_user_can_manage(todo_id));

-- Policies: todo_activity
DROP POLICY IF EXISTS todo_activity_select_participants ON public.todo_activity;
CREATE POLICY todo_activity_select_participants ON public.todo_activity
  FOR SELECT
  USING (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_activity_insert_participants ON public.todo_activity;
CREATE POLICY todo_activity_insert_participants ON public.todo_activity
  FOR INSERT
  WITH CHECK (public.todo_user_is_participant(todo_id));

-- Policies: todo_comments
DROP POLICY IF EXISTS todo_comments_select_participants ON public.todo_comments;
CREATE POLICY todo_comments_select_participants ON public.todo_comments
  FOR SELECT
  USING (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_comments_insert_participants ON public.todo_comments;
CREATE POLICY todo_comments_insert_participants ON public.todo_comments
  FOR INSERT
  WITH CHECK (public.todo_user_is_participant(todo_id));

DROP POLICY IF EXISTS todo_comments_delete_creator ON public.todo_comments;
CREATE POLICY todo_comments_delete_creator ON public.todo_comments
  FOR DELETE
  USING (auth.uid() = created_by);

-- Indexes
CREATE INDEX IF NOT EXISTS todo_items_assigned_to_idx ON public.todo_items (assigned_to);
CREATE INDEX IF NOT EXISTS todo_items_created_by_idx ON public.todo_items (created_by);
CREATE INDEX IF NOT EXISTS todo_items_status_idx ON public.todo_items (status);
CREATE INDEX IF NOT EXISTS todo_items_due_at_idx ON public.todo_items (due_at);
CREATE INDEX IF NOT EXISTS todo_items_entity_id_idx ON public.todo_items (entity_id);
CREATE INDEX IF NOT EXISTS todo_activity_todo_id_idx ON public.todo_activity (todo_id);
CREATE INDEX IF NOT EXISTS todo_comments_todo_id_idx ON public.todo_comments (todo_id);

COMMIT;
