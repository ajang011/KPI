const config = window.KPI_CONFIG || {};
const db = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

const state = {
  user: null,
  profile: null,
  periods: [],
  selectedPeriodId: null,
  activePage: "dashboard",
  rows: [],
  allRows: []
};

const els = {
  loginView: document.getElementById("loginView"),
  appView: document.getElementById("appView"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginBtn: document.getElementById("loginBtn"),
  loginMessage: document.getElementById("loginMessage"),
  logoutBtn: document.getElementById("logoutBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  periodSelect: document.getElementById("periodSelect"),
  pageTitle: document.getElementById("pageTitle"),
  profileSummary: document.getElementById("profileSummary"),
  navMenu: document.getElementById("navMenu"),
  dashboardCards: document.getElementById("dashboardCards"),
  mainPanel: document.getElementById("mainPanel"),
  statusBar: document.getElementById("statusBar"),
  adminActions: document.getElementById("adminActions"),
  lockPeriodBtn: document.getElementById("lockPeriodBtn"),
  clonePeriodBtn: document.getElementById("clonePeriodBtn")
};

const roleLabels = {
  executive: "Executive",
  department_head: "Department Head",
  supervisor: "Supervisor",
  team_lead: "Team Lead",
  rank_and_file: "Rank and File"
};

function showMessage(message, isError = false) {
  els.statusBar.textContent = message;
  els.statusBar.classList.toggle("error", isError);
  els.statusBar.classList.remove("hidden");
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => els.statusBar.classList.add("hidden"), 5200);
}

function getErrorMessage(error, fallback = "Something went wrong.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;

  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(`Details: ${error.details}`);
  if (error.hint) parts.push(`Hint: ${error.hint}`);
  if (error.code) parts.push(`Code: ${error.code}`);
  if (error.status) parts.push(`Status: ${error.status}`);
  if (error.error_description) parts.push(error.error_description);

  if (parts.length) return parts.join(" | ");

  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch (_) {
    // Ignore stringify errors.
  }

  return `${fallback} Open the browser Console/Network tab for details.`;
}

function reportError(context, error, target = null) {
  console.error(context, error);
  const message = `${context}: ${getErrorMessage(error, "Empty error object received.")}`;
  if (target) target.textContent = message;
  else showMessage(message, true);
  return message;
}

function moneyScore(value) {
  const num = Number(value || 0);
  return `${num.toFixed(2)}%`;
}

function roleLabel(role) {
  return roleLabels[role] || role || "Unknown";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function ratingLabel(row) {
  return row.rating ? `${row.rating} / 5` : "Not rated";
}

function weightLabel(value) {
  return `${(Number(value || 0) * 100).toFixed(0)}%`;
}


const ratingStatusLabels = {
  not_started: "Not Started",
  draft: "In Progress",
  in_progress: "In Progress",
  submitted: "For Review",
  approved: "Approved",
  returned: "Returned",
  completed: "Completed",
  locked: "Locked"
};

function normalizeRatingStatus(row) {
  if (row?.period_status === "locked") return "locked";
  if (!row?.rating && !row?.rating_id) return "not_started";
  return row?.rating_status || row?.status || "draft";
}

function statusLabel(status) {
  return ratingStatusLabels[status] || status || "Not Started";
}

function statusClass(status) {
  return String(status || "not_started").replace(/[^a-z0-9_-]/gi, "_");
}

function employeeRowsFor(employeeId, rows = state.rows) {
  return (rows || []).filter(row => row.employee_id === employeeId);
}

function employeeWorkflowStatus(employeeRows = []) {
  if (!employeeRows.length) return "not_started";
  if (employeeRows.some(row => row.period_status === "locked")) return "locked";

  const statuses = employeeRows.map(normalizeRatingStatus);
  const rated = employeeRows.filter(row => row.rating).length;

  if (rated === 0) return "not_started";
  if (statuses.includes("returned")) return "returned";
  if (statuses.includes("submitted")) return "submitted";
  if (rated < employeeRows.length || statuses.includes("draft") || statuses.includes("in_progress")) return "in_progress";
  if (statuses.every(status => status === "completed")) return "completed";
  if (statuses.every(status => ["approved", "completed"].includes(status))) return "approved";
  return "in_progress";
}

function getAcknowledgeableRows(employeeId, rows = state.rows) {
  return employeeRowsFor(employeeId, rows).filter(row =>
    row.rating_id
    && normalizeRatingStatus(row) === "approved"
    && !row.acknowledged_at
    && (row.employee_id === currentEmployeeId() || row.employee_email === state.user?.email)
  );
}

function canAcknowledgeEmployee(employeeId, rows = state.rows) {
  return getAcknowledgeableRows(employeeId, rows).length > 0;
}

function currentEmployeeId() {
  return state.profile?.id || state.user?.id || null;
}

function currentRole() {
  return state.profile?.role_name || "";
}

function isExecutive() {
  return currentRole() === "executive";
}

function canSeeTeam() {
  return ["team_lead", "supervisor", "department_head"].includes(currentRole());
}

function canUseEvaluatorView() {
  return ["executive", "department_head", "supervisor", "team_lead"].includes(currentRole());
}

function isOwnEmployee(row) {
  return row.employee_id === currentEmployeeId() || row.employee_email === state.user?.email;
}

function employeeMapFromRows(rows = state.allRows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.employee_id || map.has(row.employee_id)) continue;
    map.set(row.employee_id, {
      id: row.employee_id,
      email: row.employee_email,
      manager_id: row.manager_id,
      department_id: row.department_id,
      role: row.employee_role
    });
  }
  return map;
}

function getSubordinateIds(managerId = currentEmployeeId(), rows = state.allRows) {
  const employees = Array.from(employeeMapFromRows(rows).values());
  const subordinateIds = new Set();
  let added = true;

  while (added) {
    added = false;
    for (const employee of employees) {
      const reportsToCurrentManager = employee.manager_id === managerId;
      const reportsToKnownSubordinate = subordinateIds.has(employee.manager_id);

      if ((reportsToCurrentManager || reportsToKnownSubordinate) && !subordinateIds.has(employee.id)) {
        subordinateIds.add(employee.id);
        added = true;
      }
    }
  }

  return subordinateIds;
}

