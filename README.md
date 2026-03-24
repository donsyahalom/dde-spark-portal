# DDE Spark Portal — Performance Rating Update

## Files in this package

```
dde-performance-update/
├── sql/
│   └── performance-schema.sql          ← Run this in Supabase first
├── src/
│   ├── App.jsx                         ← Replace src/App.jsx
│   ├── components/
│   │   ├── Layout.jsx                  ← Replace src/components/Layout.jsx
│   │   └── PerformanceAdminPanel.jsx   ← NEW — add to src/components/
│   └── pages/
│       ├── AdminPage.jsx               ← Replace src/pages/AdminPage.jsx
│       └── PerformanceRatingPage.jsx   ← NEW — add to src/pages/
└── README.md
```

---

## Installation Steps

### Step 1 — Run the SQL
Open your Supabase project → SQL Editor → paste and run `sql/performance-schema.sql`.

This creates:
- `perf_categories` — evaluation categories (Safety, Quality, etc.)
- `perf_questions` — individual rating questions (1–5 scale)
- `perf_cycles` — one record per employee-per-foreman evaluation window
- `perf_answers` — the foreman's answers to each question
- `perf_employee_profiles` — job responsibilities uploaded by admin

It also seeds all default categories and questions automatically.

### Step 2 — Copy the new component files
```
src/components/PerformanceAdminPanel.jsx   ← new file
src/pages/PerformanceRatingPage.jsx        ← new file
```

### Step 3 — Replace the updated files
```
src/App.jsx                   ← adds /performance route + ForemanRoute guard
src/components/Layout.jsx     ← adds "📋 Evals" nav link for foreman+
src/pages/AdminPage.jsx       ← adds 📋 Performance tab to admin panel
```

---

## What was changed

### App.jsx
- Added `import PerformanceRatingPage`
- Added `ForemanRoute` guard component (allows F-grades, P-grades, Owner, admin)
- Added `/performance` route wrapped in `<ForemanRoute>`

### Layout.jsx
- Added grade-based check: `isForeman = /^[FP]/.test(grade) || grade === 'Owner'`
- Added "📋 Evals" nav link visible only to foreman and above

### AdminPage.jsx
- Added `import PerformanceAdminPanel`
- Added `['performance','📋 Performance']` to tabs array
- Added `{tab==='performance' && <PerformanceAdminPanel ... />}` panel

---

## How It Works

### Admin workflow
1. Go to **Admin → 📋 Performance**
2. **Questions tab** — add/edit/disable categories and questions
3. **Profiles tab** — upload job responsibilities for each employee
4. **Trigger Eval tab** — select employee or team, assign a foreman, set date range → trigger
5. **Results tab** — view weighted scores, category breakdowns, peer comparisons
6. **Report tab** — generate printable PDF report with peer group rankings

### Foreman workflow
1. Nav shows "📋 Evals" after admin triggers evaluations
2. Select a pending employee from the top section
3. Rate each question 1–5 stars — answers auto-save on every click
4. Submit when all questions are answered
5. Can navigate between employees or go back and change answers before submitting

### Scoring & Weighting
- Each evaluation cycle covers a date range (e.g. 2 months with Foreman A)
- Work days (Mon–Fri) in the range determine the weighting factor
- Admin can override work day counts per cycle if needed
- Final employee score = work-day-weighted average across all submitted cycles

### Peer Comparison (Sparks Report)
Employees are grouped by grade family:
- Pre-Apprentice: Pre1
- Apprentice: A1, A2, A3, A4
- Journeyman: J1, J2, J3, J4
- Foreman: F1, F2, F3, F4
- Management: P1, P2, P3, P4, Owner

An A2 is only ranked against other apprentices, never against foremen.

---

## Foreman Access Rules

Job grades that get the "📋 Evals" nav link and access to /performance:
- F1, F2, F3, F4 (Foreman grades)
- P1, P2, P3, P4 (PM / management grades)
- Owner
- Any `is_admin = true` user

All other grades are redirected to /leaderboard.
