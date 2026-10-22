-- Phase 5: additive, permission-scoped prospect task coordination.
-- Does not modify or delete existing prospect/activity records.
create table if not exists public.prospect_tasks (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  task_title text not null check (char_length(btrim(task_title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 3000),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'open'
    check (status in ('open','in_progress','completed','cancelled')),
  due_date date,
  assigned_to uuid not null references public.crm_users(id),
  created_by uuid not null default public.crm_uid() references public.crm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists prospect_tasks_assignee_due_idx
  on public.prospect_tasks (assigned_to, due_date, status);
create index if not exists prospect_tasks_prospect_idx
  on public.prospect_tasks (prospect_id, created_at desc);

create or replace function public.crm_task_stamps()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists prospect_tasks_stamp_trigger on public.prospect_tasks;
create trigger prospect_tasks_stamp_trigger
before insert or update on public.prospect_tasks
for each row execute function public.crm_task_stamps();

alter table public.prospect_tasks enable row level security;
revoke all on public.prospect_tasks from anon, authenticated;
grant select, insert on public.prospect_tasks to authenticated;
grant update (task_title, description, priority, status, due_date, assigned_to)
  on public.prospect_tasks to authenticated;

drop policy if exists prospect_tasks_select on public.prospect_tasks;
create policy prospect_tasks_select on public.prospect_tasks
for select to authenticated using (
  (select public.crm_is_admin())
  or assigned_to = (select public.crm_uid())
  or created_by = (select public.crm_uid())
);
drop policy if exists prospect_tasks_insert on public.prospect_tasks;
create policy prospect_tasks_insert on public.prospect_tasks
for insert to authenticated with check (
  (select public.crm_can_edit())
  and created_by = (select public.crm_uid())
  and ((select public.crm_is_admin()) or assigned_to = (select public.crm_uid()))
  and exists (
    select 1 from public.crm_users a where a.id = assigned_to
      and a.active and a.role in ('superadmin','admin','manager','user')
  )
);
drop policy if exists prospect_tasks_update on public.prospect_tasks;
create policy prospect_tasks_update on public.prospect_tasks
for update to authenticated
using (
  (select public.crm_can_edit())
  and ((select public.crm_is_admin()) or assigned_to = (select public.crm_uid()))
)
with check (
  (select public.crm_can_edit())
  and ((select public.crm_is_admin()) or assigned_to = (select public.crm_uid()))
  and exists (
    select 1 from public.crm_users a where a.id = assigned_to
      and a.active and a.role in ('superadmin','admin','manager','user')
  )
);
-- No DELETE permission or policy. Tasks are retained unless their parent
-- prospect is deleted by an authorized CRM administrator.
comment on table public.prospect_tasks is
 'CRM Phase 5: prospect-linked team tasks with server-enforced assignees, immutable authorship and no automated sending.';