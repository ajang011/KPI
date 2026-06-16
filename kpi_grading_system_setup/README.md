# HTML KPI Grading System + Supabase Setup

This package contains a ready starter setup for a Supabase-backed KPI Grading System with a 5-level role hierarchy:

1. Executive
2. Department Head
3. Supervisor
4. Team Lead
5. Rank and File

The frontend is plain HTML/CSS/JS and can be hosted on basic static hosting. Supabase handles authentication, PostgreSQL data, RLS, score calculation, and audit history.

---

## Files

```text
01_schema_rls.sql          Full schema, constraints, functions, views, triggers, grants, and RLS policies
02_seed_demo.sql           Demo roles, departments, employees, period, KPIs, assignments, and sample ratings
frontend/index.html        Main app
frontend/styles.css        UI styling
frontend/app.js            Supabase client logic
frontend/config.example.js Copy to config.js and add your Supabase URL + anon key
```

---

## Setup Steps

### 1. Create a Supabase project

Create a new Supabase project, then go to:

```text
Project Settings > API
```

Copy:

```text
Project URL
anon public key
```

---

### 2. Run the SQL schema

Open Supabase SQL Editor and run:

```text
01_schema_rls.sql
```

This creates:

- `departments`
- `roles`
- `employees`
- `grading_periods`
- `kpis`
- `kpi_assignments`
- `kpi_ratings`
- `kpi_rating_history`
- recursive subordinate function
- centralized view permission function
- RLS policies
- audit triggers
- score views
- period lock and clone RPC functions

---

### 3. Run demo seed data

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

Important: `employees.id` references `auth.users(id)`. For production, keep `employees.id` aligned with the matching Supabase Auth user ID. The updated RLS helper also supports an email-based fallback for demos where Auth users were created manually and received different UUIDs.

---

### 4. Configure frontend

Inside `/frontend`, duplicate:

```text
config.example.js
```

Rename the copy to:

```text
config.js
```

Then update:

```js
window.KPI_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};
```

---

### 5. Host the frontend

Upload the contents of `/frontend` to any static hosting provider, such as:

- Hostinger static hosting
- Netlify
- Vercel
- cPanel public_html
- GitHub Pages

Make sure these files are in the same folder:

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

Make sure `public` schema is exposed.

Supabase JS v2 can be loaded through CDN, which is already included in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

---

## RLS Behavior

### Executive

Can view all grades across all departments.

### Department Head

Can view own grades plus everyone in the same department.

### Supervisor

Can view own grades plus all transitive subordinates.

### Team Lead

Can view own grades plus subordinate Rank and File employees.

### Rank and File

Can view own grades only.

---


## Role-Based Frontend Views

The frontend menu is now filtered according to the role viewing matrix.

| Role | Menu shown | Data visible | KPI Evaluation access |
|---|---|---|---|
| Executive | All Departments, KPI Evaluation, Admin | All departments and all employees | Assigned Department Head KPI assignments |
| Department Head | My Grades, Department View, KPI Evaluation | Own grades plus all employees in the same department | Assigned Supervisor KPI assignments |
| Supervisor | My Grades, My Team, KPI Evaluation | Own grades plus all transitive subordinates | Assigned Team Lead KPI assignments |
| Team Lead | My Grades, My Team, KPI Evaluation | Own grades plus direct Rank and File subordinates | Assigned Rank and File KPI assignments |
| Rank and File | My Grades | Own KPI assignments and ratings only | No evaluator menu |

`KPI Evaluation` is the renamed grader page. It only shows KPI assignments where the logged-in employee is the assigned evaluator. The expected grading chain is:

```text
Executive -> Department Head
Department Head -> Supervisor
Supervisor -> Team Lead
Team Lead -> Rank and File
```

The frontend also applies role-based filtering as a backup to RLS. This is helpful for local demos where RLS has been temporarily disabled while testing.

---

## Rating Calculation

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

## Lock Period Validation

An Executive can lock a grading period only when each assigned employee has KPI weights totaling `1.0000`.

RPC function:

```sql
select public.lock_grading_period('PERIOD_UUID_HERE');
```

To check issues:

```sql
select * from public.period_weight_issues('PERIOD_UUID_HERE');
```

---

## Clone Previous Quarter

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

This copies KPI assignments, weights, targets, and rubrics. It does not copy ratings.

---

## Production Notes

For production, do not directly insert into `auth.users`. Create users through Supabase Auth, invitation flow, or admin API, then insert/update matching rows in `public.employees` using the Auth user IDs.

Keep the anon key public; never put the service role key in frontend code.

---

## Report Buttons Added

The dashboard score tables now include two report actions:

1. **View Report** button per employee row
   - Opens an individual KPI rating report for that employee.
   - Shows the employee summary, rated KPI count, total weighted score, KPI details, rating, actual percentage, weighted score, comments, and graded date.

2. **Consolidated Report** button in the dashboard panel header
   - Opens a consolidated KPI record for the current visible scope.
   - Executive sees organization-level records.
   - Department Head sees department-level records.
   - Supervisor and Team Lead see their team scope.
   - Rank and File sees only their own record.

Both reports include a **Print / Save PDF** button. Use the browser print dialog and choose **Save as PDF** if a PDF copy is needed.

---

## Added Workflow and PDF Report Features

This version adds the following KPI workflow improvements:

1. **KPI status tracker**
   - Dashboard rows now show the employee evaluation status.
   - Status values include: `Not Started`, `In Progress`, `For Review`, `Approved`, `Returned`, `Completed`, and `Locked`.

2. **Save Draft / Submit for Review**
   - Evaluators can save ratings as draft.
   - Evaluators can submit completed ratings for review.

3. **Comments / justification per KPI**
   - Each KPI rating includes evaluator comments.
   - Returned evaluations can include reviewer comments.

4. **Approval / Return workflow**
   - Submitted ratings appear in a review queue for authorized higher-role users.
   - Reviewers can approve or return submitted evaluations.

5. **Employee acknowledgement**
   - Employees can acknowledge approved KPI ratings from their own dashboard.
   - Optional employee acknowledgement comments can be saved.

6. **Consolidated PDF report export**
   - The consolidated report button now opens the consolidated KPI record.
   - Use **Export PDF** in the report modal to save the consolidated record as PDF through the browser print dialog.

### Required SQL Patch

After replacing the frontend files, run this SQL file in Supabase SQL Editor:

```text
04_workflow_reports_patch.sql
```

This patch adds workflow columns to `kpi_ratings`, updates the `assignment_details` view, and creates these RPC functions:

```sql
approve_kpi_rating(p_rating_id, p_review_comments)
return_kpi_rating(p_rating_id, p_review_comments)
acknowledge_kpi_rating(p_rating_id, p_employee_comments)
current_user_can_review_rating(p_rating_id)
```

Run the patch after:

```text
01_schema_rls.sql
02_seed_demo.sql
03_email_auth_rls_patch.sql
```

Do not rerun `02_seed_demo.sql` unless you intentionally want to reseed demo data.
