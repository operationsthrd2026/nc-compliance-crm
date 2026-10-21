-- Phase 4: immutable outreach activity journal for existing CRM prospect records.
-- Additive migration: never changes, deletes, or rewrites existing prospects.
create table if not exists public.outreach_activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  activity_type text not null
    check (activity_type in ('note','email_prepared','email_sent','call','meeting','verification','reply','other')),
  summary text not null check (char_length(btrim(summary)) between 1 and 180),
  details text not null default '' check (char_length(details) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create index if not exists outreach_activities_prospect_timeline
  on public.outreach_activities (prospect_id, created_at desc);
create index if not exists outreach_activities_author_idx
  on public.outreach_activities (created_by);

alter table public.outreach_activities enable row level security;
-- No access for unauthenticated users or automatic mutable journal entries.
revoke all on table public.outreach_activities from anon, authenticated;
grant select, insert on table public.outreach_activities to authenticated;

drop policy if exists outreach_activities_read on public.outreach_activities;
create policy outreach_activities_read on public.outreach_activities
  for select to authenticated
  using ((select public.crm_role()) is not null);

drop policy if exists outreach_activities_append on public.outreach_activities;
create policy outreach_activities_append on public.outreach_activities
  for insert to authenticated
  with check (
    (select public.crm_can_edit())
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id
    )
  );

-- No UPDATE or DELETE grant or policy: audit events remain append-only.
comment on table public.outreach_activities is
  'CRM prospect manual activity history. Appending requires an active CRM editor. No automated outbound messages.';
