# DDE Spark Portal 🌟

A recognition platform for D. DuBaldo Electric — employees give sparks to recognize each other.

## Features
- 🏆 Live leaderboard (sort by name or ranking)
- ✨ Employees give up to 2 sparks/day to colleagues
- ⏳ Vesting system: sparks vest X days after assignment (not hire date)
- 🔑 Password change on first login
- 👤 Admin dashboard: add/edit/remove employees, batch import, spark adjustment, reports
- 📊 Admin reports: who gave sparks to whom, totals by date range
- 📱 Mobile-optimized design
- ⚡ Real-time updates via Supabase

---

## Deployment Instructions

### Step 1 — Set Up Supabase (Database)

1. Go to [supabase.com](https://supabase.com) and **Create a new project**
   - Name: `dde-spark-portal`
   - Database password: save this somewhere safe
   - Region: pick closest to your team

2. Once the project is created, go to **SQL Editor** (left sidebar)

3. Click **"New Query"** and paste the entire contents of `supabase-schema.sql`

4. Click **Run** — this creates all tables and the default admin account

5. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (long string under "Project API Keys")

---

### Step 2 — Push Code to GitHub

1. Create a new GitHub repository at [github.com/new](https://github.com/new)
   - Name: `dde-spark-portal`
   - Private or Public (your choice)

2. In your terminal, from this project folder:
```bash
git init
git add .
git commit -m "Initial commit - DDE Spark Portal"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dde-spark-portal.git
git push -u origin main
```

---

### Step 3 — Deploy on Netlify

1. Go to [netlify.com](https://netlify.com) and log in / create account

2. Click **"Add new site" → "Import an existing project"**

3. Connect to **GitHub** and select your `dde-spark-portal` repository

4. Build settings (should auto-detect from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`

5. Click **"Add environment variables"** (or go to Site Settings → Environment Variables after deploy):
   ```
   VITE_SUPABASE_URL     = https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY = your-anon-key-here
   ```

6. Click **"Deploy site"**

7. Your site will be live at `https://random-name.netlify.app` — you can set a custom domain in Netlify settings.

---

### Step 4 — Local Development (Optional)

```bash
# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Edit .env and add your Supabase URL and anon key

# Run development server
npm run dev
```

---

## Default Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@dde.com | admin123 |
| New Employees | (their email) | spark123 |

> Both admin and employees are prompted to change their password on first login.

---

## How Sparks Work

1. **Daily Allowance**: Every employee gets 2 sparks to give per day (resets at midnight)
2. **Giving**: Select a colleague and assign 1–2 sparks (max 2 total per day)
3. **Vesting**: Sparks are added as "unvested" and move to "vested" after the vesting period (default 30 days from the day they were assigned)
4. **Leaderboard**: Shows all sparks (vested + unvested) ranked or alphabetically

---

## Admin Capabilities

- Add employees individually or via CSV batch import
- Remove employees
- Edit any employee's vested and unvested spark totals
- Adjust vesting period (global setting)
- Run reports filtered by date range showing who gave sparks to whom

---

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend/DB**: Supabase (PostgreSQL + Realtime)
- **Hosting**: Netlify
- **Fonts**: Cinzel + Lato (Google Fonts)

---

## CSV Batch Import Format

```
FirstName, LastName, Phone, Email, InitialSparks, DailyAccrual
John, Smith, 555-1234, john.smith@dde.com, 10, 0
Jane, Doe, 555-5678, jane.doe@dde.com, 5, 1
```

All imported employees will have:
- Password: `spark123` (must change on first login)
- Initial sparks added as unvested (will vest after vesting period)
