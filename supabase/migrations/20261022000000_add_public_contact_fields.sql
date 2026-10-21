-- Add sourced public contact fields without modifying existing CRM prospect rows.
-- Existing RLS policies continue to apply to these nullable columns.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.prospects.website IS 'Source-listed organization website; not independently verified';
COMMENT ON COLUMN public.prospects.email IS 'Source-listed email address; not independently verified';
COMMENT ON COLUMN public.prospects.phone IS 'Source-listed phone number; not independently verified';
