# DDE Spark Portal

Employee recognition and compensation portal for D. DuBaldo Electric Co., LLC.

Built with **React + Vite**, **Supabase** (Postgres + Edge Functions), **Netlify** (hosting + scheduled functions), and **Resend** (transactional email).

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Local Development](#local-development)
4. [Environment Variables](#environment-variables)
5. [Database Schema](#database-schema)
6. [Feature Guide](#feature-guide)
7. [Email System](#email-system)
8. [Scheduled Functions](#scheduled-functions)
9. [UAT → PROD Process](#uat--prod-process)
10. [Change Log](#change-log)

---

## Overview

The Spark Portal lets employees recognize each other with "sparks" — a digital recognition currency that vests over time and can be cashed out. Admins manage employees, settings, and view analytics. Management and foremen conduct performance evaluations. Owners access the financial Executive Dashboard.

**Core user flows:**
- Employees log in, send sparks to teammates, view balance and history
- Sparks vest after a configurable period and can be cashed out by admins
- Foremen and above trigger and complete performance evaluations
- Admins manage all employees, settings, spark logs, compensation data
- Owners/admins view financial ops dashboard (P&L, A/R, jobs, payroll)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 |
| Routing | React Router v6 |
| Backend | Supabase (Postgres + Row Level Security) |
| Auth | Custom password-hash auth |
| Email | Resend API via Supabase Edge Functions + Netlify Functions |
| Hosting | Netlify (static + scheduled functions) |
| Charts | Chart.js + react-chartjs-2 |

---

## Local Development

```bash
npm install
cp env.example .env.local   # fill in Supabase credentials
npm run dev
npm run build
```

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anon key |
| `SUPABASE_URL` | Netlify functions | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify functions | Service role key — **keep secret** |
| `RESEND_API_KEY` | Functions | Resend transactional email key |
| `APP_URL` | Functions | Public site URL for email links |
| `VITE_ENV` | Frontend | Set to `UAT` for orange banner. Omit for PROD. |

---

## Database Schema

Core tables:

| Table | Purpose |
|---|---|
| `employees` | All users — admins and employees |
| `settings` | Key-value app settings |
| `spark_transactions` | Every spark assignment, cashout, admin edit |
| `daily_given` | Per-day send tracking for rate limiting |
| `spark_cashouts` | Cashout events |
| `transaction_likes` | Likes on spark log entries |
| `teams` / `team_members` | Team structure |
| `custom_lists` | Job grades, titles, reason categories |
| `perf_cycles` | Performance evaluation cycles |
| `perf_questions` / `perf_answers` | Eval question bank and responses |
| `perf_grade_compensation` | Wage ranges per grade |
| `perf_grade_responsibilities` | Responsibilities text per grade |
| `ops_permissions` | Executive Dashboard per-user permissions |
| `user_permissions` | Per-user screen/detail visibility (JSON) |
| `notification_log` | Email/SMS send history |

See `sql/` directory for all migration files in run order.

---

## Feature Guide

### Spark System
Employees accrue sparks each period. They send sparks to teammates as recognition. Sparks vest after the configured vesting period. Admins can cash out vested sparks. Admin spark log editing: edit sender, recipient, amount, reason, or delete — balances update immediately.

### Employee Management
- **Active/Archived filter** — archived employees keep all history but cannot log in
- **Checkboxes with tooltips:** Management, Spark List, Optional, Email, SMS, Company Vehicle, Executive Dashboard
- **Optional employees** — excluded from spark send quota but can trigger and view performance evaluations
- **Management employees** — can view spark analytics for other employees

### Performance Evaluations
Triggered by admins in the Performance tab. Assigns a foreman to evaluate employees. Due date defaults to 7 days (editable). On trigger, reviewer receives a confirmation email with a link. Reminder emails fire 2 days before due date and every 24 hours after until completed.

**Access:** Foreman (F/P grade), Owner, admin, and Optional employees.

### Compensation / My Pay
Global toggles in Settings → Compensation Settings:
- **Master on/off:** hides the My Pay tab entirely when off
- **Show Wage:** controls the My Compensation section
- **Show Range:** controls range bars in both My Compensation and grade comparison
- **Show Target Bonus:** controls bonus tiles in both sections
- **Show Bonus Share:** controls bonus share tiles and the Bonus Pool card

Each setting overridable per-employee.

### User Permissions
Admin → 🔐 Permissions tab. Per-employee control over which screens are visible and which details show within each screen. Includes copy-from, grant-all, revoke-all, and reset-to-defaults.

### Executive Dashboard (Ops)
Visible to admins and Owner-grade employees. Currently uses mock data. See `PROD_DEPLOYMENT.md` for the live data switchover steps.

---

## Email System

All emails from `DDE SPARKS Portal <sparks@dubaldo.com>` via Resend.

| Trigger | Recipient |
|---|---|
| Period end reminder | Employee (sparks remaining) |
| Performance review triggered | Foreman/reviewer |
| Performance review reminder (2 days before + daily after) | Foreman/reviewer |
| Spark summary (end of period) | Employee |
| Test notification | Selected employee |

---

## Scheduled Functions

Registered in `netlify.toml`:

**`send-spark-reminders`** — runs every hour
1. Resets `daily_sparks_remaining` at period rollover
2. Sends reminder emails at configured offsets (e.g. 48h, 24h before period end)

**`send-review-reminders`** — runs daily at 14:00 UTC (9 AM ET)
Sends overdue/upcoming reminder to reviewer for any incomplete cycles within 2 days of due date.

---

## UAT → PROD Process

See **[PROD_DEPLOYMENT.md](./PROD_DEPLOYMENT.md)** for the full step-by-step guide.

---

## Change Log

### v4 — April 2025 (current)
- **User permissions page** — per-employee screen and detail visibility (Admin → 🔐 Permissions)
- **Compensation settings** — master on/off toggle for My Pay tab; all 4 visibility settings correctly apply to both My Compensation and grade comparison sections
- **Optional employees** — can now trigger and view performance evaluations
- **Vested column width** — fixed wrapping on 2-digit values in employee table

### v3 — April 2025
- **Spark log editing** — admins can edit or delete any spark; balances update immediately
- **Employee archive** — archive instead of delete; active/archived filter on employee list
- **Performance nav** — 📋 Evals nav link added for non-admin users
- **Usage reports** — Left column and unused sparks report computed from transaction log
- **Email from address** — fixed placeholder `sparks@yourdomain.com` → `sparks@dubaldo.com`

### v2 — March 2025
- **Email from name** — `DDE Spark Portal` → `DDE SPARKS Portal`
- **Employee edit tooltips** — detailed hover tooltips on all checkboxes
- **Performance review grade bug** — F4 and other non-team-member grades now clickable
- **Review confirmation email** — sent to reviewer on trigger
- **Due date on review trigger** — defaults 7 days, editable; red if overdue
- **Netlify scheduled functions** — review reminders and spark reminders added
- **A/R email** — on/off toggle, content checkboxes, retainage column, delivery modes
- **Ops permissions** — employee-driven via `has_executive_dashboard` flag
- **Spark Left column** — computed from transaction log

### v1 — February 2025
- Initial UAT environment (branch, Netlify site, Supabase project)
- GitHub Actions weekly UAT data sync
- Performance evaluation system
- Compensation / My Pay page
- Executive Dashboard (Ops) with mock data
- Spark cashout flow
- Message board and document library
- SMS notifications via carrier gateway
- Go-live date gate (suppresses emails before go-live)