function canViewEmployeeRow(row) {
  const role = currentRole();

  if (isExecutive()) return true;
  if (isOwnEmployee(row)) return true;

  if (role === "department_head") {
    return !!state.profile?.department_id && row.department_id === state.profile.department_id;
  }

  if (["supervisor", "team_lead"].includes(role)) {
    return getSubordinateIds().has(row.employee_id);
  }

  return false;
}

function roleScopedRows(rows = state.allRows) {
  return rows.filter(canViewEmployeeRow);
}

function rowsForMyGrades() {
  return state.rows.filter(isOwnEmployee);
}

function rowsForDepartment() {
  return state.rows.filter(row => row.department_id === state.profile?.department_id);
}

function rowsForTeamOnly() {
  const role = currentRole();

  if (role === "department_head") {
    return rowsForDepartment();
  }

  const subordinateIds = getSubordinateIds();
  return state.rows.filter(row => subordinateIds.has(row.employee_id));
}

function rowsForEvaluatorView() {
  if (!canUseEvaluatorView()) return [];

  return state.rows.filter(row => {
    const assignedToMe = row.grader_id === currentEmployeeId();
    const assignedByEmailFallback = row.grader_id === state.user?.id;
    return assignedToMe || assignedByEmailFallback;
  });
}

function canGrade(row) {
  return rowsForEvaluatorView().some(item => item.assignment_id === row.assignment_id)
    && row.period_status === "open";
}

function normalizePageForRole(page) {
  if (page === "team" && !canSeeTeam()) return "dashboard";
  if (page === "grader" && !canUseEvaluatorView()) return "dashboard";
  if (page === "admin" && !isExecutive()) return "dashboard";
  return page;
}

async function init() {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes("YOUR_PROJECT")) {
    els.loginMessage.textContent = "Missing Supabase config. Rename config.example.js to config.js and set your keys.";
    return;
  }

  const { data } = await db.auth.getSession();
  if (data.session) {
    state.user = data.session.user;
    await bootstrapApp();
  }
}

