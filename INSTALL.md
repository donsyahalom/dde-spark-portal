# DDE Tags v2 — Integration Guide

## Files in this package

| File | Action |
|------|--------|
| `migration-tags.sql` | Run in Supabase SQL Editor |
| `src/pages/AdminPage.jsx` | Replace existing |
| `src/pages/EmployeePage.jsx` | Replace existing |
| `src/components/TagsTab.jsx` | New file |
| `src/components/AdminTagsPanel.jsx` | New file |

## If upgrading from v1
Only add the new columns — see the "upgrading from v1" block at the bottom of `migration-tags.sql`.

## What's new in v2

### Admin (🏷️ Tags tab)
- **Real-time updates** — all sections refresh instantly via Supabase subscriptions; no page reload needed
- **Optimistic UI** — changes appear immediately while saving in background
- **Tag value ⚙ editor** — click ⚙ on any tag value to set:
  - Official Name (e.g. "Trinity Construction LLC") — matched by OCR
  - Physical/job-site Address — matched by OCR
  - Company/Vendor Name — matched by OCR
  - Role restriction: Anyone | Sign-off only | Viewer only
  - Auto-apply: checked = added to every new file automatically
- **📂 Browse button** on folder path input — uses OS folder picker (File System Access API)

### User (📎 File Tags tab)
- **Browse Folders tab** — see all registered folders, expand to see files inside, add directly
- **New Files / Add File modal** — redesigned 3-step flow:
  1. Pick files (multi-select supported)
  2. Run OCR — scans text and filename against tag metadata, highlights suggestions
  3. Apply tags — role-filtered (sign-off tags hidden from viewers), auto-apply pre-checked
- **Date filter** on Search tab — filter by date added from/to
- **Modal position fixed** — modals now appear below the sticky header (marginTop: 80px)
