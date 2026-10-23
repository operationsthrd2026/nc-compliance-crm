-- Exact location of a prospect, taken from the source listing (OpenStreetMap). Optional; never guessed.
-- Existing RLS policies continue to apply to these nullable columns. Existing rows are not modified.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS street_address text;

-- Coordinates come as a pair or not at all, and must be real coordinates.
-- (A CHECK that evaluates to NULL passes, so both values are required explicitly.)
ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_location_valid;
ALTER TABLE public.prospects ADD CONSTRAINT prospects_location_valid CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_street_address_len;
ALTER TABLE public.prospects ADD CONSTRAINT prospects_street_address_len CHECK (street_address IS NULL OR char_length(street_address) <= 300);

COMMENT ON COLUMN public.prospects.latitude  IS 'Source-listed latitude (OpenStreetMap); used for the map and street-view link; not independently verified';
COMMENT ON COLUMN public.prospects.longitude IS 'Source-listed longitude (OpenStreetMap); used for the map and street-view link; not independently verified';
COMMENT ON COLUMN public.prospects.street_address IS 'Source-listed street address; not independently verified';
