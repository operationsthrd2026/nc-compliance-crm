-- Phase 9: allow cross-device Action Queue views within the existing
-- saved_searches table. No existing views or RLS policies are altered.
-- The current RLS rules remain authoritative: read shared or owned rows,
-- editors create; only owners or administrators can delete.
ALTER TABLE public.saved_searches
 DROP CONSTRAINT IF EXISTS saved_searches_scope_check;
ALTER TABLE public.saved_searches
 ADD CONSTRAINT saved_searches_scope_check
 CHECK (scope IN ('prospects','finder','workflow'));

COMMENT ON COLUMN public.saved_searches.scope
 IS 'View family: prospects, finder or workflow; shared/private access is managed by existing RLS.';
NOTIFY pgrst, 'reload schema';
