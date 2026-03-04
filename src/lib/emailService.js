import { supabase } from './supabase'

/**
 * Trigger a summary email for a single employee.
 * Calls the Supabase Edge Function 'send-spark-summary'.
 */
export async function sendSparkSummaryEmail(employeeId, periodStart, periodEnd) {
  try {
    const { data, error } = await supabase.functions.invoke('send-spark-summary', {
      body: { employeeId, periodStart, periodEnd }
    })
    return { data, error }
  } catch (e) {
    console.error('Email send error:', e)
    return { error: e.message }
  }
}

/**
 * Trigger summary emails for all employees.
 * Called at end of frequency period.
 */
export async function sendAllSummaryEmails(periodStart, periodEnd) {
  const { data: emps } = await supabase
    .from('employees')
    .select('id')
    .eq('is_admin', false)
  if (!emps) return
  for (const emp of emps) {
    await sendSparkSummaryEmail(emp.id, periodStart, periodEnd)
  }
}
