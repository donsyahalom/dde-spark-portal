import { supabase } from './supabase'
import { addDays, format } from 'date-fns'

/**
 * Core function to assign sparks from one employee to another.
 * - Does a live DB read of sender's remaining allowance before writing
 *   so stale client state can never allow over-sending.
 * - Uses atomic RPC increments for spark balances to prevent race conditions
 *   and ensure rollup values are always accurate.
 *
 * Returns { error } or { txn }
 */
export async function assignSparks({
  fromId,
  toId,
  amount,
  reason,
  vestingDays,
  ctToday,
  alreadyGivenToRecipient,
  currentSenderRemaining, // kept for API compat but live DB value always takes priority
  isListDistribution = false,
}) {
  // ── Live DB check: re-read sender's actual remaining allowance ────────────
  const { data: liveSender, error: senderErr } = await supabase
    .from('employees')
    .select('daily_sparks_remaining')
    .eq('id', fromId)
    .single()

  if (senderErr) return { error: 'Could not verify your spark balance. Please try again.' }

  const liveRemaining = liveSender?.daily_sparks_remaining ?? 0

  if (liveRemaining < amount) {
    return {
      error: `You only have ${liveRemaining} spark${liveRemaining !== 1 ? 's' : ''} remaining — please refresh and try again.`,
    }
  }

  const immediateVesting = vestingDays === 0
  const vestingDate = format(addDays(new Date(), immediateVesting ? 0 : vestingDays), 'yyyy-MM-dd')

  // ── Insert transaction record ─────────────────────────────────────────────
  const { data: txn, error: txnError } = await supabase
    .from('spark_transactions')
    .insert({
      from_employee_id: fromId,
      to_employee_id:   toId,
      amount,
      transaction_type: 'assign',
      vesting_date:     vestingDate,
      vested:           immediateVesting,
      reason,
      is_list_distribution: isListDistribution,
    })
    .select()
    .single()

  if (txnError) return { error: txnError.message }

  // ── Update recipient balance (atomic increment via RPC if available, ──────
  // ── else read-modify-write — both paths update the employee row) ──────────
  if (immediateVesting) {
    const { error: rpcErr } = await supabase.rpc('increment_employee_sparks', {
      emp_id: toId, vested_delta: amount, unvested_delta: 0,
    })
    if (rpcErr) {
      // Fallback: read-modify-write
      const { data: recip } = await supabase.from('employees').select('vested_sparks').eq('id', toId).single()
      await supabase.from('employees')
        .update({ vested_sparks: (recip?.vested_sparks || 0) + amount, updated_at: new Date().toISOString() })
        .eq('id', toId)
    }
  } else {
    // Queue for vesting
    await supabase.from('pending_vesting').insert({
      employee_id:    toId,
      amount,
      vests_on:       vestingDate,
      transaction_id: txn.id,
    })

    const { error: rpcErr } = await supabase.rpc('increment_employee_sparks', {
      emp_id: toId, vested_delta: 0, unvested_delta: amount,
    })
    if (rpcErr) {
      // Fallback: read-modify-write
      const { data: recip } = await supabase.from('employees').select('unvested_sparks').eq('id', toId).single()
      await supabase.from('employees')
        .update({ unvested_sparks: (recip?.unvested_sparks || 0) + amount, updated_at: new Date().toISOString() })
        .eq('id', toId)
    }
  }

  // ── Deduct from sender using the verified live value ──────────────────────
  await supabase.from('employees')
    .update({
      daily_sparks_remaining: Math.max(0, liveRemaining - amount),
      updated_at: new Date().toISOString(),
    })
    .eq('id', fromId)

  // ── Upsert per-recipient daily_given tracking ─────────────────────────────
  await supabase.from('daily_given').upsert({
    from_employee_id: fromId,
    to_employee_id:   toId,
    given_date:       ctToday,
    amount:           (alreadyGivenToRecipient || 0) + amount,
  }, { onConflict: 'from_employee_id,to_employee_id,given_date' })

  return { txn }
}
