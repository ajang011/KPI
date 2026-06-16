-- =====================================================================
-- KPI PATCH: Email-based Auth/RLS support
-- Use this when Supabase auth.users.id is different from public.employees.id.
-- Run this after 01_schema_rls.sql and 02_seed_demo.sql.
-- =====================================================================

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

-- Replace rating write policies so they accept the employee profile ID returned by current_employee_id().
drop policy if exists kpi_ratings_insert_grader_scope on public.kpi_ratings;
drop policy if exists kpi_ratings_update_grader_scope on public.kpi_ratings;

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

grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_user_role_name() to authenticated;
grant execute on function public.current_user_can_view_employee(uuid) to authenticated;
grant execute on function public.current_user_can_view_assignment(uuid) to authenticated;
grant execute on function public.current_user_can_write_rating(uuid) to authenticated;
grant execute on function public.current_user_can_manage_periods() to authenticated;

notify pgrst, 'reload schema';
