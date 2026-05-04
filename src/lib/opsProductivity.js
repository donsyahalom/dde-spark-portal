// ─────────────────────────────────────────────────────────────────────
// Earned-value productivity calculations.
// Pure functions — no mock data dependency.  Used on both live and UAT.
// ─────────────────────────────────────────────────────────────────────

// Minimum thresholds to suppress statistically meaningless readings.
const MIN_ACTUAL_HRS = 40
const MIN_PCT_CMP    = 5

// ─────────────────────────────────────────────────────────────────────
// Date overlap weight — what fraction of a job's lifetime falls within
// the requested filter window.
//
// jobStart / jobEnd : ISO date strings ('2023-10-01') from the job record.
//                     jobEnd defaults to today when null (ongoing job).
// filterFrom / filterTo : ISO date strings from the date filter UI.
//
// Returns a number 0–1.  Returns 1.0 when no filter is active (both
// filterFrom and filterTo are null) so callers don't need to branch.
// ─────────────────────────────────────────────────────────────────────
function dateWeight(jobStart, jobEnd, filterFrom, filterTo) {
  if (!filterFrom || !filterTo) return 1.0
  if (!jobStart) return 1.0   // no start date — can't compute weight, include fully

  const jStart  = new Date(jobStart).getTime()
  const jEnd    = jobEnd ? new Date(jobEnd).getTime() : Date.now()
  const fFrom   = new Date(filterFrom).getTime()
  const fTo     = new Date(filterTo).getTime()

  const totalMs   = jEnd - jStart
  if (totalMs <= 0) return 1.0   // degenerate job (same start/end)

  const overlapStart = Math.max(jStart, fFrom)
  const overlapEnd   = Math.min(jEnd,   fTo)
  const overlapMs    = Math.max(0, overlapEnd - overlapStart)

  return Math.min(1.0, overlapMs / totalMs)
}

// ─────────────────────────────────────────────────────────────────────
// Earned-value productivity for a single job (no date weighting —
// used for per-row display in the table).
// ─────────────────────────────────────────────────────────────────────
export function jobProductivity(j) {
  if (!j || j.type === 'service' || !j.actualLaborHrs) {
    return { earnedHrs: 0, productivity: null }
  }
  const earnedHrs = (j.budgetLaborHrs || 0) * ((j.pctCmp || 0) / 100)
  if (j.actualLaborHrs < MIN_ACTUAL_HRS || (j.pctCmp || 0) < MIN_PCT_CMP) {
    return { earnedHrs, productivity: null, revenuePerHour: +(j.revenue / j.actualLaborHrs).toFixed(2) }
  }
  return {
    earnedHrs,
    productivity:   +(earnedHrs / j.actualLaborHrs).toFixed(2),
    revenuePerHour: +(j.revenue  / j.actualLaborHrs).toFixed(2),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Company-wide productivity with optional date-range weighting.
//
// When filterFrom + filterTo are provided, each job's budget hours,
// actual hours, and revenue are scaled by the fraction of its lifetime
// that falls within the filter window (day-precision overlap).
//
// Example: a job spanning 854 days with 31 days inside the filter
// contributes 31/854 = 3.6% of its hours and revenue to the pool.
// The productivity ratio per job is unchanged — the weighting only
// affects how much each job contributes to the company aggregate.
//
// Jobs with no date data (startDate = null) are included at full weight
// since we can't prove they fall outside the window.
// ─────────────────────────────────────────────────────────────────────
export function companyProductivity(jobs, filterFrom, filterTo) {
  const eligible = (jobs || []).filter((j) =>
    j.type === 'contract' &&
    j.actualLaborHrs >= MIN_ACTUAL_HRS &&
    (j.pctCmp || 0) >= MIN_PCT_CMP
  )

  let earnedHrs = 0
  let actualHrs = 0
  let revenue   = 0

  for (const j of eligible) {
    // Get job date range — prefer live Sage dates, fall back to firstInvDate
    const jStart = j.startDate   || j.firstInvDate   || null
    const jEnd   = j.completeDate || j.lastInvDate    || null

    const w = dateWeight(jStart, jEnd, filterFrom || null, filterTo || null)

    earnedHrs += (j.budgetLaborHrs || 0) * ((j.pctCmp || 0) / 100) * w
    actualHrs += j.actualLaborHrs * w
    revenue   += (j.revenue || 0) * w
  }

  return {
    earnedHrs:      Math.round(earnedHrs),
    actualHrs:      Math.round(actualHrs),
    productivity:   actualHrs ? +(earnedHrs / actualHrs).toFixed(2) : null,
    revenuePerHour: actualHrs ? +(revenue   / actualHrs).toFixed(2) : null,
    jobCount:       eligible.length,
    isWeighted:     !!(filterFrom && filterTo),
  }
}
