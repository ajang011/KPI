-- =====================================================================
-- KPI GRADING SYSTEM — Demo Seed Data
-- Run after 01_schema_rls.sql.
--
-- IMPORTANT:
-- employees.id references auth.users(id). For a real deployment, create the
-- users first in Supabase Auth, then replace the UUIDs below with real Auth IDs.
--
-- Optional demo-auth block is included for disposable/demo projects only.
-- Password for all demo users: DemoPass123!
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) OPTIONAL: CREATE DEMO AUTH USERS
-- ---------------------------------------------------------------------
-- Supabase Auth internals can change. If this block fails in your project,
-- create these emails in Authentication > Users, then update the UUIDs below.

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'executive.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'depthead.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supervisor.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teamlead.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rankfile.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rankfile2.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financehead.demo@ewhc.local', crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'executive.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000001','email','executive.demo@ewhc.local'), 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002', 'depthead.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000002','email','depthead.demo@ewhc.local'), 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000003', 'supervisor.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000003','email','supervisor.demo@ewhc.local'), 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000004', 'teamlead.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000004','email','teamlead.demo@ewhc.local'), 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000005', 'rankfile.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000005','email','rankfile.demo@ewhc.local'), 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000006', 'rankfile2.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000006','email','rankfile2.demo@ewhc.local'), 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000007', 'financehead.demo@ewhc.local', jsonb_build_object('sub','00000000-0000-0000-0000-000000000007','email','financehead.demo@ewhc.local'), 'email', now(), now(), now())
on conflict (provider, provider_id) do nothing;

-- ---------------------------------------------------------------------
-- 1) LOOKUP DATA
-- ---------------------------------------------------------------------

insert into public.roles (id, name, level) values
  (1, 'executive', 1),
  (2, 'department_head', 2),
  (3, 'supervisor', 3),
  (4, 'team_lead', 4),
  (5, 'rank_and_file', 5)
on conflict (id) do update set name = excluded.name, level = excluded.level;

insert into public.departments (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Executive Office'),
  ('10000000-0000-0000-0000-000000000002', 'Operations'),
  ('10000000-0000-0000-0000-000000000003', 'Finance')
on conflict (id) do update set name = excluded.name;

-- ---------------------------------------------------------------------
-- 2) EMPLOYEE CHAIN
-- ---------------------------------------------------------------------

insert into public.employees (id, email, full_name, department_id, role_id, manager_id, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'executive.demo@ewhc.local', 'Demo Executive', '10000000-0000-0000-0000-000000000001', 1, null, true)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  department_id = excluded.department_id,
  role_id = excluded.role_id,
  manager_id = excluded.manager_id,
  is_active = excluded.is_active;

insert into public.employees (id, email, full_name, department_id, role_id, manager_id, is_active) values
  ('00000000-0000-0000-0000-000000000002', 'depthead.demo@ewhc.local', 'Demo Operations Head', '10000000-0000-0000-0000-000000000002', 2, '00000000-0000-0000-0000-000000000001', true),
  ('00000000-0000-0000-0000-000000000007', 'financehead.demo@ewhc.local', 'Demo Finance Head', '10000000-0000-0000-0000-000000000003', 2, '00000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  department_id = excluded.department_id,
  role_id = excluded.role_id,
  manager_id = excluded.manager_id,
  is_active = excluded.is_active;

insert into public.employees (id, email, full_name, department_id, role_id, manager_id, is_active) values
  ('00000000-0000-0000-0000-000000000003', 'supervisor.demo@ewhc.local', 'Demo Supervisor', '10000000-0000-0000-0000-000000000002', 3, '00000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  department_id = excluded.department_id,
  role_id = excluded.role_id,
  manager_id = excluded.manager_id,
  is_active = excluded.is_active;

insert into public.employees (id, email, full_name, department_id, role_id, manager_id, is_active) values
  ('00000000-0000-0000-0000-000000000004', 'teamlead.demo@ewhc.local', 'Demo Team Lead', '10000000-0000-0000-0000-000000000002', 4, '00000000-0000-0000-0000-000000000003', true)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  department_id = excluded.department_id,
  role_id = excluded.role_id,
  manager_id = excluded.manager_id,
  is_active = excluded.is_active;

insert into public.employees (id, email, full_name, department_id, role_id, manager_id, is_active) values
  ('00000000-0000-0000-0000-000000000005', 'rankfile.demo@ewhc.local', 'Demo Rank and File 1', '10000000-0000-0000-0000-000000000002', 5, '00000000-0000-0000-0000-000000000004', true),
  ('00000000-0000-0000-0000-000000000006', 'rankfile2.demo@ewhc.local', 'Demo Rank and File 2', '10000000-0000-0000-0000-000000000002', 5, '00000000-0000-0000-0000-000000000004', true)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  department_id = excluded.department_id,
  role_id = excluded.role_id,
  manager_id = excluded.manager_id,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------
-- 3) GRADING PERIOD + KPI CATALOG
-- ---------------------------------------------------------------------

insert into public.grading_periods (id, year, quarter, start_date, end_date, status) values
  ('20000000-0000-0000-0000-000000000001', 2026, 'Q2', '2026-04-01', '2026-06-30', 'open')
on conflict (year, quarter) do update set
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  status = excluded.status;

insert into public.kpis (
  id,
  code,
  description,
  objective,
  kpi_goal,
  measurement_tool,
  frequency_of_monitoring,
  is_active
) values
  (
    '30000000-0000-0000-0000-000000000001',
    'QUALITY',
    'Quality and accuracy of completed work',
    'Ensure outputs are accurate, complete, and compliant with internal standards.',
    'Maintain high accuracy with minimal rework.',
    'Audit sampling, ticket review, quality checklist',
    'Monthly',
    true
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'PRODUCTIVITY',
    'Productivity and timely completion of assigned deliverables',
    'Ensure assigned work is completed within expected timelines.',
    'Meet or exceed volume and turnaround targets.',
    'Dashboard metrics, task logs, ticket reports',
    'Weekly',
    true
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    'COLLABORATION',
    'Collaboration, communication, and accountability',
    'Promote effective coordination and ownership across the team.',
    'Maintain proactive communication and dependable execution.',
    'Manager observation, peer feedback, project logs',
    'Quarterly',
    true
  )
on conflict (id) do update set
  code = excluded.code,
  description = excluded.description,
  objective = excluded.objective,
  kpi_goal = excluded.kpi_goal,
  measurement_tool = excluded.measurement_tool,
  frequency_of_monitoring = excluded.frequency_of_monitoring,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------
-- 4) SAMPLE KPI ASSIGNMENTS
-- Every employee except Executive gets 3 KPIs totaling 1.0000.
-- ---------------------------------------------------------------------

