import { useMemo, useState, useCallback } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import {
  useOpsData,
  buildWeekly,
  jobProductivity,
  companyProductivity,
} from '../../hooks/useOpsData'
import { useOpsViewState } from '../../context/OpsViewStateContext'
import { fmt, fmtK, pct } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'

// ─────────────────────────────────────────────────────────────────────
// UAT / mock fallback dates keyed by job number.
// Live data: ops.jobs view exposes startDate / completeDate directly.
// ─────────────────────────────────────────────────────────────────────
const JOB_DATES_FALLBACK = {
  '2430':      { start: '2024-03-01', end: '2026-09-30' },
  '2512':      { start: '2024-07-15', end: '2026-12-31' },
  '2544':      { start: '2024-09-01', end: '2027-06-30' },
  '2580':      { start: '2025-01-10', end: '2026-08-31' },
  '2601':      { start: '2025-06-01', end: '2027-03-31' },
  '2622':      { start: '2026-01-15', end: '2028-06-30' },
  'SV-DDE-01': { start: '2024-01-01', end: null },
  'SV-DDE-02': { start: '2023-10-01', end: null },
  'D101':      { start: '2024-05-01', end: '2026-11-30' },
  'D118':      { start: '2024-08-01', end: '2026-07-31' },
  'D132':      { start: '2025-02-01', end: '2027-01-31' },
  'SV-DCM-01': { start: '2024-01-01', end: null },
  'S204':      { start: '2024-11-01', end: '2026-06-30' },
  'S212':      { start: '2025-03-01', end: '2026-10-31' },
  'SV-SILK-01':{ start: '2023-06-01', end: null },
}

// ─────────────────────────────────────────────────────────────────────
// Column definitions  (num + customer intentionally omitted)
// ─────────────────────────────────────────────────────────────────────
const CONTRACT_COLUMNS = [
  { key: 'name',         label: 'Name',         type: 'str'                                                         },
  { key: 'contract',     label: 'Contract',     type: 'money', align: 'right', tooltip: 'Original contract amount.' },
  { key: 'revenue',      label: 'Revenue',      type: 'money', align: 'right', tooltip: 'Billed to date.'          },
  { key: 'directCost',   label: 'Direct Cost',  type: 'money', align: 'right', tooltip: 'Hover for full breakdown.' },
  { key: 'gpDol',        label: 'GP $',         type: 'money', align: 'right', tooltip: 'Revenue − Direct Cost.'   },
  { key: 'gpPct',        label: 'GP %',         type: 'pct',   align: 'right', tooltip: 'GP ÷ Revenue.'            },
  { key: 'pctCmp',       label: '% Cmp',        type: 'pct',   align: 'right', tooltip: 'Percent complete.'        },
  { key: 'productivity', label: 'Productivity', type: 'prod',  align: 'right', tooltip: '(Budget hrs × % cmp) ÷ actual hrs. 1.00 = on plan.' },
  { key: 'status',       label: 'Status',       type: 'str'                                                         },
]

const SERVICE_COLUMNS = [
  { key: 'name',       label: 'Name',        type: 'str'                                                               },
  { key: 'revenue',    label: 'T&M Revenue', type: 'money', align: 'right', tooltip: 'Billed to date.'               },
  { key: 'directCost', label: 'Direct Cost', type: 'money', align: 'right', tooltip: 'Hover for breakdown + top WOs.' },
  { key: 'hours',      label: 'Hours',       type: 'hrs',   align: 'right', tooltip: 'Total WO hours.'               },
  { key: 'avgRate',    label: 'Avg $/hr',    type: 'money', align: 'right', tooltip: 'Billed ÷ hours.'               },
  { key: 'openWos',    label: 'Open WOs',    type: 'num',   align: 'right', tooltip: 'Work orders still open.'       },
  { key: 'status',     label: 'Status',      type: 'str'                                                               },
]

const COST_BUCKETS = [
  { key: 'labor',     label: 'Labor',     color: PALETTE.blue   },
  { key: 'material',  label: 'Material',  color: PALETTE.amber  },
  { key: 'subs',      label: 'Subs',      color: PALETTE.red    },
  { key: 'equipment', label: 'Equipment', color: PALETTE.purple },
  { key: 'bonds',     label: 'Bonds',     color: PALETTE.green  },
  { key: 'permits',   label: 'Permits',   color: '#E879F9'      },
  { key: 'other',     label: 'Other',     color: 'rgba(255,255,255,0.45)' },
]

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function fmtProductivity(p) {
  if (p == null) return '—'
  const cls = p >= 1 ? 'ops-text-pos' : p >= 0.9 ? '' : 'ops-text-neg'
  return <span className={cls}>{p.toFixed(2)}</span>
}

function prodColor(p) {
  return p == null ? 'var(--white)'
    : p >= 1.0 ? 'var(--pos)'
    : p >= 0.9 ? 'var(--gold)'
    : 'var(--neg)'
}

// pct() expects the raw number, e.g. 58 → "58%".
// Guard against NaN / null so we never crash.
function safePct(v) {
  const n = Number(v)
  if (v == null || isNaN(n)) return '—'
  return n.toFixed(0) + '%'
}

function runSum(arr) { let s = 0; return arr.map((v) => (s += v)) }

// Job date range for filter purposes.
// On live data: startDate = COALESCE(firstInvoiceDate, sagStartDate, contractDate)
//               completeDate = COALESCE(lastInvoiceDate, sagCompleteDate)
// Both are computed in the ops.jobs view from actual billing activity.
// Falls back to UAT fixture dates for mock data only.
function jobDates(job) {
  const start = job.startDate || null
  const end   = job.completeDate || null
  if (start) return { start, end }
  return JOB_DATES_FALLBACK[job._primaryNum || job.num] || null
}

