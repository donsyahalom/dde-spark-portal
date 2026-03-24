# DDE Performance Rating System — Install Guide

## Files in this package

```
src/
  App.jsx                          ← Replace src/App.jsx
  pages/
    AdminPage.jsx                  ← Replace src/pages/AdminPage.jsx
    PerformanceRatingPage.jsx      ← NEW — add to src/pages/
  components/
    Layout.jsx                     ← Replace src/components/Layout.jsx
    PerformanceAdminPanel.jsx      ← NEW — add to src/components/

performance-schema.sql             ← Run once in Supabase SQL Editor
```

## Step 1 — Run the SQL

Open your Supabase project → SQL Editor → paste and run `performance-schema.sql`.

This creates:
- `perf_categories` — evaluation categories (safety, quality, etc.)
- `perf_questions`  — individual scored questions per category
- `perf_cycles`     — one evaluation period per employee per foreman
- `perf_answers`    — individual question scores (auto-saved)
- `perf_employee_profiles` — job responsibilities text per employee

Default questions are seeded automatically on first run.

## Step 2 — Drop in the new files

Copy all files from this package into your project, replacing the originals
where applicable (App.jsx, AdminPage.jsx, Layout.jsx) and adding the new ones
(PerformanceRatingPage.jsx, PerformanceAdminPanel.jsx).

## Step 3 — Deploy

No other changes needed. Run `npm run dev` to test locally, then deploy as usual.

---

## How it works

### Admin (via Admin → 📋 Performance tab)
- **Questions** — Add/edit/disable categories and questions
- **Trigger Eval** — Send eval requests by individual employee or entire team, 
  assign a foreman, set the date range (work days auto-calculated Mon–Fri)
- **Results** — View all submitted scores; drill into per-employee breakdown by 
  category, cycle detail with work-day-weighted scoring, and peer comparison
- **Profiles** — Upload job responsibilities text per employee
- **Report** — Generate a printable/PDF report with summaries + peer rankings

### Foreman (via 📋 Evals nav link)
- See pending evaluations as clickable buttons
- Select an employee → view their grade, responsibilities, and all questions by category
- Rate 1–5 stars per question (answers auto-save on click)
- Submit when all questions answered; move to next employee

### Weighting
Each evaluation cycle has a date range. Work days (Mon–Fri) in that range are 
counted automatically. If an employee worked under 3 different foremen, each 
foreman's score is weighted by their portion of total work days. Admin can 
override the work-day count for any cycle.

### Peer comparison (Sparks Report)
Employees are compared only within their grade group:
- Pre-Apprentice: Pre1
- Apprentice: A1–A4
- Journeyman: J1–J4
- Foreman: F1–F4
- Management: P1–P4, Owner
