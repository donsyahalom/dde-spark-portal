# DDE Tags — Integration Guide

## Files in this package

| File | Action |
|------|--------|
| `migration-tags.sql` | **Run first** in Supabase SQL Editor |
| `src/pages/AdminPage.jsx` | **Replace** your existing file |
| `src/pages/EmployeePage.jsx` | **Replace** your existing file |
| `src/components/TagsTab.jsx` | **New file** — copy to your components folder |
| `src/components/AdminTagsPanel.jsx` | **New file** — copy to your components folder |

## Step-by-step install

### 1. Run the SQL migration
Open your **Supabase dashboard → SQL Editor** and run the contents of `migration-tags.sql`.
This creates 4 new tables (`dde_tag_categories`, `dde_tag_values`, `dde_tag_folders`, `dde_tag_files`)
and adds two columns to your `employees` table (`tags_access`, `tags_role`).

### 2. Drop in the files
Replace `src/pages/AdminPage.jsx` and `src/pages/EmployeePage.jsx` with the versions in this package.
Copy `TagsTab.jsx` and `AdminTagsPanel.jsx` into your `src/components/` folder.

### 3. Done — no other config needed

---

## How it works

### Admin (⚙️ Admin → 🏷️ Tags tab)
- **User Access** — toggle Tags on/off per employee; set role to **Viewer** or **Sign-off**
- **Tag Categories** — create colour-coded categories (Department, Status, Priority, etc.) with any values
- **Folder Paths** — register shared folder locations (local or UNC paths)

### Employees (✨ My Sparks → 🏷️ DDE Tags tab)
Only visible to employees whose `tags_access = true`.

- **Files tab** — browse all files, filter by folder or name, click to open detail
- **Search tab** — filter by any combination of tag values across categories
- **Pending tab** — Sign-off users see files assigned to them awaiting approval (with banner alert)

### Sign-off workflow
1. Any tags user adds a file and assigns it to one or more Sign-off users
2. Sign-off users see a banner + Pending tab
3. They open the file and click **✅ Sign Off on This File**, optionally adding a note
4. A timestamped approval record appears on the file — visible to everyone including the original uploader

