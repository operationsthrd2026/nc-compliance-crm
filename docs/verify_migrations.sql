-- ════════════════════════════════════════════════════════════════════
--  Which migrations are ACTUALLY applied?  (read-only — changes nothing)
--  Paste into Supabase → SQL Editor → Run.  Every row should say ok = true.
--  A migration file existing in the repo does not mean it ran in production.
-- ════════════════════════════════════════════════════════════════════
select * from (
  select 1 as n, 'M1  security: crm_role() / crm_uid() helper functions' as check_name,
         (to_regprocedure('public.crm_role()') is not null and to_regprocedure('public.crm_uid()') is not null) as ok
  union all select 2,  'M1  RLS enabled on prospects',      coalesce((select relrowsecurity from pg_class where oid = 'public.prospects'::regclass), false)
  union all select 3,  'M1  signed-out (anon) cannot read prospects', not has_table_privilege('anon', 'public.prospects', 'select')
  union all select 4,  'M1  signed-out (anon) cannot read crm_users', not has_table_privilege('anon', 'public.crm_users', 'select')
  union all select 5,  'M1  old plaintext password column is gone',
         not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_users' and column_name='password')
  union all select 6,  'M2  prospects.tags / email_status columns',
         (select count(*) = 3 from information_schema.columns where table_schema='public' and table_name='prospects' and column_name in ('tags','email_status','email_checked_at'))
  union all select 7,  'M2  saved_searches table with RLS',  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.saved_searches')), false)
  union all select 8,  'M3  prospects.website / email / phone columns',
         (select count(*) = 3 from information_schema.columns where table_schema='public' and table_name='prospects' and column_name in ('website','email','phone'))
  union all select 9,  'M4  outreach_activities exists, RLS on', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.outreach_activities')), false)
  union all select 10, 'M4  outreach_activities is append-only (no UPDATE/DELETE for signed-in users)',
         to_regclass('public.outreach_activities') is not null
         and not has_table_privilege('authenticated', 'public.outreach_activities', 'update')
         and not has_table_privilege('authenticated', 'public.outreach_activities', 'delete')
  union all select 11, 'M4  outreach_activities not readable when signed out',
         to_regclass('public.outreach_activities') is not null and not has_table_privilege('anon', 'public.outreach_activities', 'select')
  union all select 12, 'M5  prospect_tasks exists, RLS on',  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.prospect_tasks')), false)
  union all select 13, 'M5  prospect_tasks cannot be deleted by signed-in users',
         to_regclass('public.prospect_tasks') is not null and not has_table_privilege('authenticated', 'public.prospect_tasks', 'delete')
  union all select 14, 'M5  prospect_tasks not readable when signed out',
         to_regclass('public.prospect_tasks') is not null and not has_table_privilege('anon', 'public.prospect_tasks', 'select')
  union all select 15, 'M6  saved_searches accepts the "workflow" view type',
         exists (select 1 from pg_constraint where conrelid = to_regclass('public.saved_searches') and contype = 'c' and pg_get_constraintdef(oid) ilike '%workflow%')
  union all select 16, 'M7  new prospects default HR-listed to Unknown (optional)',
         coalesce((select column_default ilike '%Unknown%' from information_schema.columns where table_schema='public' and table_name='prospects' and column_name='hr_person_listed'), false)
  union all select 17, 'ALL public tables have RLS on (no exposed tables)',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
  union all select 18, 'No allow-everything policies (USING true) remain',
         not exists (select 1 from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true'))
) t order by n;

-- If row 17 is false, this lists the exposed tables:
select c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
