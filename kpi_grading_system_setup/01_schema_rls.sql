-- =====================================================================
-- KPI GRADING SYSTEM — Supabase PostgreSQL Setup
-- Tables, indexes, constraints, functions, views, RLS, triggers
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) LOOKUPS / MASTER TABLES
-- ---------------------------------------------------------------------

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id smallint primary key,
  name text not null unique check (name in (
    'executive',
    'department_head',
    'supervisor',
    'team_lead',
    'rank_and_file'
  )),
  level smallint not null unique check (level between 1 and 5)
);

create table if not exists public.employees (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  department_id uuid references public.departments(id) on delete restrict,
  role_id smallint not null references public.roles(id) on delete restrict,
  manager_id uuid references public.employees(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_employees_manager_id on public.employees(manager_id);
create index if not exists idx_employees_department_id on public.employees(department_id);
create index if not exists idx_employees_role_id on public.employees(role_id);

create table if not exists public.grading_periods (
  id uuid primary key default gen_random_uuid(),
  year int not null check (year between 2000 and 2100),
  quarter text not null check (quarter in ('Q1','Q2','Q3','Q4')),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','locked','archived')),
  created_at timestamptz not null default now(),
  constraint grading_period_valid_dates check (start_date <= end_date),
  constraint grading_period_unique unique (year, quarter)
);

create table if not exists public.kpis (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  objective text,
  kpi_goal text,
  measurement_tool text,
  frequency_of_monitoring text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- NOTE: weighted_rating is numeric(7,4), not numeric(6,4), because 100.0000
-- cannot fit in numeric(6,4). This preserves your formula: rating/5*100*weight.
create table if not exists public.kpi_assignments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.grading_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  kpi_id uuid not null references public.kpis(id) on delete restrict,
  grader_id uuid not null references public.employees(id) on delete restrict,
  target text,
  weight numeric(5,4) not null check (weight > 0 and weight <= 1),
  rubric_5_exceeds text,
  rubric_4_strong text,
  rubric_3_meets text,
  rubric_2_below text,
  rubric_1_far_below text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_assignment_unique unique (period_id, employee_id, kpi_id)
);

create index if not exists idx_kpi_assignments_period_employee on public.kpi_assignments(period_id, employee_id);
create index if not exists idx_kpi_assignments_grader_id on public.kpi_assignments(grader_id);
create index if not exists idx_kpi_assignments_kpi_id on public.kpi_assignments(kpi_id);

create table if not exists public.kpi_ratings (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.kpi_assignments(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  percentage_actual numeric(5,2),
  weighted_rating numeric(7,4),
  comments text,
  graded_by uuid not null references public.employees(id) on delete restrict,
  graded_at timestamptz not null default now()
);

create index if not exists idx_kpi_ratings_assignment_id on public.kpi_ratings(assignment_id);
create index if not exists idx_kpi_ratings_graded_by on public.kpi_ratings(graded_by);

create table if not exists public.kpi_rating_history (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null,
  assignment_id uuid not null,
  rating int,
  percentage_actual numeric(5,2),
  weighted_rating numeric(7,4),
  comments text,
  graded_by uuid,
  graded_at timestamptz,
  audit_operation text not null check (audit_operation in ('UPDATE','DELETE')),
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists idx_kpi_rating_history_rating_id on public.kpi_rating_history(rating_id);
create index if not exists idx_kpi_rating_history_assignment_id on public.kpi_rating_history(assignment_id);

-- ---------------------------------------------------------------------
-- 2) TRIGGERS: UPDATED_AT, HIERARCHY, RATING CALCULATION, AUDIT HISTORY
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_kpi_assignments_updated_at on public.kpi_assignments;
create trigger trg_kpi_assignments_updated_at
before update on public.kpi_assignments
for each row execute function public.set_updated_at();

create or replace function public.enforce_employee_hierarchy()
returns trigger
language plpgsql
as $$
declare
  v_role_level smallint;
  v_manager_level smallint;
  v_manager_department uuid;
begin
  new.email := lower(trim(new.email));

  select level into v_role_level
  from public.roles
  where id = new.role_id;

  if v_role_level is null then
    raise exception 'Invalid role_id: %', new.role_id;
  end if;

  if v_role_level = 1 then
    if new.manager_id is not null then
      raise exception 'Executive employees must not have a manager_id.';
    end if;
  else
    if new.manager_id is null then
      raise exception 'Non-executive employees must have a manager one level up.';
    end if;

    if new.manager_id = new.id then
      raise exception 'Employee cannot report to themselves.';
    end if;

    select r.level, e.department_id
      into v_manager_level, v_manager_department
    from public.employees e
    join public.roles r on r.id = e.role_id
    where e.id = new.manager_id
      and e.is_active = true;

    if v_manager_level is null then
      raise exception 'Manager must be an active employee.';
    end if;

    if v_manager_level <> v_role_level - 1 then
      raise exception 'Invalid reporting chain. Employee role level %, manager role level %. Manager must be one level up.', v_role_level, v_manager_level;
    end if;

    -- Department Heads report to Executives, who may sit outside department scope.
    -- Supervisors, Team Leads, and Rank and File should remain in their manager's department.
    if v_role_level in (3,4,5) and new.department_id is distinct from v_manager_department then
      raise exception 'Supervisor/Team Lead/Rank and File must be in the same department as their manager.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_employee_hierarchy on public.employees;
create trigger trg_enforce_employee_hierarchy
before insert or update of email, role_id, manager_id, department_id, is_active on public.employees
for each row execute function public.enforce_employee_hierarchy();

create or replace function public.calculate_kpi_rating()
returns trigger
language plpgsql
as $$
declare
  v_weight numeric(5,4);
begin
  select weight into v_weight
  from public.kpi_assignments
  where id = new.assignment_id;

  if v_weight is null then
    raise exception 'Assignment not found: %', new.assignment_id;
  end if;

  new.percentage_actual := round((new.rating::numeric / 5.0) * 100.0, 2);
  new.weighted_rating := round(new.percentage_actual * v_weight, 4);
  new.graded_at := coalesce(new.graded_at, now());

  if new.graded_by is null then
    new.graded_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_calculate_kpi_rating on public.kpi_ratings;
create trigger trg_calculate_kpi_rating
before insert or update of assignment_id, rating, comments, graded_by, graded_at on public.kpi_ratings
for each row execute function public.calculate_kpi_rating();

create or replace function public.audit_kpi_rating_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.kpi_rating_history (
    rating_id,
    assignment_id,
    rating,
    percentage_actual,
    weighted_rating,
    comments,
    graded_by,
    graded_at,
    audit_operation,
    changed_by,
    changed_at
  ) values (
    old.id,
    old.assignment_id,
    old.rating,
    old.percentage_actual,
    old.weighted_rating,
    old.comments,
    old.graded_by,
    old.graded_at,
    tg_op,
    auth.uid(),
    now()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_kpi_rating_changes on public.kpi_ratings;
create trigger trg_audit_kpi_rating_changes
before update or delete on public.kpi_ratings
for each row execute function public.audit_kpi_rating_changes();

-- ---------------------------------------------------------------------
-- 3) SECURITY / ROLE FUNCTIONS
-- ---------------------------------------------------------------------

create or replace function public.get_subordinate_ids(p_manager uuid)
returns table(employee_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive subordinates as (
    select e.id
    from public.employees e
    where e.manager_id = p_manager
      and e.is_active = true

    union all

    select e.id
    from public.employees e
    join subordinates s on e.manager_id = s.id
    where e.is_active = true
  )
  select id from subordinates;
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where e.is_active = true
    and (
      e.id = auth.uid()
      or lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by case when e.id = auth.uid() then 0 else 1 end
  limit 1;
$$;

create or replace function public.current_user_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.id = public.current_employee_id()
    and e.is_active = true
  limit 1;
$$;

create or replace function public.current_user_can_view_employee(p_target_employee uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := public.current_employee_id();
  v_role text;
  v_user_department uuid;
  v_target_department uuid;
begin
  if v_user is null or p_target_employee is null then
    return false;
  end if;

  select r.name, e.department_id
    into v_role, v_user_department
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.id = v_user
    and e.is_active = true;

  if v_role is null then
    return false;
  end if;

  if v_role = 'executive' then
    return true;
  end if;

  if p_target_employee = v_user then
    return true;
  end if;

  if v_role = 'department_head' then
    select department_id into v_target_department
    from public.employees
    where id = p_target_employee
      and is_active = true;

    return v_target_department is not null
       and v_user_department is not null
       and v_target_department = v_user_department;
  end if;

  if v_role in ('supervisor', 'team_lead') then
    return exists (
      select 1
      from public.get_subordinate_ids(v_user) s
      where s.employee_id = p_target_employee
    );
  end if;

  return false;
end;
$$;

create or replace function public.current_user_can_view_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_can_view_employee(a.employee_id), false)
  from public.kpi_assignments a
  where a.id = p_assignment_id;
$$;

create or replace function public.current_user_can_write_rating(p_assignment_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := public.current_employee_id();
  v_role text;
  v_grader uuid;
  v_employee uuid;
begin
  if v_user is null or p_assignment_id is null then
    return false;
  end if;

  v_role := public.current_user_role_name();

  select a.grader_id, a.employee_id
    into v_grader, v_employee
  from public.kpi_assignments a
  join public.grading_periods gp on gp.id = a.period_id
  where a.id = p_assignment_id
    and gp.status = 'open';

  if v_grader is null then
    return false;
  end if;

  if v_role = 'executive' then
    return true;
  end if;

  if v_role = 'department_head' then
    return public.current_user_can_view_employee(v_employee);
  end if;

  return v_grader = v_user;
end;
$$;

create or replace function public.current_user_can_manage_periods()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role_name() = 'executive', false);
$$;

create or replace function public.period_weight_issues(p_period_id uuid)
returns table(employee_id uuid, total_weight numeric, issue text)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.employee_id,
    round(sum(a.weight), 4) as total_weight,
    'WEIGHT_TOTAL_NOT_1_0000'::text as issue
  from public.kpi_assignments a
  where a.period_id = p_period_id
  group by a.employee_id
  having abs(sum(a.weight) - 1.0000) > 0.0001;
$$;

create or replace function public.lock_grading_period(p_period_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_manage_periods() then
    raise exception 'Only Executive users can lock grading periods.';
  end if;

  if not exists (select 1 from public.kpi_assignments where period_id = p_period_id) then
    raise exception 'Cannot lock period because it has no KPI assignments.';
  end if;

  if exists (select 1 from public.period_weight_issues(p_period_id)) then
    raise exception 'Cannot lock period. One or more employees do not have KPI weights totaling 1.0000.';
  end if;

  update public.grading_periods
  set status = 'locked'
  where id = p_period_id
    and status = 'open';

  return true;
end;
$$;

create or replace function public.clone_previous_quarter(
  p_source_period_id uuid,
  p_target_year int,
  p_target_quarter text,
  p_target_start_date date,
  p_target_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_period_id uuid;
begin
  if not public.current_user_can_manage_periods() then
    raise exception 'Only Executive users can clone grading periods.';
  end if;

  if p_target_quarter not in ('Q1','Q2','Q3','Q4') then
    raise exception 'Invalid quarter: %', p_target_quarter;
  end if;

  insert into public.grading_periods (year, quarter, start_date, end_date, status)
  values (p_target_year, p_target_quarter, p_target_start_date, p_target_end_date, 'open')
  returning id into v_new_period_id;

  insert into public.kpi_assignments (
    period_id,
    employee_id,
    kpi_id,
    grader_id,
    target,
    weight,
    rubric_5_exceeds,
    rubric_4_strong,
    rubric_3_meets,
    rubric_2_below,
    rubric_1_far_below
  )
  select
    v_new_period_id,
    employee_id,
    kpi_id,
    grader_id,
    target,
    weight,
    rubric_5_exceeds,
    rubric_4_strong,
    rubric_3_meets,
    rubric_2_below,
    rubric_1_far_below
  from public.kpi_assignments
  where period_id = p_source_period_id;

  return v_new_period_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) VIEWS
-- ---------------------------------------------------------------------

create or replace view public.employee_period_scores
with (security_invoker = true)
as
select
  a.employee_id,
  a.period_id,
  round(coalesce(sum(r.weighted_rating), 0), 4) as total_score
from public.kpi_assignments a
left join public.kpi_ratings r on r.assignment_id = a.id
group by a.employee_id, a.period_id;

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
  r.graded_at
from public.kpi_assignments a
join public.grading_periods gp on gp.id = a.period_id
join public.employees e on e.id = a.employee_id
left join public.departments d on d.id = e.department_id
join public.roles er on er.id = e.role_id
left join public.employees ge on ge.id = a.grader_id
join public.kpis k on k.id = a.kpi_id
left join public.kpi_ratings r on r.assignment_id = a.id;

create or replace view public.employee_period_scores_detailed
with (security_invoker = true)
as
select
  eps.employee_id,
  e.full_name as employee_name,
  e.email as employee_email,
  e.department_id,
  d.name as department_name,
  e.role_id,
  r.name as role_name,
  e.manager_id,
  m.full_name as manager_name,
  eps.period_id,
  gp.year,
  gp.quarter,
  gp.status as period_status,
  eps.total_score
from public.employee_period_scores eps
join public.employees e on e.id = eps.employee_id
left join public.departments d on d.id = e.department_id
join public.roles r on r.id = e.role_id
left join public.employees m on m.id = e.manager_id
join public.grading_periods gp on gp.id = eps.period_id;

-- ---------------------------------------------------------------------
-- 5) ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.roles enable row level security;
alter table public.employees enable row level security;
alter table public.grading_periods enable row level security;
alter table public.kpis enable row level security;
alter table public.kpi_assignments enable row level security;
alter table public.kpi_ratings enable row level security;
alter table public.kpi_rating_history enable row level security;

-- Drop policies so this script can be re-run safely.
drop policy if exists departments_select_authenticated on public.departments;
drop policy if exists roles_select_authenticated on public.roles;
drop policy if exists employees_select_role_scope on public.employees;
drop policy if exists grading_periods_select_authenticated on public.grading_periods;
drop policy if exists grading_periods_manage_executive on public.grading_periods;
drop policy if exists kpis_select_authenticated on public.kpis;
drop policy if exists kpis_manage_executive_depthead on public.kpis;
drop policy if exists kpi_assignments_select_role_scope on public.kpi_assignments;
drop policy if exists kpi_assignments_manage_executive_depthead on public.kpi_assignments;
drop policy if exists kpi_ratings_select_role_scope on public.kpi_ratings;
drop policy if exists kpi_ratings_insert_grader_scope on public.kpi_ratings;
drop policy if exists kpi_ratings_update_grader_scope on public.kpi_ratings;
drop policy if exists kpi_ratings_delete_executive_only on public.kpi_ratings;
drop policy if exists kpi_rating_history_select_role_scope on public.kpi_rating_history;

create policy departments_select_authenticated
on public.departments
for select
to authenticated
using (true);

create policy roles_select_authenticated
on public.roles
for select
to authenticated
using (true);

create policy employees_select_role_scope
on public.employees
for select
to authenticated
using (public.current_user_can_view_employee(id));

create policy grading_periods_select_authenticated
on public.grading_periods
for select
to authenticated
using (true);

create policy grading_periods_manage_executive
on public.grading_periods
for all
to authenticated
using (public.current_user_can_manage_periods())
with check (public.current_user_can_manage_periods());

create policy kpis_select_authenticated
on public.kpis
for select
to authenticated
using (true);

create policy kpis_manage_executive_depthead
on public.kpis
for all
to authenticated
using (public.current_user_role_name() in ('executive','department_head'))
with check (public.current_user_role_name() in ('executive','department_head'));

create policy kpi_assignments_select_role_scope
on public.kpi_assignments
for select
to authenticated
using (public.current_user_can_view_employee(employee_id));

create policy kpi_assignments_manage_executive_depthead
on public.kpi_assignments
for all
to authenticated
using (public.current_user_role_name() in ('executive','department_head'))
with check (public.current_user_role_name() in ('executive','department_head'));

create policy kpi_ratings_select_role_scope
on public.kpi_ratings
for select
to authenticated
using (public.current_user_can_view_assignment(assignment_id));

create policy kpi_ratings_insert_grader_scope
on public.kpi_ratings
for insert
to authenticated
with check (
  public.current_user_can_write_rating(assignment_id)
  and graded_by = public.current_employee_id()
);

create policy kpi_ratings_update_grader_scope
on public.kpi_ratings
for update
to authenticated
using (public.current_user_can_write_rating(assignment_id))
with check (
  public.current_user_can_write_rating(assignment_id)
  and graded_by = public.current_employee_id()
);

create policy kpi_ratings_delete_executive_only
on public.kpi_ratings
for delete
to authenticated
using (public.current_user_role_name() = 'executive');

create policy kpi_rating_history_select_role_scope
on public.kpi_rating_history
for select
to authenticated
using (public.current_user_can_view_assignment(assignment_id));

-- ---------------------------------------------------------------------
-- 6) GRANTS FOR SUPABASE DATA API
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.departments to authenticated;
grant select on public.roles to authenticated;
grant select on public.employees to authenticated;
grant select on public.grading_periods to authenticated;
grant select on public.kpis to authenticated;
grant select, insert, update, delete on public.kpi_assignments to authenticated;
grant select, insert, update, delete on public.kpi_ratings to authenticated;
grant select on public.kpi_rating_history to authenticated;

grant select on public.employee_period_scores to authenticated;
grant select on public.assignment_details to authenticated;
grant select on public.employee_period_scores_detailed to authenticated;

grant execute on function public.get_subordinate_ids(uuid) to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_user_role_name() to authenticated;
grant execute on function public.current_user_can_view_employee(uuid) to authenticated;
grant execute on function public.current_user_can_view_assignment(uuid) to authenticated;
grant execute on function public.current_user_can_write_rating(uuid) to authenticated;
grant execute on function public.current_user_can_manage_periods() to authenticated;
grant execute on function public.period_weight_issues(uuid) to authenticated;
grant execute on function public.lock_grading_period(uuid) to authenticated;
grant execute on function public.clone_previous_quarter(uuid, int, text, date, date) to authenticated;
