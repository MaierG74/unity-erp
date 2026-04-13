-- Flyers storage bucket
-- Created via Supabase storage API (not DDL)
-- Convention: flyers/{org_id}/{yyyy}/{mm}/{slug}.png
-- Public bucket — URLs are embeddable in emails
-- See: docs/technical/openclaw-agent-architecture.md

-- This file is documentation only. Bucket created via:
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('flyers', 'flyers', true, 52428800, ARRAY['image/png', 'image/jpeg', 'image/webp']);