// Service-wide metrics
function serviceProductivity(serviceJobs, workOrders) {
  const svcNums = new Set(serviceJobs.map((j) => j._primaryNum || j.num))
  const rev = serviceJobs.reduce((s, j) => s + (j.revenue || 0), 0)
  // Prefer live serviceHours from the view; fall back to mock WO hours
  const liveHrs = serviceJobs.reduce((s, j) => s + (j.serviceHours || 0), 0)
  const woHrs   = workOrders.filter((w) => svcNums.has(w.jobNum)).reduce((s, w) => s + w.hours, 0)
  const hrs = liveHrs > 0 ? liveHrs : woHrs
  return {
    revenue: rev,
    hours: hrs,
    revenuePerHour: hrs ? +(rev / hrs).toFixed(2) : null,
    jobCount: serviceJobs.length,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Date-filter a job array — inclusive overlap check.
// Returns { filtered, totalWithDates } so the UI can warn when no
// jobs have date data (e.g. view migration not yet re-run in Supabase).
// ─────────────────────────────────────────────────────────────────────
function applyDateFilter(jobs, dateFrom, dateTo) {
  let inRange = 0
  let outOfRange = 0
  let totalWithoutDates = 0
  const filtered = jobs.filter((j) => {
    const d = jobDates(j)
    if (!d || !d.start) {
      totalWithoutDates++
      return true   // no date data → include (can't prove it's outside range)
    }
    const jobEnd = d.end || '9999-12-31'  // no end = ongoing
    const overlaps = d.start <= dateTo && jobEnd >= dateFrom
    if (overlaps) inRange++
    else outOfRange++
    return overlaps
  })
  return { filtered, totalWithDates: inRange, outOfRange, totalWithoutDates }
}

// ─────────────────────────────────────────────────────────────────────
// Group jobs by name and merge financials
// ─────────────────────────────────────────────────────────────────────
const NUMERIC_KEYS = [
  'contract', 'revenue', 'directCost', 'gpDol',
  'retainageHeld', 'contractedRetention', 'budgetLaborHrs', 'actualLaborHrs',
  'labor', 'material', 'subs', 'equipment', 'bonds', 'permits', 'other',
  'hours', 'openWos',
]

function groupByName(jobs) {
  const nameMap = new Map()
  for (const j of jobs) {
    const key = j.name.trim().toLowerCase()
    if (!nameMap.has(key)) {
      // First occurrence: clone, store primary num for PO/WO lookup
      nameMap.set(key, { ...j, _primaryNum: j.num, _allNums: [j.jobNum || j.num], _grouped: [j] })
    } else {
      const e = nameMap.get(key)
      // Accumulate numeric fields
      for (const k of NUMERIC_KEYS) {
        if (j[k] != null) e[k] = (e[k] || 0) + Number(j[k])
      }
      // Recompute derived fields
      e.gpPct = e.revenue ? +((e.gpDol / e.revenue) * 100).toFixed(1) : 0
      // Weighted-average pctCmp uses PRE-addition revenue of the accumulator
      // Use running weighted sum approach: store a running numerator
      if (!e._pctCmpNumerator) e._pctCmpNumerator = (e._grouped[0].pctCmp || 0) * (e._grouped[0].revenue || 0)
      e._pctCmpNumerator += (j.pctCmp || 0) * (j.revenue || 0)
      e.pctCmp = e.revenue > 0 ? e._pctCmpNumerator / e.revenue : 0
      // Recompute productivity — same thresholds as jobProductivity()
      e.productivity = (e.budgetLaborHrs > 0 && e.pctCmp >= 5 && e.actualLaborHrs >= 40)
        ? +((e.budgetLaborHrs * (e.pctCmp / 100)) / e.actualLaborHrs).toFixed(2)
        : null
      e._allNums.push(j.jobNum || j.num)
      e._grouped.push(j)
    }
  }
  return [...nameMap.values()]
}

// ─────────────────────────────────────────────────────────────────────
// Sortable column header
// ─────────────────────────────────────────────────────────────────────
function ColumnHeader({ col, sortKey, sortDir, onSort }) {
  const active = sortKey === col.key
  return (
    <th
      onClick={() => onSort(col.key)}
      className={col.align === 'right' ? 'right' : ''}
      style={{
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        position: 'sticky', top: 0, zIndex: col.key === 'name' ? 4 : 3,
        background: active ? 'rgba(30,34,42,0.98)' : 'rgba(18,22,28,0.98)',
        left: col.key === 'name' ? 28 : undefined,
      }}
      title={col.tooltip || ''}
    >
      {col.label}
      {col.tooltip && (
        <span style={{ marginLeft: 3, fontSize: '0.75em', opacity: 0.45, cursor: 'help' }}>ⓘ</span>
      )}
      <span style={{ marginLeft: 3, color: active ? 'var(--gold)' : 'rgba(255,255,255,0.15)', fontSize: '0.68em' }}>
        {sortDir === 'asc' && active ? '▲' : '▼'}
      </span>
    </th>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Direct-cost hover cell — contract and service
// ─────────────────────────────────────────────────────────────────────
function DirectCostCell({ job, workOrders, isService }) {
  const [open, setOpen] = useState(false)
  const costTot = job.directCost || 0

  const top10 = useMemo(() => {
    if (isService) {
      // Match WOs against all nums in a grouped job
      const nums = new Set(job._allNums || [job._primaryNum || job.num])
      return (workOrders || [])
        .filter((w) => nums.has(w.jobNum))
        .sort((a, b) => b.billed - a.billed)
        .slice(0, 10)
    }
    return COST_BUCKETS
      .map((b) => ({ ...b, amount: job[b.key] || 0 }))
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }, [isService, workOrders, job])

  const allWosCount = isService
    ? (() => {
        const nums = new Set(job._allNums || [job._primaryNum || job.num])
        return (workOrders || []).filter((w) => nums.has(w.jobNum)).length
      })()
    : 0

  if (!costTot) return <td className="right ops-text-dim" style={{ whiteSpace: 'nowrap' }}>—</td>

  return (
    <td
      className="right"
      style={{ position: 'relative', cursor: 'help', fontWeight: 600, whiteSpace: 'nowrap' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {fmt(costTot)}
      {open && (
        <div role="tooltip" style={{
          position: 'absolute', zIndex: 80, right: 0, top: 'calc(100% + 4px)',
          minWidth: 340, maxWidth: 440,
          background: '#16191f', border: '1px solid rgba(240,192,64,0.3)',
          borderRadius: 8, padding: '10px 12px',
          boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
          textAlign: 'left', fontWeight: 400, fontSize: '0.78rem',
          color: 'var(--white)', pointerEvents: 'none',
        }}>
          <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 5, letterSpacing: '0.06em', fontSize: '0.7rem' }}>
            DIRECT COST BREAKDOWN
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <tbody>
              {COST_BUCKETS.filter((b) => (job[b.key] || 0) > 0).map((b) => (
                <tr key={b.key}>
                  <td style={{ padding: '1px 3px' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: b.color, borderRadius: 2, marginRight: 5 }} />
                    {b.label}
                  </td>
                  <td style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 600 }}>{fmt(job[b.key] || 0)}</td>
                  <td style={{ textAlign: 'right', padding: '1px 3px', color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem' }}>
                    {safePct(((job[b.key] || 0) / costTot) * 100)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid rgba(255,255,255,0.15)', fontWeight: 700 }}>
                <td style={{ padding: '3px' }}>Total</td>
                <td style={{ textAlign: 'right', padding: '3px' }}>{fmt(costTot)}</td>
                <td style={{ textAlign: 'right', padding: '3px', color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem' }}>100%</td>
              </tr>
            </tbody>
          </table>

          {isService && top10.length > 0 && (
            <>
              <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 5, letterSpacing: '0.06em', fontSize: '0.7rem' }}>
                TOP {top10.length} WORK ORDERS BY BILLED
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['WO #','Description','Billed','Hrs'].map((h) => (
                      <th key={h} style={{ textAlign: h === 'WO #' || h === 'Description' ? 'left' : 'right', padding: '1px 3px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.7rem' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {top10.map((w, i) => (
                    <tr key={w.wo} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ padding: '2px 3px', color: 'rgba(255,255,255,0.5)' }}>{w.wo}</td>
                      <td style={{ padding: '2px 3px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description || '—'}</td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>{fmt(w.billed)}</td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', color: 'rgba(255,255,255,0.5)' }}>{w.hours}</td>
                    </tr>
                  ))}
                  {allWosCount > 10 && (
                    <tr><td colSpan={4} style={{ padding: 3, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', fontSize: '0.7rem' }}>
                      + {allWosCount - 10} more — expand row for full list
                    </td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {!isService && top10.length > 0 && (
            <>
              <div style={{ color: 'var(--gold)', fontWeight: 700, marginTop: 6, marginBottom: 5, letterSpacing: '0.06em', fontSize: '0.7rem' }}>
                TOP COST ITEMS
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {top10.map((b, i) => (
                    <tr key={b.key} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ padding: '2px 3px' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, background: b.color, borderRadius: 2, marginRight: 5 }} />
                        <span style={{ fontWeight: 600 }}>#{i + 1}</span> {b.label}
                      </td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 700 }}>{fmt(b.amount)}</td>
                      <td style={{ textAlign: 'right', padding: '2px 3px', color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>
                        {safePct((b.amount / costTot) * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Admin controls shown in expanded row:
//   1. Move to Contract / Service
//   2. Mark as Closed / Reopen
// ─────────────────────────────────────────────────────────────────────
function AdminControls({ job, currentType, onReclassify, onClose, isAdmin }) {
  if (!isAdmin) return null
  const target = currentType === 'contract' ? 'service' : 'contract'
  const isOverridden = !!job._typeOverridden

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap',
      padding: '8px 12px', background: 'rgba(240,192,64,0.05)',
      border: '1px solid rgba(240,192,64,0.15)', borderRadius: 6 }}>
      <span className="ops-small" style={{ color: 'var(--gold)', fontWeight: 700, marginRight: 4 }}>Admin</span>

      {/* Type badge */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700,
        background: currentType === 'contract' ? 'rgba(111,168,255,0.15)' : 'rgba(240,192,64,0.15)',
        border: `1px solid ${currentType === 'contract' ? 'rgba(111,168,255,0.4)' : 'rgba(240,192,64,0.4)'}`,
        color: currentType === 'contract' ? PALETTE.blue : PALETTE.amber,
      }}>
        {currentType === 'contract' ? 'Contract' : 'Service'}
        {isOverridden && <span style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 400 }}>(overridden)</span>}
      </span>

      {/* Reclassify button */}
      <button
        className="ops-btn ghost"
        style={{ padding: '3px 10px', fontSize: '0.78rem' }}
        onClick={(e) => { e.stopPropagation(); onReclassify(job._primaryNum || job.num, target) }}
        title={`Move to ${target} — updates Jobs P&L and A/R reports`}
      >
        ⇄ Move to {target === 'contract' ? 'Contract' : 'Service'}
      </button>

      {/* Reset override */}
      {isOverridden && (
        <button
          className="ops-btn ghost"
          style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.65 }}
          onClick={(e) => { e.stopPropagation(); onReclassify(job._primaryNum || job.num, currentType === 'contract' ? 'service' : 'contract') }}
          title="Restore original Sage classification"
        >↺ Reset type</button>
      )}

      {/* Divider */}
      <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

      {/* Status override selector */}
      <span className="ops-small ops-text-dim">Set status:</span>
      {['Bid','Contract','Active','Complete','Closed'].map((s) => {
        const isCurrent = job.status === s
        const col = s === 'Active' ? 'var(--pos)' : s === 'Closed' ? 'rgba(255,255,255,0.4)' : s === 'Complete' ? 'rgba(255,255,255,0.55)' : 'var(--gold)'
        return (
          <button
            key={s}
            className="ops-btn ghost"
            style={{
              padding: '3px 9px', fontSize: '0.75rem', fontWeight: isCurrent ? 700 : 400,
              color: isCurrent ? col : 'rgba(255,255,255,0.4)',
              borderColor: isCurrent ? col : 'rgba(255,255,255,0.15)',
              background: isCurrent ? `${col}18` : 'transparent',
            }}
            onClick={(e) => { e.stopPropagation(); onClose(job._primaryNum || job.num, s) }}
            title={`Mark as ${s}`}
          >{s}</button>
        )
      })}
      {job._statusOverridden && (
        <button
          className="ops-btn ghost"
          style={{ padding: '3px 8px', fontSize: '0.72rem', opacity: 0.55 }}
          onClick={(e) => { e.stopPropagation(); onClose(job._primaryNum || job.num, null) }}
          title="Restore Sage status"
        >↺ Reset</button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Job grouping panel — shown in expanded row
// Lets admin link separate Sage jobs under one display name.
// Groups stored in localStorage as { [groupLabel]: [jobNum, ...] }
// ─────────────────────────────────────────────────────────────────────
function JobGroupPanel({ job, allJobs, groups, onGroupsChange }) {
  const [search, setSearch]     = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [open, setOpen]         = useState(false)

  // Find which group this job belongs to (if any)
  const myJobNum    = String(job.jobNum || job._primaryNum || job.num)
  const myGroup     = Object.entries(groups).find(([, nums]) => nums.map(String).includes(myJobNum))
  const myGroupLabel = myGroup?.[0] || null
  const myGroupNums  = myGroup?.[1] || []

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const needle = search.toLowerCase()
    return allJobs
      .filter((j) => {
        const jn = String(j.jobNum || j.num)
        if (jn === myJobNum) return false
        return j.name.toLowerCase().includes(needle) || jn.includes(needle)
      })
      .slice(0, 8)
  }, [search, allJobs, myJobNum])

  const addToGroup = (targetJobNum) => {
    const label = myGroupLabel || newLabel.trim() || job.name
    const existing = groups[label] || []
    const updated = { ...groups, [label]: [...new Set([...existing, myJobNum, String(targetJobNum)])] }
    onGroupsChange(updated)
    setSearch('')
  }

  const removeFromGroup = (numToRemove) => {
    if (!myGroupLabel) return
    const updated = { ...groups }
    const remaining = updated[myGroupLabel].filter((n) => String(n) !== String(numToRemove))
    if (remaining.length <= 1) delete updated[myGroupLabel]
    else updated[myGroupLabel] = remaining
    onGroupsChange(updated)
  }

  const dissolveGroup = () => {
    if (!myGroupLabel) return
    const updated = { ...groups }
    delete updated[myGroupLabel]
    onGroupsChange(updated)
  }

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(111,168,255,0.05)',
      border: '1px solid rgba(111,168,255,0.18)', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="ops-small" style={{ color: PALETTE.blue, fontWeight: 700 }}>
          ⊕ Job Grouping
        </span>
        <button
          className="ops-btn ghost"
          style={{ padding: '2px 8px', fontSize: '0.72rem' }}
          onClick={() => setOpen((o) => !o)}
        >{open ? '▲ collapse' : '▼ expand'}</button>
      </div>

      {myGroupLabel && (
        <div className="ops-small" style={{ marginBottom: open ? 8 : 0 }}>
          <span className="ops-text-dim">Grouped as: </span>
          <span style={{ color: PALETTE.blue, fontWeight: 600 }}>{myGroupLabel}</span>
          <span className="ops-text-dim"> — {myGroupNums.length} jobs: {myGroupNums.join(', ')}</span>
          {open && (
            <button
              className="ops-btn ghost"
              style={{ marginLeft: 10, padding: '2px 8px', fontSize: '0.72rem', color: 'var(--neg)', borderColor: 'rgba(255,90,90,0.3)' }}
              onClick={(e) => { e.stopPropagation(); dissolveGroup() }}
            >✕ dissolve group</button>
          )}
        </div>
      )}

      {open && (
        <>
          {/* Current group members */}
          {myGroupLabel && myGroupNums.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="ops-small ops-text-dim" style={{ marginBottom: 4 }}>Members:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {myGroupNums.map((n) => {
                  const memberJob = allJobs.find((j) => String(j.jobNum || j.num) === String(n))
                  const isMe = String(n) === myJobNum
                  return (
                    <span key={n} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem',
                      background: isMe ? 'rgba(111,168,255,0.2)' : 'rgba(255,255,255,0.07)',
                      border: `1px solid ${isMe ? 'rgba(111,168,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                      color: isMe ? PALETTE.blue : 'var(--white)',
                    }}>
                      {n} {memberJob ? `· ${memberJob.name}` : ''}
                      {!isMe && (
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0, fontSize: '0.7rem', lineHeight: 1 }}
                          onClick={(e) => { e.stopPropagation(); removeFromGroup(n) }}
                          title="Remove from group"
                        >✕</button>
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Group label input (only when not yet grouped) */}
          {!myGroupLabel && (
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ops-small ops-text-dim">Group label:</span>
              <input
                className="ops-input"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={job.name}
                style={{ width: 200, fontSize: '0.8rem', padding: '3px 8px' }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* Search to add jobs */}
          <div style={{ position: 'relative' }}>
            <input
              className="ops-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs to link…"
              style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px' }}
              onClick={(e) => e.stopPropagation()}
            />
            {searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: '#16191f', border: '1px solid rgba(111,168,255,0.3)',
                borderRadius: 6, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                {searchResults.map((j) => (
                  <button
                    key={j.jobNum || j.num}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 12px', background: 'none', border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer', color: 'var(--white)', fontSize: '0.82rem',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(111,168,255,0.1)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                    onClick={(e) => { e.stopPropagation(); addToGroup(j.jobNum || j.num) }}
                  >
                    <span style={{ color: PALETTE.blue, fontWeight: 600, marginRight: 8 }}>{j.jobNum || j.num}</span>
                    {j.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 6 }}>
            Groups merge financials and appear as one row. Stored locally — does not change Sage data.
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Contract job row  — all hooks BEFORE any conditional return
// ─────────────────────────────────────────────────────────────────────
function ContractJobRow({ job, purchaseOrders, workOrders, expanded, onToggle,
                          fmtCell, columns, mode, onReclassify, onClose, isAdmin, allJobs, jobGroups, onGroupsChange }) {
  // ── ALL hooks unconditionally ──────────────────────────────────────
  const costTot  = job.directCost || 0
  const weekly   = useMemo(() => buildWeekly(job.revenue || 0, costTot), [job.revenue, costTot])
  const series   = useMemo(() => {
    if (mode === 'accumulated') return { revenue: runSum(weekly.revenue), cogs: runSum(weekly.cogs), gp: runSum(weekly.gp) }
    return { revenue: weekly.revenue, cogs: weekly.cogs, gp: weekly.gp }
  }, [weekly, mode])

  const { productivity: calcProd, earnedHrs } = useMemo(() => jobProductivity(job), [job])

  const lineData = useMemo(() => ({
    labels: weekly.labels,
    datasets: [
      { label: 'Revenue',     data: series.revenue, borderColor: PALETTE.blue,  backgroundColor: 'rgba(111,168,255,0.10)', fill: true, tension: 0.3, borderWidth: 2 },
      { label: 'Direct Cost', data: series.cogs,    borderColor: PALETTE.red,   backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
      { label: 'GP',          data: series.gp,      borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2 },
    ],
  }), [series, weekly.labels])

  const bucketValues = useMemo(() => COST_BUCKETS.map((b) => job[b.key] || 0), [job])
  const bucketData   = useMemo(() => ({
    labels: COST_BUCKETS.map((b) => b.label),
    datasets: [{ label: 'Direct cost ($)', data: bucketValues, backgroundColor: COST_BUCKETS.map((b) => b.color), borderWidth: 0 }],
  }), [bucketValues])
  const bucketOpts   = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed.y)} (${safePct((ctx.parsed.y / (costTot || 1)) * 100)})` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.82)', font: { size: 10 } } },
      y: { grid: { color: 'rgba(240,192,64,0.14)' }, ticks: { color: 'rgba(255,255,255,0.82)', font: { size: 10 }, callback: (v) => fmtK(Number(v)) } },
    },
  }), [costTot])

  // Use _primaryNum to look up POs so grouped rows still find their POs
  const primaryNum = job._primaryNum || job.num
  const jobPOs     = useMemo(() => purchaseOrders.filter((p) => p.jobNum === primaryNum), [purchaseOrders, primaryNum])
  const poBilled   = useMemo(() => jobPOs.reduce((s, p) => s + p.billed, 0), [jobPOs])
  const poOut      = useMemo(() => jobPOs.reduce((s, p) => s + (p.amount - p.billed), 0), [jobPOs])

  // ── Conditional rendering starts here (no hooks below) ────────────
  if (job.isRollup) {
    return (
      <tr style={{ fontStyle: 'italic', borderTop: '1px dashed var(--border-bright)' }}>
        <td style={{ width: 28 }} />
        {columns.map((c) => (
          <td key={c.key} className={c.align === 'right' ? 'right' : ''} style={{ whiteSpace: 'nowrap' }}>
            {c.key === 'status' ? <span className="chip active">T&amp;M</span> : fmtCell(job, c)}
          </td>
        ))}
      </tr>
    )
  }

  const chipCls = job.status === 'Closed' ? 'closed' : ['Hold','Bid','Contract'].includes(job.status) ? 'hold' : job.status === 'Complete' ? 'closed' : 'active'
  const dates   = jobDates(job)

  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 28, textAlign: 'center', position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg-card)' }}>{expanded ? '▾' : '▸'}</td>
        {columns.map((c) => {
          if (c.key === 'directCost') return <DirectCostCell key="dc" job={job} workOrders={workOrders} isService={false} />
          const isName = c.key === 'name'
          return (
            <td key={c.key} className={c.align === 'right' ? 'right' : ''} style={{
              whiteSpace: isName ? 'normal' : 'nowrap',
              position: isName ? 'sticky' : undefined,
              left: isName ? 28 : undefined,
              zIndex: isName ? 2 : undefined,
              background: isName ? 'var(--bg-card)' : undefined,
              maxWidth: isName ? 260 : undefined,
            }}>
              {c.key === 'status' ? <span className={`chip ${chipCls}`}>{job.status}</span> : fmtCell(job, c)}
            </td>
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="ops-row-expand">
            {/* Summary header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--white)' }}>{job.name}</div>
                <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                  Rev {fmtK(job.revenue)} · Cost {fmtK(costTot)} · GP {fmtK(job.revenue - costTot)} ({safePct(job.gpPct)})
                  {job.firstInvDate && (
                    <> · Invoiced {job.firstInvDate} → {job.lastInvDate || 'ongoing'}</>
                  )}
                  {!job.firstInvDate && dates && <> · {dates.start} → {dates.end || 'ongoing'}</>}
                </div>
                {job._allNums?.length > 0 && (
                  <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                    Job #: {job._allNums.join(', ')}
                  </div>
                )}
                <AdminControls job={job} currentType={job.type} onReclassify={onReclassify} onClose={onClose} isAdmin={isAdmin} />
                {isAdmin && <JobGroupPanel job={job} allJobs={allJobs || []} groups={jobGroups || {}} onGroupsChange={onGroupsChange} />}
              </div>
              <div className="ops-small ops-text-dim" style={{ textAlign: 'right' }}>
                <div>Budget: {(job.budgetLaborHrs || 0).toLocaleString()} hrs · Actual: {(job.actualLaborHrs || 0).toLocaleString()} hrs</div>
                <div>Earned: {Math.round(earnedHrs).toLocaleString()} hrs · Productivity: {calcProd == null ? '—' : calcProd.toFixed(2)}</div>
              </div>
            </div>

            {/* Cost chart + bucket table */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Direct cost breakdown</div>
                <OpsChartBox size="sm"><Bar data={bucketData} options={bucketOpts} /></OpsChartBox>
              </div>
              <div>
                <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Buckets</div>
                <table className="ops-table" style={{ fontSize: '0.8rem' }}>
                  <tbody>
                    {COST_BUCKETS.map((b, i) => (
                      <tr key={b.key}>
                        <td><span style={{ display: 'inline-block', width: 10, height: 10, background: b.color, borderRadius: 2, marginRight: 6 }} />{b.label}</td>
                        <td className="right">{fmt(bucketValues[i])}</td>
                        <td className="right ops-text-dim">{costTot ? safePct((bucketValues[i] / costTot) * 100) : '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid var(--border-bright)', fontWeight: 700 }}>
                      <td>Total</td><td className="right">{fmt(costTot)}</td><td className="right ops-text-dim">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Weekly curve */}
            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>
                Weekly curve <span className="ops-text-dim" style={{ fontWeight: 400 }}>({mode})</span>
              </div>
              <OpsChartBox size="md"><Line data={lineData} options={moneyLineOpts()} /></OpsChartBox>
            </div>

            {/* POs */}
            <div style={{ marginBottom: 14 }}>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 4 }}>Purchase orders</div>
              {jobPOs.length === 0
                ? <div className="ops-small ops-text-dim">No POs on file.</div>
                : (
                  <table className="ops-table" style={{ fontSize: '0.8rem' }}>
                    <thead><tr>
                      <th>PO #</th><th>Vendor</th><th>Description</th>
                      <th className="right">Amount</th><th className="right">Billed</th>
                      <th className="right">Outstanding</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                      {jobPOs.map((p) => {
                        const out = p.amount - p.billed
                        return (
                          <tr key={p.po}>
                            <td>{p.po}</td><td>{p.vendor}</td><td className="ops-text-dim">{p.desc}</td>
                            <td className="right">{fmt(p.amount)}</td>
                            <td className="right">{fmt(p.billed)}</td>
                            <td className={`right ${out > 0 ? 'ops-text-neg' : ''}`}>{fmt(out)}</td>
                            <td><span className={`chip ${p.status === 'closed' ? 'closed' : 'active'}`}>{p.status}</span></td>
                          </tr>
                        )
                      })}
                      <tr style={{ borderTop: '1px solid var(--border-bright)', fontWeight: 700 }}>
                        <td colSpan={3}>Total</td>
                        <td className="right">{fmt(jobPOs.reduce((s, p) => s + p.amount, 0))}</td>
                        <td className="right">{fmt(poBilled)}</td>
                        <td className="right ops-text-neg">{fmt(poOut)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                )}
            </div>

            {/* Retainage */}
            <div>
              <div className="ops-small" style={{ color: 'var(--white)', fontWeight: 600, marginBottom: 6 }}>Retainage</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                {[
                  ['Retention rate', safePct(job.retainagePct)],
                  ['Contracted retention', fmt(job.contractedRetention || 0)],
                  ['Held to date', fmt(job.retainageHeld || 0)],
                  ['% complete', safePct(job.pctCmp)],
                ].map(([label, val]) => (
                  <div key={label} className="ops-stat-box">
                    <div className="ops-small ops-text-dim">{label}</div>
                    <div style={{ fontWeight: 700, color: 'var(--white)' }}>{val}</div>
                  </div>
                ))}
              </div>
              {job.releaseSchedule?.length > 0 && (
                <table className="ops-table" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  <thead><tr><th>Trigger</th><th className="right">Release %</th><th>Note</th></tr></thead>
                  <tbody>
                    {job.releaseSchedule.map((r) => {
                      const hit = (job.pctCmp || 0) >= r.atPctCmp
                      return (
                        <tr key={r.atPctCmp}>
                          <td>{r.atPctCmp}%</td>
                          <td className="right">{r.releasePct}%</td>
                          <td className={hit ? 'ops-text-pos' : 'ops-text-dim'}>{hit ? '✓ eligible · ' : '◦ pending · '}{r.note}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Service job row  — no hooks needed (no charts)
// ─────────────────────────────────────────────────────────────────────
function ServiceJobRow({ job, workOrders, expanded, onToggle, fmtCell, columns, onReclassify, onClose, isAdmin, allJobs, jobGroups, onGroupsChange }) {
  const chipCls = job.status === 'Closed' ? 'closed' : ['Hold','Bid','Contract'].includes(job.status) ? 'hold' : job.status === 'Complete' ? 'closed' : 'active'
  const dates   = jobDates(job)

  // Gather all WOs for the (possibly grouped) job
  const nums = new Set(job._allNums || [job._primaryNum || job.num])
  const allWos = useMemo(
    () => (workOrders || []).filter((w) => nums.has(w.jobNum)),
    [workOrders, job._allNums, job._primaryNum, job.num],  // eslint-disable-line
  )

  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="ops-text-dim ops-small" style={{ width: 28, textAlign: 'center', position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg-card)' }}>{expanded ? '▾' : '▸'}</td>
        {columns.map((c) => {
          if (c.key === 'directCost') return <DirectCostCell key="dc" job={job} workOrders={workOrders} isService />
          const isName = c.key === 'name'
          return (
            <td key={c.key} className={c.align === 'right' ? 'right' : ''} style={{
              whiteSpace: isName ? 'normal' : 'nowrap',
              position: isName ? 'sticky' : undefined,
              left: isName ? 28 : undefined,
              zIndex: isName ? 2 : undefined,
              background: isName ? 'var(--bg-card)' : undefined,
              maxWidth: isName ? 260 : undefined,
            }}>
              {c.key === 'status' ? <span className={`chip ${chipCls}`}>{job.status}</span> : fmtCell(job, c)}
            </td>
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="ops-row-expand">
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--white)' }}>{job.name} · work orders</div>
              {dates && <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>{dates.start} → {dates.end || 'ongoing'}</div>}
              {job._allNums?.length > 0 && (
                <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>
                  Job #: {job._allNums.join(', ')}
                </div>
              )}
              <AdminControls job={job} currentType={job.type} onReclassify={onReclassify} onClose={onClose} isAdmin={isAdmin} />
              {isAdmin && <JobGroupPanel job={job} allJobs={allJobs || []} groups={jobGroups || {}} onGroupsChange={onGroupsChange} />}
            </div>
            {allWos.length === 0
              ? <div className="ops-small ops-text-dim">No work orders on file.</div>
              : (
                <table className="ops-table" style={{ fontSize: '0.82rem' }}>
                  <thead><tr>
                    <th>WO #</th><th>Opened</th><th>Closed</th><th>Description</th>
                    <th className="right">Hrs</th><th className="right">Rate</th>
                    <th className="right">Billed</th><th>Status</th>
                  </tr></thead>
                  <tbody>
                    {allWos.map((w) => (
                      <tr key={w.wo}>
                        <td>{w.wo}</td>
                        <td className="ops-text-dim">{w.opened}</td>
                        <td className="ops-text-dim">{w.closed || '—'}</td>
                        <td>{w.description}</td>
                        <td className="right">{w.hours}</td>
                        <td className="right">${w.rate}</td>
                        <td className="right">{fmt(w.billed)}</td>
                        <td><span className={`chip ${w.status === 'invoiced' ? 'closed' : 'active'}`}>{w.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
export default function OpsJobsPage() {
  const { jobs, purchaseOrders, workOrders } = useOpsData()
  const { setJobTypeOverride, applyJobTypeOverrides } = useOpsViewState()

  // ── UI state ────────────────────────────────────────────────────────
  const [view, setView]         = useState('contract')
  const [q, setQ]               = useState('')
  const [statusFilter, setStatusFilter] = useState([])   // empty = show all
  const [sortKey, setSortKey]   = useState('revenue')
  const [sortDir, setSortDir]   = useState('desc')
  const [expanded, setExpanded] = useState(null)  // stores name-key, not num
  const [mode, setMode]         = useState('actual')

  // Date range — defaults wide open, user narrows via controls at top
  const today    = new Date()
  const thisYear = today.getFullYear()
  // Default to YTD: Jan 1 of current year → today
  const ytdFrom  = `${thisYear}-01-01`
  const ytdTo    = today.toISOString().slice(0, 10)
  const [dateFrom, setDateFrom]     = useState(ytdFrom)
  const [dateTo,   setDateTo]       = useState(ytdTo)
  const [dateFilterOn, setDateFilterOn] = useState(true)

  // Status overrides (Close / Reopen) — stored locally like type overrides
  const LS_STATUS  = 'dde.ops.jobStatusOverrides'
  const LS_GROUPS  = 'dde.ops.jobGroups'
  const [statusOverrides, setStatusOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_STATUS) || '{}') } catch { return {} }
  })
  const [jobGroups, setJobGroupsRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_GROUPS) || '{}') } catch { return {} }
  })
  const setJobGroups = (g) => {
    setJobGroupsRaw(g)
    try { localStorage.setItem(LS_GROUPS, JSON.stringify(g)) } catch {}
  }

  const handleClose = useCallback((num, newStatus) => {
    setStatusOverrides((prev) => {
      const next = { ...prev }
      if (newStatus === null) delete next[num]  // null = reset to Sage value
      else next[num] = newStatus
      try { localStorage.setItem(LS_STATUS, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // isAdmin — stub: replace with useAuth check when wired
  const isAdmin = true

  // ── Data pipeline ────────────────────────────────────────────────────
  // 1. Apply type overrides
  const effectiveJobs = useMemo(() =>
    applyJobTypeOverrides(jobs).map((j) =>
      statusOverrides[j.num] ? { ...j, status: statusOverrides[j.num], _statusOverridden: true } : j
    ),
    [jobs, applyJobTypeOverrides, statusOverrides],
  )

  // 2. Split by type
  const allContractJobs = useMemo(() => effectiveJobs.filter((j) => j.type === 'contract'), [effectiveJobs])
  const allServiceJobs  = useMemo(() => effectiveJobs.filter((j) => j.type === 'service'),  [effectiveJobs])

  // 3. Apply date filter (affects cards too when on)
  const { filtered: contractJobs, totalWithDates: contractDatesAvail, outOfRange: contractOut = 0, totalWithoutDates: contractNoDates = 0 } = useMemo(() =>
    dateFilterOn
      ? applyDateFilter(allContractJobs, dateFrom, dateTo)
      : { filtered: allContractJobs, totalWithDates: allContractJobs.filter((j) => jobDates(j)?.start).length, outOfRange: 0, totalWithoutDates: 0 },
    [allContractJobs, dateFilterOn, dateFrom, dateTo],
  )
  const { filtered: serviceJobs, totalWithDates: serviceDatesAvail, outOfRange: serviceOut = 0, totalWithoutDates: serviceNoDates = 0 } = useMemo(() =>
    dateFilterOn
      ? applyDateFilter(allServiceJobs, dateFrom, dateTo)
      : { filtered: allServiceJobs, totalWithDates: allServiceJobs.filter((j) => jobDates(j)?.start).length, outOfRange: 0, totalWithoutDates: 0 },
    [allServiceJobs, dateFilterOn, dateFrom, dateTo],
  )
  const datesAvailable = contractDatesAvail + serviceDatesAvail
  const outOfRangeCount = contractOut + serviceOut
  const noDatesCount    = contractNoDates + serviceNoDates

  // 4. Card metrics.
  //    Productivity uses ALL contract jobs (lifetime metric) — budgetLaborHrs,
  //    actualLaborHrs and pctCmp are Sage lifetime totals, not period-specific.
  //    Filtering by date would mix period-scoped job lists with lifetime hour
  //    totals, producing a meaningless ratio.
  //    Revenue, retainage and service cards use the date-filtered lists so
  //    those figures match the table.
  // Pass filter dates so companyProductivity can weight each job's contribution
  // by the fraction of its lifetime that falls within the selected window.
  const prodFilterFrom = dateFilterOn ? dateFrom : null
  const prodFilterTo   = dateFilterOn ? dateTo   : null
  const contractProd = useMemo(
    () => companyProductivity(allContractJobs, prodFilterFrom, prodFilterTo),
    [allContractJobs, prodFilterFrom, prodFilterTo],
  )
  const svcProd      = useMemo(() => serviceProductivity(allServiceJobs, workOrders), [allServiceJobs, workOrders])

  // 5. Enrich service rows with WO stats
  const serviceRows = useMemo(() =>
    serviceJobs.map((j) => {
      const wos  = workOrders.filter((w) => w.jobNum === j.num)
      const woHrs  = wos.reduce((s, w) => s + w.hours, 0)
      const bill = wos.reduce((s, w) => s + w.billed, 0)
      // Prefer serviceHours from the view (actual_hours on srvinv) over mock WO data
      const hrs = j.serviceHours > 0 ? j.serviceHours : woHrs
      const rev = j.revenue || 0
      return {
        ...j,
        hours:   hrs,
        avgRate: hrs ? +(rev / hrs).toFixed(0) : 0,
        openWos: wos.filter((w) => w.status === 'open').length,
        workOrders: wos,
      }
    }),
    [serviceJobs, workOrders],
  )

  // 6. Table rows pipeline: source → text/status filter → group → sort
  const rows = useMemo(() => {
    // Apply job groups: override the name of grouped jobs so groupByName
    // naturally merges them under the group label.
    const groupByJobNum = {}
    for (const [label, nums] of Object.entries(jobGroups)) {
      for (const n of nums) groupByJobNum[String(n)] = label
    }
    const applyGroups = (jobs) => jobs.map((j) => {
      const jn = String(j.jobNum || j.num)
      return groupByJobNum[jn] ? { ...j, name: groupByJobNum[jn], _manualGroup: groupByJobNum[jn] } : j
    })

    const source = view === 'contract'
      ? applyGroups(contractJobs.map((j) => ({ ...j, productivity: jobProductivity(j).productivity })))
      : applyGroups(serviceRows)

    // Text search
    let filtered = q.trim()
      ? source.filter((j) => j.name.toLowerCase().includes(q.toLowerCase()) || (j.customer || '').toLowerCase().includes(q.toLowerCase()))
      : source.slice()

    // Status filter
    if (statusFilter.length > 0) filtered = filtered.filter((j) => statusFilter.includes(j.status))

    // Group by name
    const grouped = groupByName(filtered)

    // Sort
    grouped.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })

    return grouped
  }, [view, contractJobs, serviceRows, q, statusFilter, sortKey, sortDir])

  const columns   = view === 'contract' ? CONTRACT_COLUMNS : SERVICE_COLUMNS

  const toggleSort = (k) => {
    setExpanded(null)
    setSortKey(k)
    setSortDir((d) => sortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')
  }

  // Row key and expanded key — use lowercase name so grouping is stable
  const rowKey  = (j) => j.name.trim().toLowerCase()
  const toggleExpand = (j) => {
    const k = rowKey(j)
    setExpanded((prev) => prev === k ? null : k)
  }

  const fmtCell = (j, col) => {
    const v = j[col.key]
    if (col.type === 'money') return v == null ? '—' : fmt(v)
    if (col.type === 'pct')   return safePct(v)   // safePct handles null/0/number
    if (col.type === 'hrs')   return v == null ? '—' : Number(v).toFixed(0)
    if (col.type === 'num')   return v == null ? '—' : String(v)
    if (col.type === 'prod')  return fmtProductivity(v)
    if (col.key === 'status') return v || '—'
    return v == null ? '—' : String(v)
  }

  // ── Date filter bar ──────────────────────────────────────────────────
  const DateFilterBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(240,192,64,0.06)',
      border: '1px solid rgba(240,192,64,0.18)', borderRadius: 8, marginBottom: 16 }}>
      <span className="ops-small" style={{ color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {dateFrom === ytdFrom && dateTo === ytdTo ? 'YTD Filter' : 'Date Range Filter'}
      </span>
      <span className="ops-small ops-text-dim" style={{ whiteSpace: 'nowrap' }}>
        based on invoice dates
      </span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--white)', cursor: 'pointer' }}>
        <input type="checkbox" checked={dateFilterOn} onChange={(e) => setDateFilterOn(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
        {dateFilterOn ? 'Active — cards + table filtered' : 'Off — showing all dates'}
      </label>
      {dateFilterOn && (
        <>
          <input type="date" className="ops-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: 148 }} title="Jobs starting on or after" />
          <span className="ops-small ops-text-dim">to</span>
          <input type="date" className="ops-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: 148 }} title="Jobs ending on or before" />
          <button className="ops-btn ghost" style={{ fontSize: '0.78rem', padding: '3px 10px' }}
            onClick={() => { setDateFrom(ytdFrom); setDateTo(ytdTo) }}
            title="Reset to Year-to-Date">
            ↺ YTD
          </button>
          <span className="ops-small ops-text-dim">
            <span style={{ color: 'var(--pos)' }}>{contractJobs.length} contract · {serviceJobs.length} service</span>
            {' in range'}
            {outOfRangeCount > 0 && (
              <span style={{ marginLeft: 8 }}>
                · {outOfRangeCount} outside range
              </span>
            )}
            {noDatesCount > 0 && (
              <span style={{ color: 'var(--gold)', marginLeft: 8 }}>
                · {noDatesCount} no date data
              </span>
            )}
            {datesAvailable === 0 && (
              <span style={{ color: 'var(--neg)', marginLeft: 8 }}>
                ⚠ No date data — re-run ops_views.sql in Supabase
              </span>
            )}
          </span>
        </>
      )}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* Date filter — top of page, affects everything */}
      {DateFilterBar}

      {/* Cards row 1 — Contract */}
      <div className="ops-grid-3" style={{ marginBottom: 12 }}>
        <OpsSectionCard title="Contract productivity" subtitle={contractProd.isWeighted ? `Day-weighted earned-value · ${dateFrom} → ${dateTo}` : "Lifetime earned-value — all contract jobs"}>
          <div className="ops-kpi-value" style={{ color: prodColor(contractProd.productivity) }}>
            {contractProd.productivity == null ? '—' : contractProd.productivity.toFixed(2)}
          </div>
          {contractProd.actualHrs > 0 ? (
            <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
              {(contractProd.earnedHrs || 0).toLocaleString()} earned ÷ {(contractProd.actualHrs || 0).toLocaleString()} actual hrs
              <div style={{ marginTop: 2 }}>1.00 = on plan · {contractProd.jobCount} job{contractProd.jobCount !== 1 ? 's' : ''}{contractProd.isWeighted ? ' · day-weighted' : ' · all time'}</div>
            </div>
          ) : (
            <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
              No labor hours synced · {contractJobs.length} job{contractJobs.length !== 1 ? 's' : ''}
              <div style={{ marginTop: 2 }}>Revenue: {fmtK(contractJobs.reduce((s, j) => s + j.revenue, 0))}</div>
            </div>
          )}
        </OpsSectionCard>

        <OpsSectionCard title="Contract rev / field hour" subtitle={contractProd.isWeighted ? `Day-weighted · ${dateFrom} → ${dateTo}` : "Lifetime metric — all contract jobs"}>
          <div className="ops-kpi-value">
            {contractProd.revenuePerHour == null ? '—' : `$${contractProd.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {contractProd.revenuePerHour != null
              ? `Revenue booked ÷ actual hrs worked · ${contractProd.jobCount} jobs`
              : `Total revenue: ${fmtK(contractJobs.reduce((s, j) => s + j.revenue, 0))} · awaiting hour data`}
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Retainage held" subtitle="Contract jobs only · expand row for detail">
          <div className="ops-kpi-value">{fmtK(contractJobs.reduce((s, j) => s + (j.retainageHeld || 0), 0))}</div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            Contracted: {fmtK(contractJobs.reduce((s, j) => s + (j.contractedRetention || 0), 0))}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 2 }}>Releases at 95% / 100% complete.</div>
        </OpsSectionCard>
      </div>

      {/* Cards row 2 — Service */}
      <div className="ops-grid-3" style={{ marginBottom: 20 }}>
        <OpsSectionCard title="Service revenue" subtitle="Total T&M billing across service jobs">
          <div className="ops-kpi-value">{fmtK(svcProd.revenue)}</div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {svcProd.hours.toLocaleString()} hrs · {svcProd.jobCount} job{svcProd.jobCount !== 1 ? 's' : ''}
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="Service rev / field hour" subtitle="T&M revenue ÷ work-order hours">
          <div className="ops-kpi-value">
            {svcProd.revenuePerHour == null ? '—' : `$${svcProd.revenuePerHour.toFixed(0)}`}
          </div>
          <div className="ops-small ops-text-dim" style={{ marginTop: 4 }}>
            {svcProd.revenuePerHour != null
              ? `Avg billing rate · ${svcProd.hours.toLocaleString()} hrs logged`
              : `Revenue: ${fmtK(svcProd.revenue)} · WO hours not yet synced`}
          </div>
        </OpsSectionCard>

        <OpsSectionCard title="How we measure" subtitle="Earned value · contract / rev per hr · service">
          <div className="ops-small" style={{ lineHeight: 1.6 }}>
            <div style={{ color: 'var(--white)', fontWeight: 600 }}>productivity = (budget hrs × % cmp) ÷ actual hrs</div>
            <div className="ops-text-dim" style={{ marginTop: 4 }}>1.00 = on plan · {'>'}1.00 ahead · {'<'}1.00 behind</div>
            <div className="ops-text-dim" style={{ marginTop: 4 }}>Service jobs show revenue per field hour instead.</div>
          </div>
        </OpsSectionCard>
      </div>

      {/* Jobs table */}
      <OpsSectionCard
        title={view === 'contract' ? 'Jobs P&L — Contract' : 'Jobs P&L — Service (T&M)'}
        subtitle="Click a row to expand. Hover Direct Cost for breakdown. Click column headers to sort."
        right={
          <div className="ops-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="ops-toggle">
              <button onClick={() => { setView('contract'); setExpanded(null); setSortKey('revenue'); setSortDir('desc') }} className={view === 'contract' ? 'active' : ''}>Contract</button>
              <button onClick={() => { setView('service');  setExpanded(null); setSortKey('revenue'); setSortDir('desc') }} className={view === 'service'  ? 'active' : ''}>Service</button>
            </div>
            {view === 'contract' && (
              <div className="ops-toggle">
                <button onClick={() => setMode('actual')}      className={mode === 'actual'      ? 'active' : ''}>Actual</button>
                <button onClick={() => setMode('accumulated')} className={mode === 'accumulated' ? 'active' : ''}>Accumulated</button>
              </div>
            )}
            <input className="ops-input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or customer" style={{ width: 200 }} />
            {/* Multi-select status pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {['Active','Complete','Contract','Bid','Closed'].map((s) => {
                const active = statusFilter.includes(s)
                const chipColor = s === 'Active' ? 'var(--pos)' : s === 'Closed' ? 'rgba(255,255,255,0.4)' : s === 'Complete' ? 'rgba(255,255,255,0.55)' : 'var(--gold)'
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter((prev) =>
                      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                    )}
                    style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600,
                      cursor: 'pointer', border: `1px solid ${active ? chipColor : 'rgba(255,255,255,0.2)'}`,
                      background: active ? `${chipColor}22` : 'transparent',
                      color: active ? chipColor : 'rgba(255,255,255,0.4)',
                      transition: 'all 0.15s',
                    }}
                  >{s}</button>
                )
              })}
              {statusFilter.length > 0 && (
                <button
                  onClick={() => setStatusFilter([])}
                  style={{ padding: '3px 8px', borderRadius: 20, fontSize: '0.72rem', cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
                    color: 'rgba(255,255,255,0.35)' }}
                >✕ clear</button>
              )}
            </div>
          </div>
        }
      >
        {/* Dual scrollbar — top mirror + bottom. Both divs are kept in sync
             via the scrollRef so the user can scroll from either bar. */}
        {(() => {
          // We render the scroll wrapper via an IIFE so we can use a ref
          // declared inline. The actual ref is on the outer component via
          // useCallback but we keep it simple with a data-attribute approach.
          return null
        })()}
        <div
          id="jobs-top-scroll"
          style={{ overflowX: 'auto', marginLeft: -20, marginRight: -20,
            paddingLeft: 20, paddingRight: 20, height: 16, marginBottom: 2 }}
          onScroll={(e) => {
            const main = document.getElementById('jobs-main-scroll')
            if (main) main.scrollLeft = e.target.scrollLeft
          }}
        >
          <div id="jobs-top-scroll-inner" style={{ height: 1 }} />
        </div>
        <div
          id="jobs-main-scroll"
          className="ops-table-scroll-wrap"
          style={{ marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}
          onScroll={(e) => {
            const top = document.getElementById('jobs-top-scroll')
            if (top) top.scrollLeft = e.target.scrollLeft
            // Keep top scroll inner width in sync with table width
            const inner = document.getElementById('jobs-top-scroll-inner')
            if (inner) inner.style.width = e.target.scrollWidth + 'px'
          }}
        >
          <table className="ops-table" ref={(el) => {
            // Sync top scroll inner width on mount
            if (el) {
              const inner = document.getElementById('jobs-top-scroll-inner')
              if (inner) inner.style.width = el.scrollWidth + 'px'
            }
          }}>
            <thead>
              <tr>
                <th style={{ width: 28, position: 'sticky', top: 0, left: 0, zIndex: 4, background: 'rgba(18,22,28,0.98)' }} />
                {columns.map((c) => (
                  <ColumnHeader key={c.key} col={c} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const k = rowKey(j)
                return view === 'contract' ? (
                  <ContractJobRow
                    key={k}
                    job={j}
                    purchaseOrders={purchaseOrders}
                    workOrders={workOrders}
                    expanded={expanded === k}
                    onToggle={() => toggleExpand(j)}
                    fmtCell={fmtCell}
                    columns={columns}
                    mode={mode}
                    onReclassify={setJobTypeOverride}
                    onClose={handleClose}
                    isAdmin={isAdmin}
                    allJobs={effectiveJobs}
                    jobGroups={jobGroups}
                    onGroupsChange={setJobGroups}
                  />
                ) : (
                  <ServiceJobRow
                    key={k}
                    job={j}
                    workOrders={workOrders}
                    expanded={expanded === k}
                    onToggle={() => toggleExpand(j)}
                    fmtCell={fmtCell}
                    columns={columns}
                    onReclassify={setJobTypeOverride}
                    onClose={handleClose}
                    isAdmin={isAdmin}
                    allJobs={effectiveJobs}
                    jobGroups={jobGroups}
                    onGroupsChange={setJobGroups}
                  />
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={columns.length + 1} className="center ops-text-dim" style={{ padding: '28px 0' }}>
                    No jobs match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </OpsSectionCard>
    </div>
  )
}
