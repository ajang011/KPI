# HTML KPI Grading System + Supabase Setup

This package contains a Supabase-backed KPI Grading System with a 5-level role hierarchy, role-based dashboards, KPI evaluation workflow, individual reports, consolidated reports, and PDF export through the browser print dialog.

The frontend is built with plain HTML, CSS, and JavaScript. Supabase handles authentication, PostgreSQL data, RLS, score calculation, workflow tracking, audit history, and RPC functions.

---

## Role Hierarchy

The system follows this grading and viewing hierarchy:

```text
Executive
↓
Department Head
↓
Supervisor
↓
Team Lead
↓
Rank and File
```

Expected grading chain:

```text
Executive -> Department Head
Department Head -> Supervisor
Supervisor -> Team Lead
Team Lead -> Rank and File
```

The employee’s immediate superior is the expected evaluator.

---

## Files

```text
01_schema_rls.sql              Full base schema, constraints, functions, views, triggers, grants, and RLS policies
02_seed_demo.sql               Demo roles, departments, employees, period, KPIs, assignments, and sample ratings
03_email_auth_rls_patch.sql    Email-based Auth/RLS patch for demo cases where Auth IDs and employee IDs differ
04_workflow_reports_patch.sql  Workflow/report patch for status, approval, return, acknowledgement, and report support

frontend/index.html            Main app
frontend/styles.css            UI styling
frontend/app.js                Supabase client logic and frontend views
frontend/config.example.js     Copy to config.js and add Supabase URL + public key
```

---

## Main Features

### Core KPI Features

* Supabase login authentication
* Role-based dashboard access
* KPI assignments per employee
* KPI rating input
* Weighted score calculation
* Employee period scores
* Audit history
* Period locking
* Previous quarter cloning

### Role-Based Frontend Views

* Executive: organization-wide dashboard
* Department Head: department dashboard
* Supervisor: team dashboard
* Team Lead: team dashboard
* Rank and File: own grades only

### Evaluation Workflow

* Save Draft
* Submit for Review
* Approve Evaluation
* Return Evaluation
* Employee Acknowledgement
* Reviewer comments
* Employee comments
* Status tracker

### Report Features

* View Report button per employee row
* Consolidated Report button per dashboard
* Individual KPI report
* Consolidated team/department/company report
* Print / Save as PDF support

---

## Setup Steps

## 1. Create a Supabase Project

Create a new Supabase project.

Go to:

```text
Project Settings > API
```

Copy:

```text
Project URL
anon public key / publishable key
```

For newer Supabase projects, the public frontend key may appear as a publishable key such as:

```text
sb_publishable_xxxxxxxxx
```

This can be used in the frontend config.

Never use the `service_role` key in frontend code.

---

## 2. Run the Base SQL Schema

Open Supabase SQL Editor and run:

```text
01_schema_rls.sql
```

This creates the base database setup:

* `departments`
* `roles`
* `employees`
* `grading_periods`
* `kpis`
* `kpi_assignments`
* `kpi_ratings`
* `kpi_rating_history`
* Recursive subordinate function
* Centralized view permission function
* RLS policies
* Audit triggers
* Score views
* Period lock RPC
* Clone previous quarter RPC

---

## 3. Run Demo Seed Data

For a disposable demo project, run:

```text
02_seed_demo.sql
```

Demo password for all users:

```text
DemoPass123!
```

Demo users:

```text
executive.demo@ewhc.local
financehead.demo@ewhc.local
depthead.demo@ewhc.local
supervisor.demo@ewhc.local
teamlead.demo@ewhc.local
rankfile.demo@ewhc.local
rankfile2.demo@ewhc.local
```

Important:

For production, do not directly insert into `auth.users`.

Use Supabase Authentication, invitation flow, or Admin API to create users, then insert/update the matching rows in `public.employees`.

For demos, if the Auth user ID and `employees.id` do not match, use the email-based patch in Step 4.

---

## 4. Run Email-Based Auth/RLS Patch

Run:

```text
03_email_auth_rls_patch.sql
```

This patch helps local/demo projects where Supabase Auth users were created manually and received different UUIDs from the demo employee IDs.

The frontend also uses email lookup as a fallback, so the app can still find the correct employee profile.

Run this after:

```text
01_schema_rls.sql
02_seed_demo.sql
```

---

## 5. Run Workflow and Report Patch

Run:

```text
04_workflow_reports_patch.sql
```

This patch adds workflow and report-related columns to `kpi_ratings`, updates report/evaluation support, and creates workflow RPC functions.

It adds these columns:

```text
status
submitted_at
approved_by
approved_at
returned_by
returned_at
review_comments
acknowledged_by
acknowledged_at
employee_comments
```

It also creates these RPC functions:

```sql
approve_kpi_rating(p_rating_id, p_review_comments)
return_kpi_rating(p_rating_id, p_review_comments)
acknowledge_kpi_rating(p_rating_id, p_employee_comments)
current_user_can_review_rating(p_rating_id)
```

Do not rerun `02_seed_demo.sql` unless you intentionally want to reset/reseed demo data.

