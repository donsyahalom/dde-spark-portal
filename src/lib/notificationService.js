import { supabase } from './supabase'
import { buildSmsAddress } from './constants'

// Send email via Supabase Edge Function (uses Resend)
export async function sendEmail({ to, subject, html, employeeId, type='email', notifType='summary' }) {
  try {
    const { error } = await supabase.functions.invoke('send-notification', {
      body: { to, subject, html, channel:'email' }
    })
    await supabase.from('notification_log').insert({
      employee_id: employeeId, notification_type: notifType,
      channel: 'email', subject, success: !error, error_msg: error?.message||null
    })
    return { error }
  } catch(e) {
    await supabase.from('notification_log').insert({
      employee_id: employeeId, notification_type: notifType,
      channel: 'email', subject, success: false, error_msg: e.message
    })
    return { error: e }
  }
}

// Send SMS via email-to-SMS gateway
export async function sendSms({ phone, carrier, subject, text, employeeId, notifType='summary' }) {
  const smsAddr = buildSmsAddress(phone, carrier)
  if (!smsAddr) return { error: 'Invalid phone/carrier' }
  try {
    const { error } = await supabase.functions.invoke('send-notification', {
      body: { to: smsAddr, subject: subject||'DDE Sparks', html: text, channel:'sms' }
    })
    await supabase.from('notification_log').insert({
      employee_id: employeeId, notification_type: notifType,
      channel: 'sms', subject: subject||'DDE Sparks', success: !error, error_msg: error?.message||null
    })
    return { error }
  } catch(e) {
    return { error: e }
  }
}

// Check go-live gate: return true if system emails/SMS should be suppressed
export async function isBeforeGoLive() {
  const { data } = await supabase.from('settings').select('value').eq('key','go_live_date').single()
  const goLive = data?.value
  if (!goLive) return true  // no date set = suppress
  return new Date() < new Date(goLive)
}

// Send summary email for one employee
export async function sendSummaryEmail(emp, periodStart, periodEnd) {
  if (!emp.notify_email) return
  const { data: given } = await supabase.from('spark_transactions')
    .select('*, to_emp:to_employee_id(first_name,last_name)')
    .eq('from_employee_id', emp.id).eq('transaction_type','assign')
    .gte('created_at', periodStart+'T00:00:00').lte('created_at', periodEnd+'T23:59:59')
  const { data: received } = await supabase.from('spark_transactions')
    .select('*, from_emp:from_employee_id(first_name,last_name)')
    .eq('to_employee_id', emp.id).eq('transaction_type','assign')
    .gte('created_at', periodStart+'T00:00:00').lte('created_at', periodEnd+'T23:59:59')
  const totalGiven = (given||[]).reduce((s,t)=>s+t.amount,0)
  const totalRcv   = (received||[]).reduce((s,t)=>s+t.amount,0)
  const total = (emp.vested_sparks||0)+(emp.unvested_sparks||0)
  const html = buildSummaryHtml({ emp, given:given||[], received:received||[], totalGiven, totalRcv, total, periodStart, periodEnd })
  await sendEmail({ to: emp.email, subject: `Your DDE Spark Summary — ${periodStart} to ${periodEnd}`, html, employeeId: emp.id, notifType:'summary' })
  if (emp.notify_sms && emp.phone && emp.carrier) {
    const smsText = `DDE Sparks: ${totalRcv} received, ${totalGiven} given, ${emp.daily_sparks_remaining||0} remaining. Period: ${periodStart} - ${periodEnd}`
    await sendSms({ phone: emp.phone, carrier: emp.carrier, text: smsText, employeeId: emp.id, notifType:'summary' })
  }
}

// Send test notification to one employee
export async function sendTestNotification(emp, channel) {
  const html = `<h2>Test from DDE Spark Portal</h2><p>Hi ${emp.first_name}, this is a test ${channel === 'sms' ? 'SMS' : 'email'} from the DDE Spark Portal. If you received this, notifications are working!</p>`
  if (channel === 'email' || channel === 'both') {
    await sendEmail({ to: emp.email, subject: '[TEST] DDE Spark Portal Test', html, employeeId: emp.id, notifType:'test' })
  }
  if ((channel === 'sms' || channel === 'both') && emp.phone && emp.carrier) {
    await sendSms({ phone: emp.phone, carrier: emp.carrier, text: `[TEST] DDE Spark Portal test message for ${emp.first_name}`, employeeId: emp.id, notifType:'test' })
  }
}

