// Supabase Edge Function: send-spark-summary
// Deploy with: supabase functions deploy send-spark-summary
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (or SENDGRID_API_KEY)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { employeeId, periodStart, periodEnd } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    // Fetch employee
    const { data: emp } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()

    if (!emp) return new Response(JSON.stringify({ error: 'Employee not found' }), { status: 404 })

    // Fetch sparks given this period
    const { data: given } = await supabase
      .from('spark_transactions')
      .select('*, to_emp:to_employee_id(first_name, last_name)')
      .eq('from_employee_id', employeeId)
      .eq('transaction_type', 'assign')
      .gte('created_at', periodStart + 'T00:00:00')
      .lte('created_at', periodEnd + 'T23:59:59')
      .order('created_at', { ascending: false })

    // Fetch sparks received this period
    const { data: received } = await supabase
      .from('spark_transactions')
      .select('*, from_emp:from_employee_id(first_name, last_name)')
      .eq('to_employee_id', employeeId)
      .eq('transaction_type', 'assign')
      .gte('created_at', periodStart + 'T00:00:00')
      .lte('created_at', periodEnd + 'T23:59:59')
      .order('created_at', { ascending: false })

    const totalGiven = (given || []).reduce((s, t) => s + t.amount, 0)
    const totalReceived = (received || []).reduce((s, t) => s + t.amount, 0)
    const totalSparks = (emp.vested_sparks || 0) + (emp.unvested_sparks || 0)
    const remaining = emp.daily_sparks_remaining || 0

    // Build HTML email
    const html = buildEmailHTML({
      emp, given: given || [], received: received || [],
      totalGiven, totalReceived, totalSparks, remaining,
      periodStart, periodEnd
    })

    // Send via Resend (https://resend.com)
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.warn('No RESEND_API_KEY set — logging email instead')
      // Log that email would have been sent
      await supabase.from('email_log').insert({
        employee_id: employeeId,
        period_start: periodStart,
        period_end: periodEnd,
        sparks_given: totalGiven,
        sparks_received: totalReceived,
        sparks_remaining: remaining,
      })
      return new Response(JSON.stringify({ ok: true, note: 'logged only — no API key' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DDE Spark Portal <sparks@yourdomain.com>',
        to: emp.email,
        subject: `Your DDE Spark Summary — ${periodStart} to ${periodEnd}`,
        html,
      })
    })

    const emailData = await emailRes.json()

    // Log the send
    await supabase.from('email_log').insert({
      employee_id: employeeId,
      period_start: periodStart,
      period_end: periodEnd,
      sparks_given: totalGiven,
      sparks_received: totalReceived,
      sparks_remaining: remaining,
    })

    return new Response(JSON.stringify({ ok: true, emailData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function buildEmailHTML({ emp, given, received, totalGiven, totalReceived, totalSparks, remaining, periodStart, periodEnd }) {
  const givenRows = given.map(t => `
    <tr>
      <td style="padding:8px 12px; border-bottom:1px solid #333;">${new Date(t.created_at).toLocaleDateString()}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #333;">${t.to_emp?.first_name || ''} ${t.to_emp?.last_name || ''}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #333; color:#F0C040;">✨ ${t.amount}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #333; color:#aaa;">${t.reason || '—'}</td>
    </tr>`).join('')

  const receivedRows = received.map(t => `
    <tr>
      <td style="padding:8px 12px; border-bottom:1px solid #333;">${new Date(t.created_at).toLocaleDateString()}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #333;">${t.from_emp?.first_name || ''} ${t.from_emp?.last_name || ''}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #333; color:#F0C040;">✨ ${t.amount}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #333; color:#aaa;">${t.reason || '—'}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: Georgia, serif; background: #1a4a2e; color: #fff; margin:0; padding:0; }
  .container { max-width: 600px; margin: 0 auto; background: #112e1c; border: 1px solid rgba(240,192,64,0.3); border-radius: 12px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #112e1c, #1a4a2e); padding: 32px; text-align: center; border-bottom: 2px solid #F0C040; }
  .header h1 { font-size: 1.5rem; color: #F0C040; margin: 8px 0 0; letter-spacing: 0.05em; }
  .header p { color: rgba(255,255,255,0.6); margin: 4px 0 0; font-size: 0.9rem; }
  .stats { display: flex; padding: 24px; gap: 12px; }
  .stat { flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(240,192,64,0.2); border-radius: 8px; padding: 16px; text-align: center; }
  .stat-val { font-size: 2rem; color: #F0C040; font-weight: bold; }
  .stat-lbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); margin-top: 4px; }
  .section { padding: 0 24px 24px; }
  .section h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: #F0C040; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { background: rgba(0,0,0,0.4); padding: 8px 12px; text-align: left; color: rgba(255,255,255,0.6); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .footer { padding: 20px 24px; text-align: center; color: rgba(255,255,255,0.4); font-size: 0.78rem; border-top: 1px solid rgba(240,192,64,0.15); }
</style></head>
<body>
<div class="container">
  <div class="header">
    <div style="font-size:2rem;">✨</div>
    <h1>DDE Spark Summary</h1>
    <p>Hi ${emp.first_name}! Here's your spark activity for ${periodStart} – ${periodEnd}</p>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-val">${totalSparks}</div><div class="stat-lbl">Total Sparks</div></div>
    <div class="stat"><div class="stat-val">${totalReceived}</div><div class="stat-lbl">Received</div></div>
    <div class="stat"><div class="stat-val">${totalGiven}</div><div class="stat-lbl">Given</div></div>
    <div class="stat"><div class="stat-val" style="color:${remaining > 0 ? '#5EE88A' : '#E05555'}">${remaining}</div><div class="stat-lbl">Remaining</div></div>
  </div>

  ${received.length > 0 ? `
  <div class="section">
    <h2>✨ Sparks Received (${totalReceived})</h2>
    <table>
      <tr><th>Date</th><th>From</th><th>Amount</th><th>Reason</th></tr>
      ${receivedRows}
    </table>
  </div>` : '<div class="section"><p style="color:rgba(255,255,255,0.4); font-size:0.85rem;">No sparks received this period.</p></div>'}

  ${given.length > 0 ? `
  <div class="section">
    <h2>📤 Sparks Given (${totalGiven})</h2>
    <table>
      <tr><th>Date</th><th>To</th><th>Amount</th><th>Reason</th></tr>
      ${givenRows}
    </table>
  </div>` : ''}

  <div class="footer">DDE Spark Portal &nbsp;·&nbsp; D. DuBaldo Electric<br>This is an automated summary email.</div>
</div>
</body></html>`
}