with assignment_source as (
  select
    gp.id as period_id,
    e.id as employee_id,
    k.id as kpi_id,
    case
      when e.role_id = 2 then '00000000-0000-0000-0000-000000000001'::uuid
      when e.role_id = 3 then '00000000-0000-0000-0000-000000000002'::uuid
      when e.role_id = 4 then '00000000-0000-0000-0000-000000000003'::uuid
      when e.role_id = 5 then '00000000-0000-0000-0000-000000000004'::uuid
    end as grader_id,
    case k.code
      when 'QUALITY' then 'Accuracy target: 95% or higher with minimal rework.'
      when 'PRODUCTIVITY' then 'Meet assigned turnaround time and volume target for the quarter.'
      when 'COLLABORATION' then 'Demonstrate proactive communication and ownership of assigned work.'
    end as target,
    case k.code
      when 'QUALITY' then 0.4000::numeric(5,4)
      when 'PRODUCTIVITY' then 0.3000::numeric(5,4)
      when 'COLLABORATION' then 0.3000::numeric(5,4)
    end as weight
  from public.employees e
  cross join public.kpis k
  cross join public.grading_periods gp
  where gp.year = 2026
    and gp.quarter = 'Q2'
    and e.role_id <> 1
)
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
  period_id,
  employee_id,
  kpi_id,
  grader_id,
  target,
  weight,
  '5 - Exceeds target consistently; output is excellent and can be used as benchmark.',
  '4 - Strong performance; minor gaps but generally above expected standards.',
  '3 - Meets expected target and performs reliably within standards.',
  '2 - Below target; needs improvement plan and closer monitoring.',
  '1 - Far below target; serious performance gap requiring intervention.'
from assignment_source
where grader_id is not null
on conflict (period_id, employee_id, kpi_id) do update set
  grader_id = excluded.grader_id,
  target = excluded.target,
  weight = excluded.weight,
  rubric_5_exceeds = excluded.rubric_5_exceeds,
  rubric_4_strong = excluded.rubric_4_strong,
  rubric_3_meets = excluded.rubric_3_meets,
  rubric_2_below = excluded.rubric_2_below,
  rubric_1_far_below = excluded.rubric_1_far_below;

-- ---------------------------------------------------------------------
-- 5) OPTIONAL SAMPLE RATINGS
-- ---------------------------------------------------------------------

insert into public.kpi_ratings (assignment_id, rating, comments, graded_by)
select a.id,
  case k.code
    when 'QUALITY' then 4
    when 'PRODUCTIVITY' then 5
    when 'COLLABORATION' then 4
  end as rating,
  'Demo rating for initial dashboard preview.',
  a.grader_id
from public.kpi_assignments a
join public.kpis k on k.id = a.kpi_id
where a.employee_id = '00000000-0000-0000-0000-000000000005'
on conflict (assignment_id) do update set
  rating = excluded.rating,
  comments = excluded.comments,
  graded_by = excluded.graded_by;
