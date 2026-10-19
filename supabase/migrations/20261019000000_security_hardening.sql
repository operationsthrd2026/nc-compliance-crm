-- ════════════════════════════════════════════════════════════════════
--  NC Compliance CRM — Security hardening
--  ────────────────────────────────────────────────────────────────────
--  What this does
--    1. Ties every CRM user to a real Supabase Auth account (matched by
--       VERIFIED email) and derives their role server-side.
--    2. Enables Row Level Security on every table and replaces any
--       existing "allow all" policies with role-based ones.
--    3. Removes the anon role's access to CRM data entirely.
--    4. Locks api_credentials so third-party API keys can never be read
--       from a browser. Keys are written through an admin-only function
--       and read only by Edge Functions (service role).
--    5. Drops the legacy crm_users.password column (weak unsalted hashes).
--
--  BEFORE RUNNING (see SECURITY_HARDENING.md):
--    • Take a backup (Database → Backups, or pg_dump).
--    • Create a Supabase Auth user for at least one admin whose email
--      matches an ACTIVE row in crm_users (Authentication → Users →
--      Add user, tick "Auto Confirm User"), or you will be locked out of
--      the app (the database itself stays reachable from the dashboard).
--
--  Safe to re-run (idempotent).
-- ════════════════════════════════════════════════════════════════════

-- ── 0. Pre-flight: refuse to run if it would lock everyone out ──────
do $$
begin
  if to_regclass('public.crm_users') is null then
    raise exception 'public.crm_users not found — is this the right database?';
  end if;

  if not exists (
    select 1
    from public.crm_users c
    join auth.users a
      on lower(a.email) = lower(c.email)
     and a.email_confirmed_at is not null
    where c.active
      and c.role in ('superadmin', 'admin')
  ) then
    raise exception
      'ABORTED: no active admin in crm_users has a confirmed Supabase Auth account with the same email. '
      'Create one first (Authentication → Users → Add user → Auto Confirm), then re-run.';
  end if;
end $$;

-- ── 1. Helper functions (SECURITY DEFINER so RLS can call them) ─────
-- Role of the signed-in caller, or NULL if they have no active CRM account.
-- Requires a CONFIRMED auth email so nobody can claim an address they
-- don't control.
create or replace function public.crm_role()
returns text
language sql stable security definer
set search_path = public, auth
as $$
  select c.role
  from public.crm_users c
  join auth.users a on a.id = auth.uid()
  where c.active
    and a.email_confirmed_at is not null
    and lower(c.email) = lower(a.email)
  limit 1
$$;

create or replace function public.crm_uid()
returns uuid
language sql stable security definer
set search_path = public, auth
as $$
  select c.id
  from public.crm_users c
  join auth.users a on a.id = auth.uid()
  where c.active
    and a.email_confirmed_at is not null
    and lower(c.email) = lower(a.email)
  limit 1
$$;

create or replace function public.crm_is_admin()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select coalesce(public.crm_role() in ('superadmin','admin'), false) $$;

create or replace function public.crm_can_edit()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select coalesce(public.crm_role() in ('superadmin','admin','manager','user'), false) $$;

-- The caller's own profile row (used by the app right after sign-in).
create or replace function public.crm_me()
returns setof public.crm_users
language sql stable security definer
set search_path = public, auth
as $$
  select * from public.crm_users where id = public.crm_uid()
$$;

-- Lets a user stamp their own last_login without any UPDATE permission.
create or replace function public.crm_touch_login()
returns void
language sql security definer
set search_path = public, auth
as $$
  update public.crm_users set last_login = now() where id = public.crm_uid()
$$;

-- Resolve an auth user id from an email (used only by the admin-users
-- Edge Function via the service role).
create or replace function public.crm_auth_user_id(p_email text)
returns uuid
language sql stable security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;

-- ── 2. Remove the legacy password column and enforce unique emails ──
alter table public.crm_users drop column if exists password;

do $$
begin
  create unique index if not exists crm_users_email_lower_uniq
    on public.crm_users (lower(email));
exception when unique_violation then
  raise notice 'Duplicate emails exist in crm_users — de-duplicate them, then create index crm_users_email_lower_uniq.';
end $$;