---

## 6. Configure Frontend

Inside `/frontend`, duplicate:

```text
config.example.js
```

Rename the copy to:

```text
config.js
```

Then update it with your Supabase project details:

```js
window.KPI_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLIC_OR_PUBLISHABLE_KEY"
};
```

Example:

```js
window.KPI_CONFIG = {
  SUPABASE_URL: "https://your-project-id.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_xxxxxxxxx"
};
```

Make sure these files are in the same folder:

```text
index.html
styles.css
app.js
config.js
```

---

## 7. Run the Frontend Locally

Do not open `index.html` directly as a file.

Avoid this:

```text
file:///C:/Users/...
```

Use a local server instead.

From the `frontend` folder, run:

```bash
py -m http.server 5500
```

Then open:

```text
http://localhost:5500/index.html
```

or:

```text
http://127.0.0.1:5500/index.html
```

After making changes to frontend files, refresh using:

```text
Ctrl + Shift + R
```

---

## 8. Host the Frontend

Upload the contents of `/frontend` to any static hosting provider, such as:

* Hostinger static hosting
* Netlify
* Vercel
* cPanel `public_html`
* GitHub Pages

Required files:

```text
index.html
styles.css
app.js
config.js
```

---

## Important Supabase Settings

Go to:

```text
Project Settings > API > Data API
```

Make sure the `public` schema is exposed.

The frontend uses Supabase JS v2 through CDN, already included in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

---

# Role-Based Viewing Matrix

| Role            | Menu Shown                                 | Data Visible                                         | KPI Evaluation Access                                 |
| --------------- | ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Executive       | All Departments, KPI Evaluation, Admin     | All departments and all employees                    | Can evaluate assigned Department Head KPI assignments |
| Department Head | My Grades, Department View, KPI Evaluation | Own grades plus all employees in the same department | Can evaluate assigned Supervisor KPI assignments      |
| Supervisor      | My Grades, My Team, KPI Evaluation         | Own grades plus all transitive subordinates          | Can evaluate assigned Team Lead KPI assignments       |
| Team Lead       | My Grades, My Team, KPI Evaluation         | Own grades plus direct Rank and File subordinates    | Can evaluate assigned Rank and File KPI assignments   |
| Rank and File   | My Grades                                  | Own KPI assignments and ratings only                 | No evaluator menu                                     |

`KPI Evaluation` is the renamed grader page.

It only shows KPI assignments where the logged-in employee is the assigned evaluator.

---

# RLS Behavior

## Executive

Can view all grades across all departments.

## Department Head

Can view own grades plus everyone in the same department.

## Supervisor

Can view own grades plus all transitive subordinates.

## Team Lead

Can view own grades plus subordinate Rank and File employees.

## Rank and File

Can view own grades only.

The frontend also applies role-based filtering as a backup to RLS. This is useful for local demos where RLS may be temporarily disabled while testing.

---

# KPI Evaluation Workflow

## Status Values

Dashboard rows may show the following statuses:

```text
Not Started
In Progress
For Review
Approved
Returned
Completed
Locked
```

## Workflow Flow

```text
Evaluator saves rating as draft
↓
Evaluator submits rating for review
↓
Authorized reviewer approves or returns the rating
↓
Employee acknowledges approved rating
↓
Period can be locked when requirements are complete
```

## Evaluator Actions

Evaluators can:

* View assigned KPI evaluations
* Enter KPI ratings
* Add comments/justification
* Save ratings as draft
* Submit ratings for review

## Reviewer Actions

Authorized higher-role users can:

* Review submitted ratings
* Approve evaluations
* Return evaluations with comments

## Employee Actions

Employees can:

* View their own KPI grades
* View evaluator comments
* Acknowledge approved ratings
* Add employee acknowledgement comments

---

# Report Buttons

The dashboard score tables include two report actions.

## 1. View Report

Shown per employee row.

This opens an individual KPI rating report for the selected employee.

The report includes:

* Employee details
* Department
* Role
* Grading period
* KPI list
* KPI weight
* Rating
* Actual percentage
* Weighted score
* Evaluator comments
* Status
* Graded/submitted/approved date, if available

## 2. Consolidated Report

Shown outside the employee rows, usually in the dashboard panel/header.

This opens a consolidated KPI record for the current visible scope.

| Role            | Consolidated Report Shows         |
| --------------- | --------------------------------- |
| Executive       | Organization-wide records         |
| Department Head | Department-level records          |
| Supervisor      | Team/subordinate records          |
| Team Lead       | Direct Rank and File team records |
| Rank and File   | Own KPI record only               |

## PDF Export

Reports include:

```text
Print / Save PDF
Export PDF
```

This uses the browser print dialog.

To save as PDF:

```text
Click Export PDF
Choose Save as PDF
Save the file
```

---

# Rating Calculation

When a rating is inserted or updated:

```text
percentage_actual = rating / 5 * 100
weighted_rating = percentage_actual * weight
```

Example:

```text
rating = 4
weight = 0.3000
percentage_actual = 80.00
weighted_rating = 24.0000
```

