-- Fix RLS policy for todo_items to work with server-side API routes
-- The issue is that auth.uid() doesn't work properly with JWT tokens in server-side contexts
-- We need to allow inserts where the user is properly authenticated via the Authorization header

-- Drop the existing restrictive insert policy
DROP POLICY IF EXISTS todo_items_insert_creator ON public.todo_items;

-- Create a new insert policy that works with server-side authentication
-- This allows any authenticated user to insert a todo where they are the creator
CREATE POLICY todo_items_insert_creator ON public.todo_items
  FOR INSERT
  WITH CHECK (
    -- Allow insert if there's an authenticated user in the JWT
    (SELECT auth.jwt() IS NOT NULL)
    AND
    -- And the created_by matches the user from the JWT
    created_by = (SELECT auth.jwt()->>'sub')::uuid
  );
