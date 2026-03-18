export const JOB_GRADES = ['','Pre1','A1','A2','A3','A4','J1','J2','J3','J4','F1','F2','F3','F4','P1','P2','P3','P4','Owner']
export const JOB_TITLES = ['','Pre-Apprentice','Apprentice','Journeyman','Foreman','Project Manager','Owner']
export const MANAGEMENT_GRADES = ['P1','P2','P3','P4','Owner']

export const REASON_CATEGORIES = [
  'Going Above & Beyond','Teamwork & Collaboration','Customer Service Excellence',
  'Safety Leadership','Problem Solving','Mentoring & Training',
  'Reliability & Dependability','Innovation & Initiative','Positive Attitude','Other',
]

export const FREQUENCY_OPTIONS = [
  { value:'daily',    label:'Daily',     resetDesc:'midnight CT time on work days (Mon–Fri only)' },
  { value:'weekly',   label:'Weekly',    resetDesc:'midnight CT time on Saturday night' },
  { value:'biweekly', label:'Bi-Weekly', resetDesc:'midnight CT time on alternate Saturday nights' },
  { value:'monthly',  label:'Monthly',   resetDesc:'midnight CT time on the last day of the month' },
]

// SMS carrier email-to-text gateways
export const CARRIERS = [
  { value:'',                    label:'— Select Carrier —' },
  { value:'@txt.att.net',        label:'AT&T' },
  { value:'@tmomail.net',        label:'T-Mobile' },
  { value:'@vtext.com',          label:'Verizon' },
  { value:'@messaging.sprintpcs.com', label:'Sprint' },
  { value:'@sms.myboostmobile.com',   label:'Boost Mobile' },
  { value:'@text.republicwireless.com', label:'Republic Wireless' },
  { value:'@vmobl.com',          label:'Virgin Mobile' },
  { value:'@sms.cricketwireless.com',  label:'Cricket' },
  { value:'@mymetropcs.com',     label:'Metro PCS' },
  { value:'@mmst5.tracfone.com', label:'TracFone' },
  { value:'@email.uscc.net',     label:'US Cellular' },
]

export const LEADERBOARD_RANGE_OPTIONS = [
  { value:'all_time',      label:'All Time' },
  { value:'rolling_week',  label:'Rolling 7 Days' },
  { value:'rolling_month', label:'Rolling 30 Days' },
  { value:'rolling_quarter',label:'Rolling 90 Days' },
  { value:'rolling_half',  label:'Rolling 6 Months' },
  { value:'rolling_year',  label:'Rolling 1 Year' },
  { value:'custom',        label:'Custom Date Range' },
]

export function getFrequencyLabel(freq) {
  return FREQUENCY_OPTIONS.find(f=>f.value===freq)?.label || 'Daily'
}
export function getFrequencyResetDesc(freq) {
  return FREQUENCY_OPTIONS.find(f=>f.value===freq)?.resetDesc || 'midnight CT time'
}
export function getPeriodLabel(freq) {
  switch(freq) {
    case 'weekly':   return 'weekly'
    case 'biweekly': return 'bi-weekly'
    case 'monthly':  return 'monthly'
    default:         return 'daily'
  }
}
export function isManagementGrade(grade) { return MANAGEMENT_GRADES.includes(grade) }
export function fmtDate(d) { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }
export function buildReason(category, text) {
  if (category && text?.trim()) return `${category}: ${text.trim()}`
  if (category) return category
  if (text?.trim()) return text.trim()
  return null
}
// Build SMS address from phone + carrier
export function buildSmsAddress(phone, carrier) {
  if (!phone || !carrier) return null
  const digits = phone.replace(/\D/g,'')
  if (digits.length < 10) return null
  return digits.slice(-10) + carrier
}
// Compute leaderboard date window from range setting
export function getRangeWindow(range, customFrom, customTo) {
  const now = new Date()
  if (range === 'all_time') return { from: null, to: null }
  if (range === 'custom') return { from: customFrom||null, to: customTo||null }
  const days = {
    rolling_week:15, rolling_month:30, rolling_quarter:90, rolling_half:182, rolling_year:365
  }[range] || 30
  const from = new Date(now); from.setDate(from.getDate()-days)
  return { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] }
}
