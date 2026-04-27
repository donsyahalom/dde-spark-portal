// Supabase Edge Function: send-notification
// Deploy: supabase functions deploy send-notification
// Env vars required: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json()
    const { to, subject, html, channel, broadcast, message, pushEmail, pushSms, employeeId } = body

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Broadcast to all employees
    if (broadcast) {
      const { data: emps } = await supa.from('employees').select('*').eq('is_admin', false)
      const results = []
      for (const emp of (emps || [])) {
        if (pushEmail && emp.notify_email && emp.email) {
          const r = await sendViaResend(resendKey, emp.email, subject || 'New Announcement', html || `<p>${message}</p>`)
          results.push({ emp: emp.id, channel: 'email', ok: r.ok })
          await supa.from('notification_log').insert({ employee_id: emp.id, notification_type: 'broadcast', channel: 'email', subject, success: r.ok })
        }
        if (pushSms && emp.notify_sms && emp.phone && emp.carrier) {
          const smsAddr = emp.phone.replace(/\D/g, '').slice(-10) + emp.carrier
          const r = await sendViaResend(resendKey, smsAddr, subject || 'DDE SPARKS', message || '')
          results.push({ emp: emp.id, channel: 'sms', ok: r.ok })
          await supa.from('notification_log').insert({ employee_id: emp.id, notification_type: 'broadcast', channel: 'sms', subject, success: r.ok })
        }
      }
      return new Response(JSON.stringify({ ok: true, results }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Single send
    if (!to) return new Response(JSON.stringify({ error: 'No recipient' }), { status: 400, headers: cors })
    if (!resendKey) {
      console.warn('No RESEND_API_KEY — logging only')
      if (employeeId) await supa.from('notification_log').insert({ employee_id: employeeId, notification_type: 'test', channel: channel || 'email', subject, success: false, error_msg: 'No API key' })
      return new Response(JSON.stringify({ ok: false, note: 'No RESEND_API_KEY' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const result = await sendViaResend(resendKey, to, subject || 'DDE SPARKS Portal', html || '')
    return new Response(JSON.stringify({ ok: result.ok, data: result.data }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors })
  }
})

async function sendViaResend(apiKey: string | undefined, to: string, subject: string, html: string) {
  if (!apiKey) return { ok: false, data: null }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'DDE SPARKS Portal <lena@dubaldo.com>', to, subject, html })
  })
  const data = await res.json()
  return { ok: res.ok, data }
}
