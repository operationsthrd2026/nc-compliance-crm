# Nationwide ProspectFinder (Feature Branch)

This change adds a new standalone React discovery modal, preserving the existing CRM dashboard and old finder implementation for rollback.

## Live source configuration
- Nonprofits: ProPublica Nonprofit Explorer via `guidestar-search`
- Small businesses: OpenStreetMap Overpass via `osm-search`
- City/ZIP lookup: `us-geocode` (new Edge Function)
- NPI organizations: optional existing `nppes-search` remains available to legacy finder

Deploy Supabase Edge Functions separately from Vercel, **after** preview tests, on the same Supabase project:
```
npx supabase functions deploy guidestar-search --project-ref YOUR_REF
npx supabase functions deploy nppes-search --project-ref YOUR_REF
npx supabase functions deploy osm-search --project-ref YOUR_REF
npx supabase functions deploy us-geocode --project-ref YOUR_REF
```
Configure `NOMINATIM_CONTACT_EMAIL` as a Supabase Edge Function secret before geographic searches.
Ensure `ALLOWED_ORIGINS` includes preview and production origins and confirm `public.crm_role()`/RLS are configured.

## Important boundaries
- Does not alter database schema or existing records.
- Do not merge before GitHub build checks and Vercel preview pass.
- Directory listings are not verified personal emails.
- A location is required for local small business searches. Countrywide bulk business search is not provided by OSM.
- ProPublica does not provide ZIP-level filtering in the response; use city/state for nonprofits.
- Geocoding public Nominatim has usage limits. Switch to a commercial or self-hosted provider for production volume.
- The preview uses live APIs; if functions are not deployed, errors are shown instead of invented leads.
