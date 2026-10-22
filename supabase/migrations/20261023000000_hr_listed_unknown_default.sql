-- ════════════════════════════════════════════════════════════════════
--  HR-person default: "Unknown", not an assumed "No"
--  ────────────────────────────────────────────────────────────────────
--  The original schema defaulted prospects.hr_person_listed to 'No', so any
--  insert that omitted the column recorded "no HR person" with no evidence.
--  New rows should start as 'Unknown' (the value the nationwide finder and
--  edge functions already use).
--
--  • Changes the DEFAULT only — existing rows are NOT modified.
--  • Safe to re-run; does nothing if the column doesn't exist.
-- ════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'prospects' and column_name = 'hr_person_listed') then
    alter table public.prospects alter column hr_person_listed set default 'Unknown';
    comment on column public.prospects.hr_person_listed is
      'Yes / No / Unknown. Unknown = not evidenced by a source. Older rows may hold a defaulted "No" that was never verified.';
  end if;
end $$;
