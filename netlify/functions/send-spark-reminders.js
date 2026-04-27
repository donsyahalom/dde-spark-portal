/**
 * Netlify Scheduled Function: send-spark-reminders
 * Runs every hour at the top of the hour.
 * Handles two jobs:
 *  1) RESET daily_sparks_remaining at period rollover (daily/weekly/monthly/biweekly)
 *  2) SEND reminder emails to employees who still have sparks left to give,
 *     based on reminder_offsets in the settings table.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, APP_URL
 */

const { createClient } = require('@supabase/supabase-js')

const handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const resendKey = process.env.RESEND_API_KEY
  const appUrl = process.env.APP_URL || 'https://dde-spark-portal.netlify.app'

  // ── Load settings ──────────────────────────────────────────────────────
  const { data: settingsRows } = await supabase.from('settings').select('key,value')
  const settings = {}
  ;(settingsRows || []).forEach(s => { settings[s.key] = s.value })

  const goLive = settings.go_live_date
  if (goLive && new Date() < new Date(goLive)) {
    console.log('Pre-launch — reminders suppressed')
    return { statusCode: 200, body: 'Pre-launch' }
  }

  if (settings.reminder_enabled !== 'true') {
    console.log('Reminders disabled in settings')
    return { statusCode: 200, body: 'Reminders disabled' }
  }

  const frequency = settings.spark_frequency || 'daily'
  const now = new Date()
  const nowHour = now.getHours() // CT local approximation; adjust if needed

  // ── Determine period boundaries ────────────────────────────────────────
  let periodEndDate = null
  let hoursUntilReset = null

  if (frequency === 'daily') {
    // Resets at midnight each day — hours until reset = 23 - currentHour
    hoursUntilReset = 23 - nowHour
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    periodEndDate = tomorrow
  } else if (frequency === 'weekly') {
    // Find next Monday 00:00
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7
    const nextMonday = new Date(now)
    nextMonday.setDate(now.getDate() + daysUntilMonday)
    nextMonday.setHours(0, 0, 0, 0)
    const msUntil = nextMonday - now
    hoursUntilReset = Math.floor(msUntil / 3600000)
    periodEndDate = nextMonday
  } else if (frequency === 'monthly') {
    // First of next month
    const firstNext = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0)
    const msUntil = firstNext - now
    hoursUntilReset = Math.floor(msUntil / 3600000)
    periodEndDate = firstNext
  } else if (frequency === 'biweekly') {
    // Uses biweekly_reference_date — calculate next reset
    const refDate = settings.biweekly_reference_date
      ? new Date(settings.biweekly_reference_date + 'T00:00:00')
      : new Date()
    const msSinceRef = now - refDate
    const msBiweekly = 14 * 24 * 3600000
    const msUntil = msBiweekly - (msSinceRef % msBiweekly)
    hoursUntilReset = Math.floor(msUntil / 3600000)
    periodEndDate = new Date(now.getTime() + msUntil)
  }

  // ── Check if this is a reset hour ─────────────────────────────────────
  // Reset happens at hour 0 of the new period. Check if we just crossed midnight
  // by seeing if it's currently hour 0 and periodEndDate was "yesterday/last period"
  const shouldReset = frequency === 'daily'
    ? now.getHours() === 0
    : frequency === 'weekly'
      ? now.getDay() === 1 && now.getHours() === 0
      : frequency === 'monthly'
        ? now.getDate() === 1 && now.getHours() === 0
        : false

  if (shouldReset) {
    console.log('Running period reset — resetting daily_sparks_remaining')
    const { data: emps } = await supabase
      .from('employees')
      .select('id, daily_accrual')
      .eq('is_admin', false)

    for (const emp of (emps || [])) {
      await supabase.from('employees')
        .update({ daily_sparks_remaining: emp.daily_accrual || 0, updated_at: new Date().toISOString() })
        .eq('id', emp.id)
    }
    console.log(`Reset ${(emps || []).length} employees`)
  }

  // ── Send reminder emails ───────────────────────────────────────────────
  if (hoursUntilReset === null) return { statusCode: 200, body: 'No period info' }

  const offsets = (settings.reminder_offsets || '48,24')
    .split(',').map(x => parseInt(x.trim())).filter(n => !isNaN(n) && n > 0)

  // Check if hoursUntilReset matches any offset (±1hr window)
  const shouldSendReminder = offsets.some(o => Math.abs(hoursUntilReset - o) <= 1)
  if (!shouldSendReminder) {
    return { statusCode: 200, body: `No reminder due. Hours until reset: ${hoursUntilReset}` }
  }

  // Fetch employees with sparks remaining and email notifications on
  const { data: empsToRemind } = await supabase
    .from('employees')
    .select('id, first_name, last_name, email, daily_sparks_remaining, daily_accrual, notify_email')
    .eq('is_admin', false)
    .eq('notify_email', true)
    .gt('daily_sparks_remaining', 0)

  let sent = 0
  for (const emp of (empsToRemind || [])) {
    const mySparkUrl = `${appUrl}/my-sparks`
    const daysLabel = frequency === 'daily' ? 'day' : frequency === 'weekly' ? 'week' : 'month'
    const html = `<!DOCTYPE html><html><body style="background:#112e1c;color:#fff;font-family:Georgia,serif;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#0d2118;border:1px solid rgba(240,192,64,0.3);border-radius:12px;overflow:hidden">
<div style="padding:28px;text-align:center;border-bottom:2px solid #F0C040">
  <div style="font-size:2rem">✨</div>
  <h1 style="color:#F0C040;font-size:1.3rem;margin:8px 0 0">Don't forget your Sparks!</h1>
</div>
<div style="padding:24px">
  <p style="margin:0 0 16px">Hi ${emp.first_name},</p>
  <p style="margin:0 0 16px">
    You still have <strong style="color:#F0C040;font-size:1.1em">${emp.daily_sparks_remaining} spark${emp.daily_sparks_remaining !== 1 ? 's' : ''}</strong>
    left to give this ${daysLabel}. Your allowance resets in about <strong style="color:#F0C040">${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}</strong> —
    don't let them go to waste!
  </p>
  <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:0.9rem">
    Recognize a teammate who went above and beyond, showed great teamwork, or made the job site better.
  </p>
  <div style="text-align:center;margin-bottom:24px">
    <a href="${mySparkUrl}" style="display:inline-block;background:#F0C040;color:#112e1c;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">
      Send My Sparks Now →
    </a>
  </div>
  <p style="color:rgba(255,255,255,0.4);font-size:0.8rem;margin:0">If the button doesn't work, visit: ${mySparkUrl}</p>
</div>
<div style="padding:14px 20px;text-align:center;color:rgba(255,255,255,0.35);font-size:0.75rem;border-top:1px solid rgba(240,192,64,0.15)">
  DDE SPARKS Portal · D. DuBaldo Electric
</div>
</div></body></html>`

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'DDE SPARKS Portal <sparks@dubaldo.com>',
          to: emp.email,
          subject: `Reminder: You have ${emp.daily_sparks_remaining} spark${emp.daily_sparks_remaining !== 1 ? 's' : ''} left to give this ${daysLabel}`,
          html,
        })
      })
      if (res.ok) {
        sent++
        await supabase.from('notification_log').insert({
          employee_id: emp.id,
          notification_type: 'reminder',
          channel: 'email',
          subject: `Reminder: ${emp.daily_sparks_remaining} sparks remaining`,
          success: true,
          error_msg: null,
        }).catch(() => {})
      }
    } catch (e) {
      console.error('Resend error for', emp.email, e)
    }
  }

  console.log(`Sent ${sent} reminder email(s). Hours until reset: ${hoursUntilReset}`)
  return { statusCode: 200, body: `Sent ${sent} reminder(s). ${hoursUntilReset}h until reset.` }
}

module.exports = { handler }
