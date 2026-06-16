-- =====================================================================
-- 04_workflow_reports_patch.sql
-- KPI workflow, status tracking, acknowledgement, and report fields
-- Run this AFTER 01_schema_rls.sql, 02_seed_demo.sql, and 03_email_auth_rls_patch.sql.
-- This patch is safe to re-run.
-- =====================================================================

alter table public.kpi_ratings
  add column if not exists status text not null default 'draft';

alter table public.kpi_ratings
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references public.employees(id) on delete restrict,
  add column if not exists approved_at timestamptz,
  add column if not exists returned_by uuid references public.employees(id) on delete restrict,
  add column if not exists returned_at timestamptz,
  add column if not exists review_comments text,
  add column if not exists acknowledged_by uuid references public.employees(id) on delete restrict,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists employee_comments text;

update public.kpi_ratings
set status = 'draft'
where status is null;

do $$
begin
  alter table public.kpi_ratings
    add constraint kpi_ratings_status_check
    check (status in ('draft','submitted','approved','returned','completed'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_kpi_ratings_status on public.kpi_ratings(status);
create index if not exists idx_kpi_ratings_submitted_at on public.kpi_ratings(submitted_at);
create index if not exists idx_kpi_ratings_approved_by on public.kpi_ratings(approved_by);
create index if not exists idx_kpi_ratings_acknowledged_by on public.kpi_ratings(acknowledged_by);

create or replace function public.current_user_can_review_rating(p_rating_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := public.current_employee_id();
  v_user_role text;
  v_user_level smallint;
  v_grader_level smallint;
  v_employee uuid;
  v_period_status text;
begin
  if v_user is null or p_rating_id is null then
    return false;
  end if;

  select r.name, r.level
    into v_user_role, v_user_level
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.id = v_user
    and e.is_active = true;

  select a.employee_id, gp.status, gr.level
    into v_employee, v_period_status, v_grader_level
  from public.kpi_ratings kr
  join public.kpi_assignments a on a.id = kr.assignment_id
  join public.grading_periods gp on gp.id = a.period_id
  join public.employees ge on ge.id = a.grader_id
  join public.roles gr on gr.id = ge.role_id
  where kr.id = p_rating_id;

  if v_employee is null or v_period_status <> 'open' then
    return false;
  end if;

  if not public.current_user_can_view_employee(v_employee) then
    return false;
  end if;

  -- Executive can review any submitted rating in visible scope.
  if v_user_role = 'executive' then
    return true;
  end if;

  -- Other leaders can review ratings prepared by lower hierarchy levels.
  return v_user_level is not null
     and v_grader_level is not null
     and v_user_level < v_grader_level;
end;
$$;

create or replace function public.approve_kpi_rating(
  p_rating_id uuid,
  p_review_comments text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.current_employee_id();
  v_rows int;
begin
  if not public.current_user_can_review_rating(p_rating_id) then
    raise exception 'You are not allowed to approve this KPI rating.';
  end if;

  update public.kpi_ratings
  set status = 'approved',
      approved_by = v_user,
      approved_at = now(),
      returned_by = null,
      returned_at = null,
      review_comments = nullif(trim(coalesce(p_review_comments, '')), '')
  where id = p_rating_id
    and status = 'submitted';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only submitted KPI ratings can be approved.';
  end if;

  return true;
end;
$$;

create or replace function public.return_kpi_rating(
  p_rating_id uuid,
  p_review_comments text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.current_employee_id();
  v_rows int;
begin
  if not public.current_user_can_review_rating(p_rating_id) then
    raise exception 'You are not allowed to return this KPI rating.';
  end if;

  update public.kpi_ratings
  set status = 'returned',
      returned_by = v_user,
      returned_at = now(),
      approved_by = null,
      approved_at = null,
      review_comments = coalesce(nullif(trim(coalesce(p_review_comments, '')), ''), 'Returned for revision.')
  where id = p_rating_id
    and status = 'submitted';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only submitted KPI ratings can be returned.';
  end if;

  return true;
end;
$$;

create or replace function public.acknowledge_kpi_rating(
  p_rating_id uuid,
  p_employee_comments text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.current_employee_id();
  v_employee uuid;
  v_status text;
  v_rows int;
begin
  if v_user is null then
    raise exception 'No employee profile found for the signed-in user.';
  end if;

  select a.employee_id, kr.status
    into v_employee, v_status
  from public.kpi_ratings kr
  join public.kpi_assignments a on a.id = kr.assignment_id
  where kr.id = p_rating_id;

  if v_employee is null then
    raise exception 'KPI rating not found.';
  end if;

  if v_employee <> v_user then
    raise exception 'You can only acknowledge your own KPI rating.';
  end if;

  if v_status not in ('approved', 'completed') then
    raise exception 'Only approved KPI ratings can be acknowledged.';
  end if;

  update public.kpi_ratings
  set status = 'completed',
      acknowledged_by = v_user,
      acknowledged_at = coalesce(acknowledged_at, now()),
      employee_comments = nullif(trim(coalesce(p_employee_comments, '')), '')
  where id = p_rating_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'KPI rating acknowledgement failed.';
  end if;

  return true;
end;
$$;

create or replace view public.assignment_details
with (security_invoker = true)
as
select
  a.id as assignment_id,
  a.period_id,
  gp.year,
  gp.quarter,
  gp.status as period_status,
  a.employee_id,
  e.full_name as employee_name,
  e.email as employee_email,
  e.manager_id,
  e.department_id,
  d.name as department_name,
  e.role_id,
  er.name as employee_role,
  a.grader_id,
  ge.full_name as grader_name,
  a.kpi_id,
  k.code as kpi_code,
  k.description as kpi_description,
  k.objective,
  k.kpi_goal,
  k.measurement_tool,
  k.frequency_of_monitoring,
  a.target,
  a.weight,
  a.rubric_5_exceeds,
  a.rubric_4_strong,
  a.rubric_3_meets,
  a.rubric_2_below,
  a.rubric_1_far_below,
  r.id as rating_id,
  r.rating,
  r.percentage_actual,
  r.weighted_rating,
  r.comments,
  r.graded_by,
  r.graded_at,
  r.status as rating_status,
  r.submitted_at,
  r.approved_by,
  r.approved_at,
  r.returned_by,
  r.returned_at,
  r.review_comments,
  r.acknowledged_by,
  r.acknowledged_at,
  r.employee_comments
from public.kpi_assignments a
join public.grading_periods gp on gp.id = a.period_id
join public.employees e on e.id = a.employee_id
left join public.departments d on d.id = e.department_id
join public.roles er on er.id = e.role_id
left join public.employees ge on ge.id = a.grader_id
join public.kpis k on k.id = a.kpi_id
left join public.kpi_ratings r on r.assignment_id = a.id;

grant select on public.assignment_details to authenticated;
grant execute on function public.current_user_can_review_rating(uuid) to authenticated;
grant execute on function public.approve_kpi_rating(uuid, text) to authenticated;
grant execute on function public.return_kpi_rating(uuid, text) to authenticated;
grant execute on function public.acknowledge_kpi_rating(uuid, text) to authenticated;

notify pgrst, 'reload schema';