-- ── 3. Wipe every existing policy on CRM tables, enable RLS ─────────
do $$
declare
  r record;
  t text;
  tables text[] := array['prospects','crm_users','audit_log','system_settings','api_credentials','emails'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy %I on public.%I', r.policyname, t);
      end loop;
      execute format('alter table public.%I enable row level security', t);
      -- anon (not signed in) gets nothing, ever.
      execute format('revoke all on public.%I from anon', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- ── 4. Policies ─────────────────────────────────────────────────────
-- prospects: everyone with a CRM account reads; editors write; admins delete
create policy prospects_select on public.prospects
  for select to authenticated using (public.crm_role() is not null);
create policy prospects_insert on public.prospects
  for insert to authenticated with check (public.crm_can_edit());
create policy prospects_update on public.prospects
  for update to authenticated using (public.crm_can_edit()) with check (public.crm_can_edit());
create policy prospects_delete on public.prospects
  for delete to authenticated using (public.crm_is_admin());

-- crm_users: admins manage all; everyone else can read only their own row.
-- Only a superadmin may create/modify/delete a superadmin (prevents an
-- admin promoting themselves).
create policy crm_users_select on public.crm_users
  for select to authenticated
  using (public.crm_is_admin() or id = public.crm_uid());
create policy crm_users_insert on public.crm_users
  for insert to authenticated
  with check (public.crm_is_admin() and (role <> 'superadmin' or public.crm_role() = 'superadmin'));
create policy crm_users_update on public.crm_users
  for update to authenticated
  using      (public.crm_is_admin() and (role <> 'superadmin' or public.crm_role() = 'superadmin'))
  with check (public.crm_is_admin() and (role <> 'superadmin' or public.crm_role() = 'superadmin'));
create policy crm_users_delete on public.crm_users
  for delete to authenticated
  using (public.crm_is_admin() and role <> 'superadmin' and id <> public.crm_uid());

-- audit_log: append-only. Admins read; any CRM user may append an entry
-- under their own username (no spoofing). No update/delete policy = immutable.
create policy audit_select on public.audit_log
  for select to authenticated using (public.crm_is_admin());
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (
    public.crm_role() is not null
    and username = (select c.username from public.crm_users c where c.id = public.crm_uid())
  );

-- system_settings: read by CRM users, written by admins
create policy settings_select on public.system_settings
  for select to authenticated using (public.crm_role() is not null);
create policy settings_insert on public.system_settings
  for insert to authenticated with check (public.crm_is_admin());
create policy settings_update on public.system_settings
  for update to authenticated using (public.crm_is_admin()) with check (public.crm_is_admin());
create policy settings_delete on public.system_settings
  for delete to authenticated using (public.crm_is_admin());

-- emails: CRM users read/log; admins can clean up (guarded: schema not in repo)
do $$
begin
  if to_regclass('public.emails') is not null then
    execute 'create policy emails_select on public.emails for select to authenticated using (public.crm_role() is not null)';
    execute 'create policy emails_insert on public.emails for insert to authenticated with check (public.crm_can_edit())';
    execute 'create policy emails_update on public.emails for update to authenticated using (public.crm_is_admin()) with check (public.crm_is_admin())';
    execute 'create policy emails_delete on public.emails for delete to authenticated using (public.crm_is_admin())';
  end if;
end $$;

-- api_credentials: NO policies at all => no direct access from any browser
-- session. Access is only through the two functions below and the service
-- role used by Edge Functions.

-- ── 5. API-key functions (the only browser path to credentials) ─────
-- Which integrations have a key? Never returns the key itself.
create or replace function public.crm_api_key_status()
returns table (service text, configured boolean, updated_at timestamptz, updated_by text)
language sql stable security definer
set search_path = public, auth
as $$
  select a.service,
         coalesce(length(a.api_key), 0) > 0 as configured,
         a.updated_at,
         a.updated_by
  from public.api_credentials a
  where public.crm_role() is not null
$$;

-- Write-only, admin-only. Pass an empty string to remove a key.
create or replace function public.crm_set_api_credential(p_service text, p_key text)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_name text;
begin
  if not public.crm_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_service is null or p_service !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'Invalid service name';
  end if;

  select username into v_name from public.crm_users where id = public.crm_uid();

  update public.api_credentials
     set api_key = coalesce(p_key, ''), updated_by = v_name, updated_at = now()
   where service = p_service;
  if not found then
    insert into public.api_credentials (service, api_key, updated_by, updated_at)
    values (p_service, coalesce(p_key, ''), v_name, now());
  end if;
end $$;

-- ── 6. Purge third-party keys that older versions copied into settings ──
do $$
begin
  if to_regclass('public.system_settings') is not null then
    delete from public.system_settings where key ilike '%key' or key ilike '%secret' or key ilike '%token';
  end if;
end $$;

-- ── 7. Function privileges ──────────────────────────────────────────
revoke all on function public.crm_role(), public.crm_uid(), public.crm_is_admin(),
  public.crm_can_edit(), public.crm_me(), public.crm_touch_login(),
  public.crm_api_key_status(), public.crm_set_api_credential(text, text),
  public.crm_auth_user_id(text) from public, anon;

grant execute on function public.crm_role(), public.crm_uid(), public.crm_is_admin(),
  public.crm_can_edit(), public.crm_me(), public.crm_touch_login(),
  public.crm_api_key_status(), public.crm_set_api_credential(text, text)
  to authenticated;

-- crm_auth_user_id is for Edge Functions only
grant execute on function public.crm_auth_user_id(text) to service_role;
