/**
 * Netlify Scheduled Function: send-review-reminders
 * Runs daily at 9 AM ET (14:00 UTC) via netlify.toml schedule.
 *
 * Logic:
 *  - Finds all perf_cycles that are pending/in_progress AND have a due_date
 *  - If due_date is within 2 days OR already past → send reminder to foreman
 *  - Reminder includes a direct link to the reviews page
 *
 * Required env vars (set in Netlify UI):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, APP_URL
 */

const { createClient } = require('@supabase/supabase-js')

const handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const resendKey = process.env.RESEND_API_KEY
  const appUrl = process.env.APP_URL || 'https://dde-spark-portal.netlify.app'

  // Check go-live gate
  const { data: goLiveSetting } = await supabase
    .from('settings').select('value').eq('key', 'go_live_date').single()
  const goLive = goLiveSetting?.value
  if (goLive && new Date() < new Date(goLive)) {
    console.log('Pre-launch mode — review reminders suppressed')
    return { statusCode: 200, body: 'Pre-launch — suppressed' }
  }

  const today = new Date()
  // Fetch all incomplete cycles that have a due date
  const { data: cycles, error } = await supabase
    .from('perf_cycles')
    .select(`
      id, due_date, status,
      employee:employee_id(id, first_name, last_name),
      foreman:foreman_id(id, first_name, last_name, email)
    `)
    .in('status', ['pending', 'in_progress'])
    .not('due_date', 'is', null)

  if (error) {
    console.error('Error fetching cycles:', error)
    return { statusCode: 500, body: error.message }
  }

  let sent = 0
  for (const cycle of (cycles || [])) {
    if (!cycle.foreman?.email || !cycle.due_date) continue

    const dueDate = new Date(cycle.due_date + 'T00:00:00')
    const daysUntilDue = Math.ceil((dueDate - today) / 86400000)

    // Send if due within 2 days OR already overdue
    if (daysUntilDue > 2) continue

    const employeeName = `${cycle.employee?.first_name || ''} ${cycle.employee?.last_name || ''}`.trim()
    const dueDateFormatted = dueDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

    const isOverdue = daysUntilDue < 0
    const urgencyText = isOverdue
      ? `This review is <strong style="color:#E05555">overdue</strong> (was due ${dueDateFormatted}).`
      : daysUntilDue === 0
        ? `This review is <strong style="color:#E05555">due today</strong>.`
        : `This review is due in <strong style="color:#F0C040">${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}</strong> (${dueDateFormatted}).`

    const subject = isOverdue
      ? `Overdue: Performance review for ${employeeName}`
      : `Reminder: Performance review for ${employeeName} due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`}`

    const html = `<!DOCTYPE html><html><body style="background:#112e1c;color:#fff;font-family:Georgia,serif;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#0d2118;border:1px solid rgba(240,192,64,0.3);border-radius:12px;overflow:hidden">
<div style="padding:28px;text-align:center;border-bottom:2px solid ${isOverdue ? '#E05555' : '#F0C040'}">
  <div style="font-size:2rem">${isOverdue ? '⚠️' : '⏰'}</div>
  <h1 style="color:${isOverdue ? '#E05555' : '#F0C040'};font-size:1.3rem;margin:8px 0 0">
    ${isOverdue ? 'Overdue' : 'Reminder'}: Performance Review
  </h1>
</div>
<div style="padding:24px">
  <p style="margin:0 0 16px">Hi ${cycle.foreman.first_name},</p>
  <p style="margin:0 0 16px">
    You have a pending performance review for <strong style="color:#F0C040">${employeeName}</strong>.
    ${urgencyText}
  </p>
  <div style="text-align:center;margin-bottom:24px">
    <a href="${appUrl}/performance" style="display:inline-block;background:#F0C040;color:#112e1c;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">
      Complete the Review →
    </a>
  </div>
  <p style="color:rgba(255,255,255,0.4);font-size:0.8rem;margin:0">
    If the button doesn't work, visit: ${appUrl}/performance
  </p>
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
          to: cycle.foreman.email,
          subject,
          html,
        })
      })
      if (res.ok) {
        sent++
        // Log the reminder
        await supabase.from('notification_log').insert({
          employee_id: cycle.foreman.id,
          notification_type: 'review_reminder',
          channel: 'email',
          subject,
          success: true,
          error_msg: null,
        }).catch(() => {}) // non-fatal
      } else {
        const err = await res.text()
        console.error(`Failed to send reminder to ${cycle.foreman.email}:`, err)
      }
    } catch (e) {
      console.error('Resend error:', e)
    }
  }

  console.log(`Review reminders: sent ${sent} of ${(cycles || []).filter(c => {
    const d = new Date(c.due_date + 'T00:00:00')
    return Math.ceil((d - today) / 86400000) <= 2
  }).length} eligible`)

  return { statusCode: 200, body: `Sent ${sent} reminder(s)` }
}

module.exports = { handler }
