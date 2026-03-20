# DDE Tags v3 — Upgrade Guide

## Files to replace
| File | Action |
|------|--------|
| `migration-tags.sql` | Run UPGRADE block in Supabase SQL Editor (if on v1/v2) |
| `src/components/AdminTagsPanel.jsx` | Replace |
| `src/components/TagsTab.jsx` | Replace |
| `src/pages/AdminPage.jsx` | Replace |
| `src/pages/EmployeePage.jsx` | Replace |

## What's new in v3

### Admin panel
- **User Access collapsed** — section is collapsed by default; click to expand
- **Tag reordering** — ▲▼ arrows on both categories and individual values; order controls display everywhere
- **Full path display** — folder path shown prominently in gold monospace under display name
- **auto_apply bug fixed** — insert now uses minimal columns; meta saved separately via ⚙ modal
- **Folder delete prompt** — counts file records and asks whether to delete them too

### User File Tags
- **Delete file** — removes the record; physical file untouched
- **Replace/rename** — swap the linked filename or browse for a replacement
- **My Assignments tab** — see all files assigned to you; sign-off returns the file to the assigner
- **Bulk actions** — select multiple files to bulk-tag, bulk-reassign, or bulk-delete
- **Paid status** — "Mark Paid" stamps date/time, clears assignment, marks complete
- **Add note** — sign-off users can add notes to any file
- **Activity timeline** — full audit trail in file detail: added, assigned, approved, paid with timestamps
- **Open File button** — builds a file:// URL from the folder path + filename
- **Export Tags** — downloads a .tags.txt sidecar with full tag list and audit trail (compatible with Windows)
- **Consistent tag order** — tags always display in sort_order defined by admin
- **Search date filter** — choose Date Added / Date Assigned / Date Approved / Date Paid
- **Modals** — pushed further down (marginTop: 100px)
