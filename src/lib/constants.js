// Job grades and titles
export const JOB_GRADES = ['', 'Pre1', 'A1', 'A2', 'A3', 'A4', 'J1', 'J2', 'J3', 'J4', 'F1', 'F2', 'F3', 'F4', 'P1', 'P2', 'P3', 'P4', 'Owner']

export const JOB_TITLES = ['', 'Pre-Apprentice', 'Apprentice', 'Journeyman', 'Foreman', 'Project Manager', 'Owner']

export const MANAGEMENT_GRADES = ['P1', 'P2', 'P3', 'P4', 'Owner']

export const REASON_CATEGORIES = [
  'Going Above & Beyond',
  'Teamwork & Collaboration',
  'Customer Service Excellence',
  'Safety Leadership',
  'Problem Solving',
  'Mentoring & Training',
  'Reliability & Dependability',
  'Innovation & Initiative',
  'Positive Attitude',
  'Other',
]

export const FREQUENCY_OPTIONS = [
  { value: 'daily',     label: 'Daily',      resetDesc: 'midnight CT time' },
  { value: 'weekly',    label: 'Weekly',     resetDesc: 'midnight CT time on Saturday night' },
  { value: 'biweekly',  label: 'Bi-Weekly',  resetDesc: 'midnight CT time on alternate Saturday nights' },
  { value: 'monthly',   label: 'Monthly',    resetDesc: 'midnight CT time on the last day of the month' },
]

export function getFrequencyLabel(freq) {
  return FREQUENCY_OPTIONS.find(f => f.value === freq)?.label || 'Daily'
}

export function getFrequencyResetDesc(freq) {
  return FREQUENCY_OPTIONS.find(f => f.value === freq)?.resetDesc || 'midnight CT time'
}

export function getPeriodLabel(freq) {
  switch (freq) {
    case 'weekly':   return 'weekly'
    case 'biweekly': return 'bi-weekly'
    case 'monthly':  return 'monthly'
    default:         return 'daily'
  }
}

export function isManagementGrade(grade) {
  return MANAGEMENT_GRADES.includes(grade)
}

// Format a date nicely
export function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Build a full reason string from category + text
export function buildReason(category, text) {
  if (category && text?.trim()) return `${category}: ${text.trim()}`
  if (category) return category
  if (text?.trim()) return text.trim()
  return null
}