function buildSummaryHtml({ emp, given, received, totalGiven, totalRcv, total, periodStart, periodEnd }) {
  const rcvRows = received.map(t=>`<tr><td>${new Date(t.created_at).toLocaleDateString()}</td><td>${t.from_emp?.first_name||''} ${t.from_emp?.last_name||''}</td><td style="color:#F0C040">✨ ${t.amount}</td><td style="color:#aaa">${t.reason||'—'}</td></tr>`).join('')
  const givRows = given.map(t=>`<tr><td>${new Date(t.created_at).toLocaleDateString()}</td><td>${t.to_emp?.first_name||''} ${t.to_emp?.last_name||''}</td><td style="color:#F0C040">✨ ${t.amount}</td><td style="color:#aaa">${t.reason||'—'}</td></tr>`).join('')
  return `<!DOCTYPE html><html><body style="background:#112e1c;color:#fff;font-family:Georgia,serif;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#0d2118;border:1px solid rgba(240,192,64,0.3);border-radius:12px;overflow:hidden">
<div style="padding:28px;text-align:center;border-bottom:2px solid #F0C040">
  <div style="font-size:2rem">✨</div><h1 style="color:#F0C040;font-size:1.3rem;margin:8px 0 0">DDE Spark Summary</h1>
  <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:0.85rem">Hi ${emp.first_name}! ${periodStart} – ${periodEnd}</p>
</div>
<div style="display:flex;padding:20px;gap:10px;flex-wrap:wrap">
  <div style="flex:1;min-width:80px;background:rgba(0,0,0,0.3);border:1px solid rgba(240,192,64,0.2);border-radius:8px;padding:14px;text-align:center">
    <div style="font-size:1.8rem;font-weight:bold;color:#F0C040">${total}</div><div style="font-size:0.7rem;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-top:4px">Total</div>
  </div>
  <div style="flex:1;min-width:80px;background:rgba(0,0,0,0.3);border:1px solid rgba(240,192,64,0.2);border-radius:8px;padding:14px;text-align:center">
    <div style="font-size:1.8rem;font-weight:bold;color:#F0C040">${totalRcv}</div><div style="font-size:0.7rem;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-top:4px">Received</div>
  </div>
  <div style="flex:1;min-width:80px;background:rgba(0,0,0,0.3);border:1px solid rgba(240,192,64,0.2);border-radius:8px;padding:14px;text-align:center">
    <div style="font-size:1.8rem;font-weight:bold;color:#F0C040">${totalGiven}</div><div style="font-size:0.7rem;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-top:4px">Given</div>
  </div>
  <div style="flex:1;min-width:80px;background:rgba(0,0,0,0.3);border:1px solid rgba(240,192,64,0.2);border-radius:8px;padding:14px;text-align:center">
    <div style="font-size:1.8rem;font-weight:bold;color:${emp.daily_sparks_remaining>0?'#5EE88A':'#E05555'}">${emp.daily_sparks_remaining||0}</div><div style="font-size:0.7rem;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-top:4px">Remaining</div>
  </div>
</div>
${received.length>0?`<div style="padding:0 20px 20px"><h2 style="font-size:0.8rem;text-transform:uppercase;color:#F0C040;letter-spacing:0.1em;margin-bottom:10px">✨ Sparks Received (${totalRcv})</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.82rem"><tr style="background:rgba(0,0,0,0.4)"><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">Date</th><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">From</th><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">Amt</th><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">Reason</th></tr>${rcvRows}</table></div>`:''}
${given.length>0?`<div style="padding:0 20px 20px"><h2 style="font-size:0.8rem;text-transform:uppercase;color:#F0C040;letter-spacing:0.1em;margin-bottom:10px">📤 Sparks Given (${totalGiven})</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.82rem"><tr style="background:rgba(0,0,0,0.4)"><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">Date</th><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">To</th><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">Amt</th><th style="padding:7px 10px;text-align:left;color:rgba(255,255,255,0.5)">Reason</th></tr>${givRows}</table></div>`:''}
<div style="padding:16px 20px;text-align:center;color:rgba(255,255,255,0.35);font-size:0.75rem;border-top:1px solid rgba(240,192,64,0.15)">DDE Spark Portal · D. DuBaldo Electric</div>
</div></body></html>`
}
