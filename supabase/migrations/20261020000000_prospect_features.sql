-- ════════════════════════════════════════════════════════════════════
--  NC Compliance CRM — Prospect features (tags, email verification,
--  shared saved searches)
--  ────────────────────────────────────────────────────────────────────
--  REQUIRES 20261019000000_security_hardening.sql to have been run
--  (uses its crm_uid() / crm_can_edit() / crm_is_admin() helpers).
--  Safe to re-run. The app detects whether this migration has been
--  applied and degrades gracefully if it hasn't.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.crm_uid()') is null then
    raise exception 'Run 20261019000000_security_hardening.sql first (crm_uid() is missing).';
  end if;
end $$;

-- ── 1. New prospect columns ─────────────────────────────────────────
alter table public.prospects add column if not exists tags             text[]      not null default '{}';
alter table public.prospects add column if not exists email_status     text;
alter table public.prospects add column if not exists email_checked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_email_status_chk') then
    alter table public.prospects add constraint prospects_email_status_chk
      check (email_status is null or email_status in ('valid','risky','invalid','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_tags_len_chk') then
    alter table public.prospects add constraint prospects_tags_len_chk
      check (cardinality(tags) <= 30);
  end if;
end $$;

create index if not exists prospects_tags_gin on public.prospects using gin (tags);

-- ── 2. Shared saved searches / views ────────────────────────────────
create table if not exists public.saved_searches (
  id              uuid primary key default gen_random_uuid(),
  scope           text not null check (scope in ('prospects','finder')),
  name            text not null check (char_length(name) between 1 and 80),
  params          jsonb not null default '{}'::jsonb check (pg_column_size(params) < 20000),
  shared          boolean not null default true,
  created_by      uuid not null default public.crm_uid(),
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists saved_searches_scope_idx on public.saved_searches (scope, created_at desc);

alter table public.saved_searches enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'saved_searches' loop
    execute format('drop policy %I on public.saved_searches', r.policyname);
  end loop;
end $$;

revoke all on public.saved_searches from anon;
grant select, insert, update, delete on public.saved_searches to authenticated;

-- Team members see shared searches plus their own private ones.
create policy saved_searches_select on public.saved_searches
  for select to authenticated
  using (public.crm_role() is not null and (shared or created_by = public.crm_uid()));

-- Editors may create; the owner is always the caller (can't be spoofed).
create policy saved_searches_insert on public.saved_searches
  for insert to authenticated
  with check (public.crm_can_edit() and created_by = public.crm_uid());

-- Only the owner (or an admin) may rename/edit/delete.
create policy saved_searches_update on public.saved_searches
  for update to authenticated
  using      (public.crm_can_edit() and (created_by = public.crm_uid() or public.crm_is_admin()))
  with check (public.crm_can_edit() and (created_by = public.crm_uid() or public.crm_is_admin()));

create policy saved_searches_delete on public.saved_searches
  for delete to authenticated
  using (public.crm_can_edit() and (created_by = public.crm_uid() or public.crm_is_admin()));

notify pgrst, 'reload schema';