async function login() {
  els.loginMessage.textContent = "";
  els.loginBtn.disabled = true;

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: els.loginEmail.value.trim(),
      password: els.loginPassword.value
    });

    if (error) {
      reportError("Login failed", error, els.loginMessage);
      return;
    }

    state.user = data.user;
    await bootstrapApp();
  } catch (error) {
    reportError("Login failed while loading profile or dashboard", error, els.loginMessage);
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function logout() {
  await db.auth.signOut();
  state.user = null;
  state.profile = null;
  state.rows = [];
  state.allRows = [];
  els.appView.classList.add("hidden");
  els.loginView.classList.remove("hidden");
}

async function bootstrapApp() {
  await loadProfile();
  await loadPeriods();
  renderShell();
  await loadPage("dashboard");
  els.loginView.classList.add("hidden");
  els.appView.classList.remove("hidden");
}

async function loadProfile() {
  const { data: employee, error: employeeError } = await db
    .from("employees")
    .select("*")
    .eq("email", state.user.email)
    .maybeSingle();

  if (employeeError) throw new Error(`Employee profile query failed: ${getErrorMessage(employeeError)}`);

  if (!employee) {
    throw new Error(`No employee profile found for ${state.user.email} / ${state.user.id}`);
  }

  let role = null;
  let department = null;

  if (employee.role_id) {
    const { data: roleData, error: roleError } = await db
      .from("roles")
      .select("name, level")
      .eq("id", employee.role_id)
      .maybeSingle();

    if (roleError) throw new Error(`Role query failed: ${getErrorMessage(roleError)}`);
    role = roleData;
  }

  if (employee.department_id) {
    const { data: departmentData, error: departmentError } = await db
      .from("departments")
      .select("name")
      .eq("id", employee.department_id)
      .maybeSingle();

    if (departmentError) throw new Error(`Department query failed: ${getErrorMessage(departmentError)}`);
    department = departmentData;
  }

  state.profile = {
    ...employee,
    role_name: role?.name,
    role_level: role?.level,
    department_name: department?.name || "No Department"
  };

  console.log("Loaded profile:", state.profile);
}

async function loadPeriods() {
  const { data, error } = await db
    .from("grading_periods")
    .select("id,year,quarter,start_date,end_date,status")
    .order("year", { ascending: false })
    .order("quarter", { ascending: false });

  if (error) throw new Error(`Grading periods query failed: ${getErrorMessage(error)}`);

  state.periods = data || [];
  const openPeriod = state.periods.find(p => p.status === "open");
  state.selectedPeriodId = state.selectedPeriodId || openPeriod?.id || state.periods[0]?.id || null;
}

function renderShell() {
  els.profileSummary.textContent = `${state.profile.full_name} • ${roleLabel(state.profile.role_name)} • ${state.profile.department_name}`;

  els.periodSelect.innerHTML = state.periods.map(period => {
    const selected = period.id === state.selectedPeriodId ? "selected" : "";
    return `<option value="${period.id}" ${selected}>${period.quarter} ${period.year} — ${period.status}</option>`;
  }).join("");

  state.activePage = normalizePageForRole(state.activePage);

  const navItems = [];

  if (isExecutive()) {
    navItems.push({ id: "dashboard", label: "All Departments" });
  } else {
    navItems.push({ id: "dashboard", label: "My Grades" });
  }

  if (canSeeTeam()) {
    navItems.push({
      id: "team",
      label: currentRole() === "department_head" ? "Department View" : "My Team"
    });
  }

  if (canUseEvaluatorView()) {
    navItems.push({ id: "grader", label: "KPI Evaluation" });
  }

  if (isExecutive()) navItems.push({ id: "admin", label: "Admin" });

  els.navMenu.innerHTML = navItems.map(item => `
    <button class="nav-link ${state.activePage === item.id ? "active" : ""}" data-page="${item.id}">${item.label}</button>
  `).join("");

  els.navMenu.querySelectorAll(".nav-link").forEach(btn => {
    btn.addEventListener("click", () => loadPage(btn.dataset.page));
  });

  els.adminActions.classList.toggle("hidden", !isExecutive());
}

async function fetchAssignmentDetailsFromView() {
  const { data, error } = await db
    .from("assignment_details")
    .select("*")
    .eq("period_id", state.selectedPeriodId)
    .order("department_name", { ascending: true })
    .order("employee_name", { ascending: true })
    .order("kpi_code", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchAssignmentDetailsManual() {
  const { data: assignments, error: assignmentError } = await db
    .from("kpi_assignments")
    .select("*")
    .eq("period_id", state.selectedPeriodId);

  if (assignmentError) throw new Error(`KPI assignments query failed: ${getErrorMessage(assignmentError)}`);

  const ratingSelectWithWorkflow = "id,assignment_id,rating,percentage_actual,weighted_rating,comments,graded_by,graded_at,status,submitted_at,approved_by,approved_at,returned_by,returned_at,review_comments,acknowledged_by,acknowledged_at,employee_comments";

  async function fetchRatingsForManualBuild() {
    const result = await db.from("kpi_ratings").select(ratingSelectWithWorkflow);
    if (!result.error) return result;

    console.warn("Workflow columns are not available yet; run 04_workflow_reports_patch.sql for full workflow features.", result.error);
    return db.from("kpi_ratings").select("id,assignment_id,rating,percentage_actual,weighted_rating,comments,graded_by,graded_at");
  }

  const [{ data: employees, error: employeeError }, { data: roles, error: roleError }, { data: departments, error: departmentError }, { data: kpis, error: kpiError }, { data: ratings, error: ratingError }] = await Promise.all([
    db.from("employees").select("id,email,full_name,manager_id,department_id,role_id,is_active"),
    db.from("roles").select("id,name,level"),
    db.from("departments").select("id,name"),
    db.from("kpis").select("id,code,description,objective,kpi_goal,measurement_tool,frequency_of_monitoring"),
    fetchRatingsForManualBuild()
  ]);

  if (employeeError) throw new Error(`Employees query failed: ${getErrorMessage(employeeError)}`);
  if (roleError) throw new Error(`Roles query failed: ${getErrorMessage(roleError)}`);
  if (departmentError) throw new Error(`Departments query failed: ${getErrorMessage(departmentError)}`);
  if (kpiError) throw new Error(`KPIs query failed: ${getErrorMessage(kpiError)}`);
  if (ratingError) throw new Error(`KPI ratings query failed: ${getErrorMessage(ratingError)}`);

  const employeeMap = new Map((employees || []).map(item => [item.id, item]));
  const roleMap = new Map((roles || []).map(item => [item.id, item]));
  const departmentMap = new Map((departments || []).map(item => [item.id, item]));
  const kpiMap = new Map((kpis || []).map(item => [item.id, item]));
  const ratingMap = new Map((ratings || []).map(item => [item.assignment_id, item]));
  const period = currentPeriod() || {};

  return (assignments || []).map(assignment => {
    const employee = employeeMap.get(assignment.employee_id) || {};
    const grader = employeeMap.get(assignment.grader_id) || {};
    const role = roleMap.get(employee.role_id) || {};
    const department = departmentMap.get(employee.department_id) || {};
    const kpi = kpiMap.get(assignment.kpi_id) || {};
    const rating = ratingMap.get(assignment.id) || {};

    return {
      assignment_id: assignment.id,
      period_id: assignment.period_id,
      year: period.year,
      quarter: period.quarter,
      period_status: period.status,
      employee_id: assignment.employee_id,
      employee_name: employee.full_name,
      employee_email: employee.email,
      manager_id: employee.manager_id,
      department_id: employee.department_id,
      department_name: department.name,
      role_id: employee.role_id,
      employee_role: role.name,
      grader_id: assignment.grader_id,
      grader_name: grader.full_name,
      kpi_id: assignment.kpi_id,
      kpi_code: kpi.code,
      kpi_description: kpi.description,
      objective: kpi.objective,
      kpi_goal: kpi.kpi_goal,
      measurement_tool: kpi.measurement_tool,
      frequency_of_monitoring: kpi.frequency_of_monitoring,
      target: assignment.target,
      weight: assignment.weight,
      rubric_5_exceeds: assignment.rubric_5_exceeds,
      rubric_4_strong: assignment.rubric_4_strong,
      rubric_3_meets: assignment.rubric_3_meets,
      rubric_2_below: assignment.rubric_2_below,
      rubric_1_far_below: assignment.rubric_1_far_below,
      rating_id: rating.id,
      rating: rating.rating,
      percentage_actual: rating.percentage_actual,
      weighted_rating: rating.weighted_rating,
      comments: rating.comments,
      graded_by: rating.graded_by,
      graded_at: rating.graded_at,
      rating_status: rating.status,
      submitted_at: rating.submitted_at,
      approved_by: rating.approved_by,
      approved_at: rating.approved_at,
      returned_by: rating.returned_by,
      returned_at: rating.returned_at,
      review_comments: rating.review_comments,
      acknowledged_by: rating.acknowledged_by,
      acknowledged_at: rating.acknowledged_at,
      employee_comments: rating.employee_comments
    };
  }).sort((a, b) =>
    String(a.department_name || "").localeCompare(String(b.department_name || "")) ||
    String(a.employee_name || "").localeCompare(String(b.employee_name || "")) ||
    String(a.kpi_code || "").localeCompare(String(b.kpi_code || ""))
  );
}

async function fetchAssignmentDetails() {
  if (!state.selectedPeriodId) return [];

  let data = [];
  try {
    data = await fetchAssignmentDetailsFromView();
  } catch (error) {
    console.warn("assignment_details view failed; trying manual table fallback.", error);
    data = await fetchAssignmentDetailsManual();
  }

  state.allRows = data || [];
  state.rows = roleScopedRows(state.allRows);
  return state.rows;
}

async function loadPage(page) {
  state.activePage = normalizePageForRole(page);
  renderShell();
  els.dashboardCards.innerHTML = "";
  els.mainPanel.innerHTML = `<div class="empty-state">Loading...</div>`;

  try {
    await fetchAssignmentDetails();

    const activePage = state.activePage;
    if (activePage === "dashboard") renderDashboard();
    if (activePage === "team") renderTeam();
    if (activePage === "grader") renderGrader();
    if (activePage === "admin") renderAdmin();
  } catch (error) {
    const message = reportError("Page load failed", error);
    els.mainPanel.innerHTML = `<div class="empty-state">${message}</div>`;
  }
}

function groupScores(rows) {
  const grouped = new Map();

  for (const row of rows) {
    if (!grouped.has(row.employee_id)) {
      grouped.set(row.employee_id, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        employee_email: row.employee_email,
        department_name: row.department_name,
        employee_role: row.employee_role,
        manager_id: row.manager_id,
        score: 0,
        rated: 0,
        total: 0,
        manager_name: row.grader_name
      });
    }

    const item = grouped.get(row.employee_id);
    item.score += Number(row.weighted_rating || 0);
    item.total += 1;
    if (row.rating) item.rated += 1;
  }

  const rowsByEmployee = new Map();
  for (const row of rows) {
    if (!rowsByEmployee.has(row.employee_id)) rowsByEmployee.set(row.employee_id, []);
    rowsByEmployee.get(row.employee_id).push(row);
  }

  return Array.from(grouped.values())
    .map(item => ({
      ...item,
      workflow_status: employeeWorkflowStatus(rowsByEmployee.get(item.employee_id) || [])
    }))
    .sort((a, b) => b.score - a.score);
}

function renderCards(rows) {
  const grouped = groupScores(rows);
  const avg = grouped.length ? grouped.reduce((sum, x) => sum + x.score, 0) / grouped.length : 0;
  const completed = rows.length ? rows.filter(r => r.rating).length / rows.length * 100 : 0;
  const employees = grouped.length;
  const kpis = rows.length;

  const forReview = grouped.filter(item => item.workflow_status === "submitted").length;

  els.dashboardCards.innerHTML = [
    ["Employees", employees],
    ["KPI Assignments", kpis],
    ["Average Score", moneyScore(avg)],
    ["Rating Completion", `${completed.toFixed(0)}%`],
    ["For Review", forReview]
  ].map(([label, value]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function renderDashboard() {
  const rows = isExecutive() ? state.rows : rowsForMyGrades();
  els.pageTitle.textContent = isExecutive() ? "All Departments" : "My Grades";
  renderCards(rows);
  renderScoreTable(rows, isExecutive() ? "Organization Score Dashboard" : "My KPI Score", isExecutive() ? "Visible grades across all departments." : "Your own KPI ratings for the selected period.");
}

function renderTeam() {
  const isDepartmentView = currentRole() === "department_head";
  els.pageTitle.textContent = isDepartmentView ? "Department View" : "My Team";

  const rows = rowsForTeamOnly();
  renderCards(rows);

  renderScoreTable(
    rows,
    isDepartmentView ? "Department Score Dashboard" : "Team Score Dashboard",
    isDepartmentView
      ? "Employees in your department, including your own KPI record."
      : "Employees reporting under your role scope."
  );
}

function renderScoreTable(rows, title, subtitle) {
  const scores = groupScores(rows);

  if (!scores.length) {
    els.mainPanel.innerHTML = `<div class="empty-state">No grades found for the selected period.</div>`;
    return;
  }

  els.mainPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      <div class="panel-actions">
        <button id="consolidatedReportBtn" class="soft-btn compact-action">Consolidated Report / Export PDF</button>
        <span class="badge ${currentPeriod()?.status || ""}">${currentPeriodLabel()}</span>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th>Role</th>
            <th>Rated KPIs</th>
            <th>Status</th>
            <th>Total Weighted Score</th>
            <th>Report / Action</th>
          </tr>
        </thead>
        <tbody>
          ${scores.map(item => `
            <tr>
              <td><strong>${escapeHtml(item.employee_name)}</strong><br><small>${escapeHtml(item.employee_email)}</small></td>
              <td>${escapeHtml(item.department_name || "-")}</td>
              <td>${escapeHtml(roleLabel(item.employee_role))}</td>
              <td>${item.rated} / ${item.total}</td>
              <td><span class="status-pill status-${statusClass(item.workflow_status)}">${statusLabel(item.workflow_status)}</span></td>
              <td><strong>${moneyScore(item.score)}</strong></td>
              <td>
                <div class="row-actions">
                  <button class="soft-btn row-report-btn" data-employee-id="${item.employee_id}">View Report</button>
                  ${canAcknowledgeEmployee(item.employee_id, rows) ? `<button class="primary-btn compact row-ack-btn" data-employee-id="${item.employee_id}">Acknowledge</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  els.mainPanel.querySelectorAll(".row-report-btn").forEach(btn => {
    btn.addEventListener("click", () => openEmployeeReport(btn.dataset.employeeId, rows));
  });

  els.mainPanel.querySelectorAll(".row-ack-btn").forEach(btn => {
    btn.addEventListener("click", () => acknowledgeEmployeeRatings(btn.dataset.employeeId, rows));
  });

  const consolidatedBtn = document.getElementById("consolidatedReportBtn");
  if (consolidatedBtn) {
    consolidatedBtn.addEventListener("click", () => openConsolidatedReport(rows, title));
  }
}

function getReportScopeTitle(baseTitle = "KPI Report") {
  if (isExecutive()) return `${baseTitle} - Organization`;
  if (currentRole() === "department_head") return `${baseTitle} - ${state.profile.department_name || "Department"}`;
  if (["supervisor", "team_lead"].includes(currentRole())) return `${baseTitle} - Team`;
  return `${baseTitle} - My Grades`;
}

function buildEmployeeKpiRows(rows) {
  return rows.map(row => {
    const status = normalizeRatingStatus(row);
    const notes = [
      row.review_comments ? `Review: ${row.review_comments}` : "",
      row.employee_comments ? `Employee: ${row.employee_comments}` : "",
      row.acknowledged_at ? `Acknowledged: ${formatDateTime(row.acknowledged_at)}` : ""
    ].filter(Boolean).join(" | ");

    return `
      <tr>
        <td>${escapeHtml(row.kpi_code || "-")}</td>
        <td>${escapeHtml(row.kpi_description || "-")}</td>
        <td>${escapeHtml(row.target || "-")}</td>
        <td>${weightLabel(row.weight)}</td>
        <td>${escapeHtml(ratingLabel(row))}</td>
        <td><span class="status-pill status-${statusClass(status)}">${statusLabel(status)}</span></td>
        <td>${moneyScore(row.percentage_actual)}</td>
        <td>${moneyScore(row.weighted_rating)}</td>
        <td>${escapeHtml(row.comments || "-")}</td>
        <td>${escapeHtml(notes || "-")}</td>
        <td>${escapeHtml(formatDateTime(row.graded_at))}</td>
      </tr>
    `;
  }).join("");
}

function buildEmployeeReportHtml(employeeId, sourceRows = state.rows) {
  const employeeRows = sourceRows.filter(row => row.employee_id === employeeId);
  const summary = groupScores(employeeRows)[0];

  if (!employeeRows.length || !summary) {
    return `<div class="empty-state">No KPI details found for this employee.</div>`;
  }

  return `
    <div class="report-document">
      <div class="report-title-block">
        <p class="eyebrow">Individual KPI Rating Report</p>
        <h2>${escapeHtml(summary.employee_name)}</h2>
        <p>${escapeHtml(summary.employee_email || "-")}</p>
      </div>
      <div class="report-meta-grid">
        <div><span>Period</span><strong>${escapeHtml(currentPeriodLabel())}</strong></div>
        <div><span>Department</span><strong>${escapeHtml(summary.department_name || "-")}</strong></div>
        <div><span>Role</span><strong>${escapeHtml(roleLabel(summary.employee_role))}</strong></div>
        <div><span>Rated KPIs</span><strong>${summary.rated} / ${summary.total}</strong></div>
        <div><span>Total Weighted Score</span><strong>${moneyScore(summary.score)}</strong></div>
      </div>
      <div class="table-wrap report-table-wrap">
        <table>
          <thead>
            <tr>
              <th>KPI</th>
              <th>Description</th>
              <th>Target</th>
              <th>Weight</th>
              <th>Rating</th>
              <th>Status</th>
              <th>Actual</th>
              <th>Weighted</th>
              <th>Comments</th>
              <th>Review / Acknowledgement</th>
              <th>Graded At</th>
            </tr>
          </thead>
          <tbody>${buildEmployeeKpiRows(employeeRows)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildConsolidatedReportHtml(sourceRows = state.rows, baseTitle = "KPI Dashboard") {
  const rows = sourceRows || [];
  const scores = groupScores(rows);
  const avg = scores.length ? scores.reduce((sum, item) => sum + item.score, 0) / scores.length : 0;
  const completed = rows.length ? rows.filter(row => row.rating).length / rows.length * 100 : 0;

  return `
    <div class="report-document">
      <div class="report-title-block">
        <p class="eyebrow">Consolidated KPI Record</p>
        <h2>${escapeHtml(getReportScopeTitle(baseTitle))}</h2>
        <p>Prepared by ${escapeHtml(state.profile.full_name)} • ${escapeHtml(roleLabel(currentRole()))}</p>
      </div>
      <div class="report-meta-grid">
        <div><span>Period</span><strong>${escapeHtml(currentPeriodLabel())}</strong></div>
        <div><span>Employees</span><strong>${scores.length}</strong></div>
        <div><span>KPI Assignments</span><strong>${rows.length}</strong></div>
        <div><span>Average Score</span><strong>${moneyScore(avg)}</strong></div>
        <div><span>Completion</span><strong>${completed.toFixed(0)}%</strong></div>
      </div>
      <h3>Summary by Employee</h3>
      <div class="table-wrap report-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Role</th>
              <th>Rated KPIs</th>
              <th>Status</th>
              <th>Total Weighted Score</th>
            </tr>
          </thead>
          <tbody>
            ${scores.map(item => `
              <tr>
                <td><strong>${escapeHtml(item.employee_name)}</strong><br><small>${escapeHtml(item.employee_email)}</small></td>
                <td>${escapeHtml(item.department_name || "-")}</td>
                <td>${escapeHtml(roleLabel(item.employee_role))}</td>
                <td>${item.rated} / ${item.total}</td>
                <td><span class="status-pill status-${statusClass(item.workflow_status)}">${statusLabel(item.workflow_status)}</span></td>
                <td><strong>${moneyScore(item.score)}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <h3>KPI Rating Details</h3>
      ${scores.map(item => {
        const employeeRows = rows.filter(row => row.employee_id === item.employee_id);
        return `
          <section class="employee-report-section">
            <h4>${escapeHtml(item.employee_name)} <span>${moneyScore(item.score)}</span></h4>
            <div class="table-wrap report-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>Description</th>
                    <th>Target</th>
                    <th>Weight</th>
                    <th>Rating</th>
                    <th>Status</th>
                    <th>Actual</th>
                    <th>Weighted</th>
                    <th>Comments</th>
                    <th>Review / Acknowledgement</th>
                    <th>Graded At</th>
                  </tr>
                </thead>
                <tbody>${buildEmployeeKpiRows(employeeRows)}</tbody>
              </table>
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function ensureReportModal() {
  let modal = document.getElementById("reportModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "reportModal";
  modal.className = "report-modal hidden";
  modal.innerHTML = `
    <div class="report-modal-backdrop" data-close-report="true"></div>
    <div class="report-modal-panel">
      <div class="report-modal-header">
        <div>
          <strong id="reportModalTitle">KPI Report</strong>
          <span>${escapeHtml(currentPeriodLabel())}</span>
        </div>
        <div class="report-modal-actions">
          <button id="printReportBtn" class="soft-btn compact-action">Export PDF</button>
          <button id="closeReportBtn" class="ghost-light-btn">Close</button>
        </div>
      </div>
      <div id="reportModalBody" class="report-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#closeReportBtn").addEventListener("click", closeReportModal);
  modal.querySelector("[data-close-report]").addEventListener("click", closeReportModal);
  modal.querySelector("#printReportBtn").addEventListener("click", printCurrentReport);

  return modal;
}

function openReportModal(title, html) {
  const modal = ensureReportModal();
  modal.querySelector("#reportModalTitle").textContent = title;
  modal.querySelector("#reportModalBody").innerHTML = html;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeReportModal() {
  const modal = document.getElementById("reportModal");
  if (modal) modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function openEmployeeReport(employeeId, rows = state.rows) {
  const employeeRows = rows.filter(row => row.employee_id === employeeId);
  const employeeName = employeeRows[0]?.employee_name || "Employee";
  openReportModal(`${employeeName} KPI Report`, buildEmployeeReportHtml(employeeId, rows));
}

function openConsolidatedReport(rows = state.rows, title = "KPI Dashboard") {
  openReportModal("Consolidated KPI Report", buildConsolidatedReportHtml(rows, title));
}

function printCurrentReport() {
  const body = document.getElementById("reportModalBody");
  const title = document.getElementById("reportModalTitle")?.textContent || "KPI Report";
  if (!body) return;

  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) {
    showMessage("Please allow pop-ups to print or save the report as PDF.", true);
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; margin: 24px; }
          h2, h3, h4 { margin-bottom: 8px; }
          .eyebrow { text-transform: uppercase; font-size: 11px; letter-spacing: .08em; color: #6b7280; font-weight: 700; }
          .report-title-block { border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
          .report-title-block h2 { margin: 0 0 4px; }
          .report-title-block p { margin: 0; color: #6b7280; }
          .report-meta-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 16px 0 20px; }
          .report-meta-grid div { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }
          .report-meta-grid span { display: block; color: #6b7280; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          .report-meta-grid strong { display: block; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 18px; }
          th, td { border: 1px solid #e5e7eb; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f9fafb; text-transform: uppercase; color: #4b5563; }
          .employee-report-section { break-inside: avoid; margin-top: 18px; }
          .employee-report-section h4 { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
          .status-pill { display: inline-block; border-radius: 999px; padding: 3px 7px; font-size: 10px; font-weight: 700; border: 1px solid #d1d5db; background: #f9fafb; }
          .status-submitted { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
          .status-approved { background: #ecfdf5; color: #15803d; border-color: #bbf7d0; }
          .status-returned { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
          .status-completed { background: #f0fdfa; color: #0f766e; border-color: #99f6e4; }
          @page { size: A4 landscape; margin: 10mm; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>${body.innerHTML}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 300);
}

function rowsForReviewQueue() {
  if (currentRole() === "rank_and_file") return [];

  return state.rows.filter(row => {
    const status = normalizeRatingStatus(row);
    if (status !== "submitted") return false;
    if (!row.rating_id) return false;
    if (row.grader_id === currentEmployeeId() && !isExecutive()) return false;
    return canViewEmployeeRow(row);
  });
}

function renderGrader() {
  els.pageTitle.textContent = "KPI Evaluation";

  const assignedRows = rowsForEvaluatorView();
  const reviewRows = rowsForReviewQueue();
  const allRows = [...assignedRows, ...reviewRows];
  renderCards(allRows);

  if (!assignedRows.length && !reviewRows.length) {
    els.mainPanel.innerHTML = `<div class="empty-state">No KPI assignments or submitted evaluations are available for your role in the selected period.</div>`;
    return;
  }

  els.mainPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>KPI Evaluation Workflow</h2>
        <p>Save ratings as draft, submit them for review, then approve, return, or acknowledge based on role access.</p>
      </div>
      <span class="badge ${currentPeriod()?.status || ""}">${currentPeriodLabel()}</span>
    </div>

    ${assignedRows.length ? `
      <section class="workflow-section">
        <div class="section-title-row">
          <h3>My Rating Assignments</h3>
          <p>These are KPI ratings assigned to you as evaluator.</p>
        </div>
        <div class="rating-grid">${assignedRows.map(renderRatingCard).join("")}</div>
      </section>
    ` : ""}

    ${reviewRows.length ? `
      <section class="workflow-section">
        <div class="section-title-row">
          <h3>For Review / Approval</h3>
          <p>Submitted ratings within your role scope.</p>
        </div>
        <div class="rating-grid">${reviewRows.map(renderReviewCard).join("")}</div>
      </section>
    ` : ""}
  `;

  els.mainPanel.querySelectorAll(".save-rating-btn").forEach(btn => {
    btn.addEventListener("click", () => saveRating(btn.dataset.assignmentId, false));
  });

  els.mainPanel.querySelectorAll(".submit-rating-btn").forEach(btn => {
    btn.addEventListener("click", () => saveRating(btn.dataset.assignmentId, true));
  });

  els.mainPanel.querySelectorAll(".approve-rating-btn").forEach(btn => {
    btn.addEventListener("click", () => approveRating(btn.dataset.ratingId));
  });

  els.mainPanel.querySelectorAll(".return-rating-btn").forEach(btn => {
    btn.addEventListener("click", () => returnRating(btn.dataset.ratingId));
  });
}

function renderRatingCard(row) {
  const status = normalizeRatingStatus(row);
  const editable = row.period_status === "open" && ["not_started", "draft", "returned", "in_progress"].includes(status);
  const disabled = editable ? "" : "disabled";
  const canSubmit = editable;

  return `
    <article class="rating-card" data-assignment-id="${row.assignment_id}">
      <div class="rating-card-head">
        <div>
          <h3>${escapeHtml(row.employee_name)}</h3>
          <p>${escapeHtml(row.department_name || "-")} • ${escapeHtml(roleLabel(row.employee_role))} • KPI ${escapeHtml(row.kpi_code || "-")}</p>
        </div>
        <div class="card-badge-stack">
          <span class="badge">Weight ${(Number(row.weight) * 100).toFixed(0)}%</span>
          <span class="status-pill status-${statusClass(status)}">${statusLabel(status)}</span>
        </div>
      </div>

      <p><strong>Description:</strong> ${escapeHtml(row.kpi_description || "-")}</p>
      <p><strong>Target:</strong> ${escapeHtml(row.target || "-")}</p>
      ${row.review_comments ? `<p class="review-note"><strong>Review note:</strong> ${escapeHtml(row.review_comments)}</p>` : ""}

      <div class="rubric">
        <span>${escapeHtml(row.rubric_5_exceeds || "5 - Exceeds")}</span>
        <span>${escapeHtml(row.rubric_4_strong || "4 - Strong")}</span>
        <span>${escapeHtml(row.rubric_3_meets || "3 - Meets")}</span>
        <span>${escapeHtml(row.rubric_2_below || "2 - Below")}</span>
        <span>${escapeHtml(row.rubric_1_far_below || "1 - Far Below")}</span>
      </div>

      <div class="rating-form workflow-rating-form">
        <label>
          Rating
          <select class="rating-input" ${disabled}>
            <option value="">Select</option>
            ${[5,4,3,2,1].map(v => `<option value="${v}" ${Number(row.rating) === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label>
          Comments / Justification
          <textarea class="comments-input" ${disabled}>${escapeHtml(row.comments || "")}</textarea>
        </label>
        <div class="workflow-actions">
          <button class="soft-btn compact-action save-rating-btn" data-assignment-id="${row.assignment_id}" ${disabled}>Save Draft</button>
          <button class="primary-btn compact submit-rating-btn" data-assignment-id="${row.assignment_id}" ${canSubmit ? "" : "disabled"}>Submit</button>
        </div>
      </div>
      ${!editable ? `<p class="locked-note">This rating is ${statusLabel(status).toLowerCase()} and cannot be edited unless it is returned for revision.</p>` : ""}
    </article>
  `;
}

function renderReviewCard(row) {
  const status = normalizeRatingStatus(row);
  return `
    <article class="rating-card review-card" data-rating-id="${row.rating_id}">
      <div class="rating-card-head">
        <div>
          <h3>${escapeHtml(row.employee_name)}</h3>
          <p>${escapeHtml(row.department_name || "-")} • ${escapeHtml(roleLabel(row.employee_role))} • KPI ${escapeHtml(row.kpi_code || "-")}</p>
        </div>
        <span class="status-pill status-${statusClass(status)}">${statusLabel(status)}</span>
      </div>
      <p><strong>Rating:</strong> ${escapeHtml(ratingLabel(row))} • <strong>Weighted:</strong> ${moneyScore(row.weighted_rating)}</p>
      <p><strong>Evaluator comments:</strong> ${escapeHtml(row.comments || "-")}</p>
      <p><strong>Submitted:</strong> ${escapeHtml(formatDateTime(row.submitted_at || row.graded_at))}</p>
      <div class="workflow-actions review-actions">
        <button class="primary-btn compact approve-rating-btn" data-rating-id="${row.rating_id}">Approve</button>
        <button class="warning-btn compact-action return-rating-btn" data-rating-id="${row.rating_id}">Return</button>
      </div>
    </article>
  `;
}

async function saveRating(assignmentId, submitForReview = false) {
  const card = els.mainPanel.querySelector(`[data-assignment-id="${assignmentId}"]`);
  const rating = Number(card.querySelector(".rating-input").value);
  const comments = card.querySelector(".comments-input").value.trim();

  if (!rating) {
    showMessage("Please select a rating from 1 to 5.", true);
    return;
  }

  const payload = {
    assignment_id: assignmentId,
    rating,
    comments,
    graded_by: currentEmployeeId(),
    status: submitForReview ? "submitted" : "draft"
  };

  if (submitForReview) {
    payload.submitted_at = new Date().toISOString();
    payload.returned_by = null;
    payload.returned_at = null;
    payload.approved_by = null;
    payload.approved_at = null;
  }

  const { error } = await db
    .from("kpi_ratings")
    .upsert(payload, { onConflict: "assignment_id" });

  if (error) {
    showMessage(`${getErrorMessage(error)} Run 04_workflow_reports_patch.sql if the error mentions missing workflow columns.`, true);
    return;
  }

  showMessage(submitForReview ? "Evaluation submitted for review." : "Draft rating saved successfully.");
  await loadPage(state.activePage);
}

async function approveRating(ratingId) {
  const reviewComments = prompt("Optional approval comments:") || "";
  const { error } = await db.rpc("approve_kpi_rating", {
    p_rating_id: ratingId,
    p_review_comments: reviewComments.trim()
  });

  if (error) {
    showMessage(`${getErrorMessage(error)} Run 04_workflow_reports_patch.sql if this RPC is missing.`, true);
    return;
  }

  showMessage("Evaluation approved.");
  await loadPage(state.activePage);
}

async function returnRating(ratingId) {
  const reviewComments = prompt("Reason for returning this evaluation:");
  if (reviewComments === null) return;

  const { error } = await db.rpc("return_kpi_rating", {
    p_rating_id: ratingId,
    p_review_comments: reviewComments.trim() || "Returned for revision."
  });

  if (error) {
    showMessage(`${getErrorMessage(error)} Run 04_workflow_reports_patch.sql if this RPC is missing.`, true);
    return;
  }

  showMessage("Evaluation returned for revision.");
  await loadPage(state.activePage);
}

async function acknowledgeEmployeeRatings(employeeId, rows = state.rows) {
  const acknowledgeable = getAcknowledgeableRows(employeeId, rows);
  if (!acknowledgeable.length) {
    showMessage("No approved ratings are ready for acknowledgement.", true);
    return;
  }

  const employeeComments = prompt("Optional employee acknowledgement comments:") || "";

  for (const row of acknowledgeable) {
    const { error } = await db.rpc("acknowledge_kpi_rating", {
      p_rating_id: row.rating_id,
      p_employee_comments: employeeComments.trim()
    });

    if (error) {
      showMessage(`${getErrorMessage(error)} Run 04_workflow_reports_patch.sql if this RPC is missing.`, true);
      return;
    }
  }

  showMessage("KPI rating acknowledgement saved.");
  await loadPage(state.activePage);
}

function renderAdmin() {
  els.pageTitle.textContent = "Admin";

  if (!isExecutive()) {
    els.mainPanel.innerHTML = `<div class="empty-state">Executive access only.</div>`;
    return;
  }

  renderCards(state.rows);

  els.mainPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>Executive Admin Controls</h2>
        <p>Use these controls for period governance.</p>
      </div>
      <span class="badge ${currentPeriod()?.status || ""}">${currentPeriodLabel()}</span>
    </div>
    <div class="rating-grid">
      <article class="rating-card">
        <h3>Validate KPI Weights</h3>
        <p>Before locking, every employee in the selected period must have KPI assignment weights totaling 1.0000.</p>
        <button id="validateWeightsBtn" class="soft-btn">Check weight issues</button>
      </article>
      <article class="rating-card">
        <h3>Clone Previous Quarter</h3>
        <p>This duplicates KPI assignments only. Ratings are not copied.</p>
        <div class="rating-form">
          <label>Target Year<input id="cloneYear" type="number" value="2026" /></label>
          <label>Target Quarter
            <select id="cloneQuarter">
              <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
            </select>
          </label>
          <button id="cloneNowBtn" class="primary-btn compact">Clone</button>
        </div>
        <div class="rating-form" style="margin-top:10px;">
          <label>Start Date<input id="cloneStart" type="date" /></label>
          <label>End Date<input id="cloneEnd" type="date" /></label>
        </div>
      </article>
    </div>
  `;

  document.getElementById("validateWeightsBtn").addEventListener("click", validateWeights);
  document.getElementById("cloneNowBtn").addEventListener("click", clonePeriodFromAdminPanel);
}

async function validateWeights() {
  const { data, error } = await db.rpc("period_weight_issues", { p_period_id: state.selectedPeriodId });

  if (error) {
    showMessage(getErrorMessage(error), true);
    return;
  }

  if (!data?.length) {
    showMessage("All assigned employees have KPI weights totaling 1.0000.");
    return;
  }

  els.mainPanel.insertAdjacentHTML("beforeend", `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Employee ID</th><th>Total Weight</th><th>Issue</th></tr></thead>
        <tbody>${data.map(x => `<tr><td>${x.employee_id}</td><td>${x.total_weight}</td><td>${x.issue}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `);
}

async function lockSelectedPeriod() {
  if (!confirm("Lock this grading period? This requires every employee's weights to total 1.0000.")) return;

  const { error } = await db.rpc("lock_grading_period", { p_period_id: state.selectedPeriodId });
  if (error) {
    showMessage(getErrorMessage(error), true);
    return;
  }

  showMessage("Selected period locked successfully.");
  await loadPeriods();
  renderShell();
  await loadPage(state.activePage);
}

async function clonePeriodFromPrompt() {
  const year = Number(prompt("Target year? Example: 2026"));
  const quarter = prompt("Target quarter? Q1, Q2, Q3, or Q4")?.trim().toUpperCase();
  const startDate = prompt("Target start date? YYYY-MM-DD");
  const endDate = prompt("Target end date? YYYY-MM-DD");

  if (!year || !quarter || !startDate || !endDate) return;
  await clonePeriod(year, quarter, startDate, endDate);
}

async function clonePeriodFromAdminPanel() {
  const year = Number(document.getElementById("cloneYear").value);
  const quarter = document.getElementById("cloneQuarter").value;
  const startDate = document.getElementById("cloneStart").value;
  const endDate = document.getElementById("cloneEnd").value;

  if (!year || !quarter || !startDate || !endDate) {
    showMessage("Please complete target year, quarter, start date, and end date.", true);
    return;
  }

  await clonePeriod(year, quarter, startDate, endDate);
}

async function clonePeriod(year, quarter, startDate, endDate) {
  const { error } = await db.rpc("clone_previous_quarter", {
    p_source_period_id: state.selectedPeriodId,
    p_target_year: year,
    p_target_quarter: quarter,
    p_target_start_date: startDate,
    p_target_end_date: endDate
  });

  if (error) {
    showMessage(getErrorMessage(error), true);
    return;
  }

  showMessage("Period cloned successfully.");
  state.selectedPeriodId = null;
  await loadPeriods();
  renderShell();
  await loadPage("admin");
}

function currentPeriod() {
  return state.periods.find(p => p.id === state.selectedPeriodId);
}

function currentPeriodLabel() {
  const period = currentPeriod();
  if (!period) return "No period";
  return `${period.quarter} ${period.year} • ${period.status}`;
}

els.loginBtn.addEventListener("click", login);
els.loginPassword.addEventListener("keydown", event => {
  if (event.key === "Enter") login();
});
els.logoutBtn.addEventListener("click", logout);
els.refreshBtn.addEventListener("click", () => loadPage(state.activePage));
els.periodSelect.addEventListener("change", event => {
  state.selectedPeriodId = event.target.value;
  loadPage(state.activePage);
});
els.lockPeriodBtn.addEventListener("click", lockSelectedPeriod);
els.clonePeriodBtn.addEventListener("click", clonePeriodFromPrompt);

init().catch(error => {
  reportError("App initialization failed", error, els.loginMessage);
});