Total score per employee per period is calculated in:

```text
employee_period_scores
```

---

# Score Interpretation

Suggested score labels:

| Score Range | Interpretation    |
| ----------: | ----------------- |
|      90–100 | Outstanding       |
|       80–89 | Very Satisfactory |
|       70–79 | Satisfactory      |
|       60–69 | Needs Improvement |
|    Below 60 | Unsatisfactory    |

These labels may be adjusted based on company policy.

---

# Lock Period Validation

An Executive can lock a grading period only when each assigned employee has KPI weights totaling:

```text
1.0000
```

RPC function:

```sql
select public.lock_grading_period('PERIOD_UUID_HERE');
```

To check issues:

```sql
select * from public.period_weight_issues('PERIOD_UUID_HERE');
```

---

# Clone Previous Quarter

Executive-only RPC:

```sql
select public.clone_previous_quarter(
  'SOURCE_PERIOD_UUID_HERE',
  2026,
  'Q3',
  '2026-07-01',
  '2026-09-30'
);
```

This copies:

* KPI assignments
* Weights
* Targets
* Rubrics

It does not copy ratings.

---

# Recommended SQL Run Order

For a fresh demo project, run in this order:

```text
01_schema_rls.sql
02_seed_demo.sql
03_email_auth_rls_patch.sql
04_workflow_reports_patch.sql
```

For an existing demo project where seed data already exists, run only the missing patches:

```text
03_email_auth_rls_patch.sql
04_workflow_reports_patch.sql
```

Do not rerun `02_seed_demo.sql` unless you want to reset/reseed demo data.

---

# Troubleshooting

## Error: Invalid login credentials

Meaning:

The user does not exist in Supabase Authentication or the password is incorrect.

Fix:

Go to:

```text
Supabase > Authentication > Users
```

Create or reset the user.

Demo password:

```text
DemoPass123!
```

---

## Error: Could not find table in schema cache

Example:

```text
Could not find the table 'public.employees' in the schema cache
```

Meaning:

The schema was not created or Supabase has not refreshed its cache.

Fix:

Run:

```sql
notify pgrst, 'reload schema';
```

Then refresh the app.

Also confirm that `01_schema_rls.sql` was run in the same Supabase project used by `frontend/config.js`.

---

## Error: Missing workflow column

Example:

```text
Could not find the 'approved_at' column of 'kpi_ratings' in the schema cache
```

Meaning:

`04_workflow_reports_patch.sql` has not been run or did not finish successfully.

Fix:

Run the workflow patch.

To manually check the columns:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
and table_name = 'kpi_ratings'
and column_name in (
  'status',
  'submitted_at',
  'approved_by',
  'approved_at',
  'returned_by',
  'returned_at',
  'review_comments',
  'acknowledged_by',
  'acknowledged_at',
  'employee_comments'
)
order by column_name;
```

If no rows are returned, run `04_workflow_reports_patch.sql`.

Then run:

```sql
notify pgrst, 'reload schema';
```

---

## Error: Auth ID and Employee ID mismatch

Meaning:

The logged-in Supabase Auth user ID is different from the employee ID in `public.employees`.

This can happen when users are created manually in Supabase Authentication instead of through the seed file.

Fix:

Run:

```text
03_email_auth_rls_patch.sql
```

The updated frontend also looks up employees by email as a fallback.

---

## Error: Database error querying schema

Possible causes:

* App was opened using `file:///`
* Supabase Auth user record is incomplete
* Schema cache has not refreshed
* SQL patches were run in a different Supabase project
* A required table/view/column is missing

Fix checklist:

1. Open the app through:

```text
http://localhost:5500/index.html
```

2. Run:

```sql
notify pgrst, 'reload schema';
```

3. Confirm `frontend/config.js` points to the correct Supabase project.

4. Confirm required patches were run.

---

## Error: `confirmed_at` can only be updated to DEFAULT

Meaning:

`confirmed_at` is a generated column in Supabase Auth and should not be manually updated.

Do not update `confirmed_at`.

Use `email_confirmed_at` instead when repairing demo Auth records.

---

# Production Notes

For production:

* Do not insert directly into `auth.users`
* Create users through Supabase Auth, invitation flow, or Admin API
* Keep `employees.id` aligned with the matching Supabase Auth user ID where possible
* Keep RLS enabled
* Do not expose the service role key
* Keep the anon/public/publishable key in frontend only
* Test role-based access using separate demo users
* Use HTTPS hosting
* Avoid manually deleting records that are referenced by foreign keys
* Use proper backup before running reset or truncate scripts

---

# Demo Login Reference

```text
executive.demo@ewhc.local     / DemoPass123!
financehead.demo@ewhc.local   / DemoPass123!
depthead.demo@ewhc.local      / DemoPass123!
supervisor.demo@ewhc.local    / DemoPass123!
teamlead.demo@ewhc.local      / DemoPass123!
rankfile.demo@ewhc.local      / DemoPass123!
rankfile2.demo@ewhc.local     / DemoPass123!
```
