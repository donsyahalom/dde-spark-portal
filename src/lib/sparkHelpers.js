import { supabase } from './supabase'
import { addDays, format } from 'date-fns'

/**
 * Core function to assign sparks from one employee to another.
 * Handles: transaction, pending_vesting, recipient balance, sender balance, daily_given tracking.
 * Returns { error } or {}
 */
export async function assignSparks({
  fromId,
  toId,
  amount,
  reason,
  vestingDays,
  ctToday,
  alreadyGivenToRecipient,
  currentSenderRemaining,
  isListDistribution = false,
}) {
  const immediateVesting = vestingDays === 0
  const vestingDate = format(addDays(new Date(), immediateVesting ? 0 : vestingDays), 'yyyy-MM-dd')

  // Insert transaction
  const { data: txn, error: txnError } = await supabase
    .from('spark_transactions')
    .insert({
      from_employee_id: fromId,
      to_employee_id: toId,
      amount,
      transaction_type: 'assign',
      vesting_date: vestingDate,
      vested: immediateVesting,
      reason,
      is_list_distribution: isListDistribution,
    })
    .select()
    .single()

  if (txnError) return { error: txnError.message }

  if (immediateVesting) {
    // No vesting queue — go straight to vested balance
    const { data: recip } = await supabase.from('employees').select('vested_sparks').eq('id', toId).single()
    await supabase.from('employees')
      .update({ vested_sparks: (recip?.vested_sparks || 0) + amount, updated_at: new Date().toISOString() })
      .eq('id', toId)
  } else {
    // Queue for vesting
    await supabase.from('pending_vesting').insert({
      employee_id: toId,
      amount,
      vests_on: vestingDate,
      transaction_id: txn.id,
    })

    // Increment recipient unvested
    const { data: recip } = await supabase.from('employees').select('unvested_sparks').eq('id', toId).single()
    await supabase.from('employees')
      .update({ unvested_sparks: (recip?.unvested_sparks || 0) + amount, updated_at: new Date().toISOString() })
      .eq('id', toId)
  }

  // Deduct from sender's remaining allowance
  await supabase.from('employees')
    .update({ daily_sparks_remaining: Math.max(0, currentSenderRemaining - amount), updated_at: new Date().toISOString() })
    .eq('id', fromId)

  // Upsert per-recipient daily_given
  await supabase.from('daily_given').upsert({
    from_employee_id: fromId,
    to_employee_id: toId,
    given_date: ctToday,
    amount: (alreadyGivenToRecipient || 0) + amount,
  }, { onConflict: 'from_employee_id,to_employee_id,given_date' })

  return { txn }
}
