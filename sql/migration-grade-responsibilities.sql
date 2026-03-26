-- ============================================================
-- DDE Spark Portal — Grade Responsibilities Migration
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ── Responsibilities by job grade ─────────────────────────────
CREATE TABLE IF NOT EXISTS perf_grade_responsibilities (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_grade TEXT NOT NULL UNIQUE,
  responsibilities TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES employees(id) ON DELETE SET NULL
);

GRANT ALL ON perf_grade_responsibilities TO anon;
CREATE INDEX IF NOT EXISTS idx_perf_grade_resp_grade ON perf_grade_responsibilities(job_grade);

-- ── Seed responsibilities from official Job Responsibilities doc ──
-- Uses ON CONFLICT DO NOTHING so re-running is safe.
-- To overwrite an existing entry, change DO NOTHING to:
--   DO UPDATE SET responsibilities = EXCLUDED.responsibilities, updated_at = NOW()

INSERT INTO perf_grade_responsibilities (job_grade, responsibilities) VALUES

('Pre1',
'• No standard responsibilities defined yet for this grade.'),

('A1',
'• Primary focus: safety, tool handling, material movement, housekeeping, and basic tasks under direct supervision.
• Accurately clock in/out and allocate time to job codes in BusyBusy daily.
• Do not perform energized work, independent troubleshooting, or unsupervised installation activities.'),

('A2',
'• Assist with rough-in work, basic device installs under supervision, and blueprint reading fundamentals.
• May attend non-emergency service calls with a Journeyman (when assigned).'),

('A3',
'• Performs conduit bending, branch circuit installation, basic troubleshooting under supervision.
• May lead small task segments with Foreman approval.'),

('A4',
'• Functions as a senior apprentice; assists planning and quality checks for assigned scope.
• Provides peer support and mentorship to Apprentice levels A1–A2.
• Expected to demonstrate readiness to work independently.
• Expected to demonstrate readiness for licensing pathway requirements.'),

('A5',
'• Employee is currently in the testing and/or reciprocity process and is expected to perform at an advanced apprentice level pending licensure.'),

('J1',
'• Executes daily assigned tasks in accordance with company standards and applicable code requirements.
• Provides day-to-day supervision and guidance to apprentices.
• Reports material needs and field constraints to the Foreman in a timely manner.
• Works independently within the scope of license and assignment.'),

('J2',
'• Performs independent troubleshooting and field problem-solving.
• Handles customer-facing work in a professional and service-oriented manner.
• Supports material takeoffs for small jobs.'),

('J3',
'• Leads small projects with limited supervision.
• Mentors apprentices and supports their technical development.
• Performs quality assurance checks.
• Supports Foreman/PM planning.
• Supports estimating when assigned.'),

('J4',
'• Performs high complexity troubleshooting.
• Provides code compliance oversight.
• Mentors Journeyman levels J1 & J2 and supports broader field development.'),

('F1',
'• Coordinates daily field operations for crews of 2–4 electricians.
• Conducts safety huddles, confirms material readiness, and supports quality assurance inspections.
• Monitors material usage and initiates order requests with project manager weekly; initiates change order documentation.
• Verifies labor time and ensures team sign-off is completed weekly (no later than Monday at 8:00 AM), with daily review preferred.
• Monitors production progress relative to the schedule and labor expectations and escalates overtime requests to the Project Manager.'),

('F2',
'• Coordinates directly with clients and site contacts as needed to support project execution.
• Assists with manpower planning and crew development.
• Provides input on apprentice progress toward performance review and readiness for advancement.
• Mentors advanced Journeymen levels J3 & J4.'),

('F3',
'• Oversees large and more complex projects with increased operational responsibility.
• Provides detailed change order input and participates in project planning and budget discussions.
• Monitors schedule and budget performance with a working understanding of financial impact.
• Provides comprehensive reporting to Project Manager and contributes to training of Journeymen.'),

('F4',
'• Provides leadership across multiple crews or project areas.
• Coaches and develops lower-level Foremen and emerging field leaders.
• Supports strategic labor allocation input, project staffing decisions, and Foreman training.'),

('P1',
'• Assists Project Managers with administrative, operational, and project support tasks.
• Supports documentation, coordination, and project follow-up as assigned.'),

('P2',
'• Maintains ownership of assigned projects: including budget, schedule, scope, and client communication.
• Coordinates with Foremen to ensure field execution aligns with project requirements.
• Ensures accurate job costing in Sage 100 and proper labor time capture.'),

('P3',
'• Provides portfolio-level oversight, forecasting, and advanced change-order strategy.
• Leads monthly WIP review, margin improvement initiatives, and cross-department coordination.
• Mentors junior project management staff.'),

('P4',
'• Serves in a senior operational and administrative leadership capacity.
• Responsible for ultimate estimate of potential new contracts.
• Safety Administrator.'),

('Owner',
'• No standard responsibilities defined yet for this grade.')

ON CONFLICT (job_grade) DO NOTHING;
