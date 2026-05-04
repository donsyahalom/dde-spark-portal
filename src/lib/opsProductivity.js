// ─────────────────────────────────────────────────────────────────────
// Earned-value productivity calculations.
// Pure functions — no mock data dependency.  Used on both live and UAT.
// ─────────────────────────────────────────────────────────────────────

// Minimum thresholds to suppress statistically meaningless readings.
// A job with only 11.5 actual hours on a 5,400-hour budget produces an
// 8.92 ratio that looks exceptional but is just early-stage noise.
//
//   MIN_ACTUAL_HRS: at least one person-week of labor must be posted
//   MIN_PCT_CMP:    job must be at least 5% complete
const MIN_ACTUAL_HRS = 40
const MIN_PCT_CMP    = 5

// Earned-value productivity for a single job:
//   earnedHrs    = budgetLaborHrs × pctCmp / 100
//   productivity = earnedHrs / actualLaborHrs
// 1.00 = on plan · > 1.00 = ahead · < 1.00 = behind
// Returns null when the job is too early-stage to produce a reliable ratio,
// or when it is a service job (no meaningful %cmp on T&M work).
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
    productivity:    +(earnedHrs / j.actualLaborHrs).toFixed(2),
    revenuePerHour:  +(j.revenue  / j.actualLaborHrs).toFixed(2),
  }
}

// Company-wide productivity = total earned hrs / total actual hrs
// across contract jobs that meet the minimum thresholds.
export function companyProductivity(jobs) {
  const eligible = (jobs || []).filter((j) =>
    j.type === 'contract' &&
    j.actualLaborHrs >= MIN_ACTUAL_HRS &&
    (j.pctCmp || 0) >= MIN_PCT_CMP
  )
  const earnedHrs = eligible.reduce((s, j) => s + (j.budgetLaborHrs || 0) * ((j.pctCmp || 0) / 100), 0)
  const actualHrs = eligible.reduce((s, j) => s + j.actualLaborHrs, 0)
  const revenue   = eligible.reduce((s, j) => s + (j.revenue || 0), 0)
  return {
    earnedHrs:      Math.round(earnedHrs),
    actualHrs,
    productivity:   actualHrs ? +(earnedHrs / actualHrs).toFixed(2) : null,
    revenuePerHour: actualHrs ? +(revenue   / actualHrs).toFixed(2) : null,
    jobCount:       eligible.length,
  }
}
