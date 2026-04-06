// sync-prod-to-uat.js
// Copies all tables from the production Supabase project to the UAT project.
//
// Run manually:
//   node --env-file=.env.sync scripts/sync-prod-to-uat.js
//
// Runs automatically every Sunday at 2 AM ET via .github/workflows/sync-uat.yml

import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const PROD_URL  = process.env.PROD_SUPABASE_URL
const PROD_KEY  = process.env.PROD_SERVICE_ROLE_KEY   // service_role — never the anon key
const UAT_URL   = process.env.UAT_SUPABASE_URL
const UAT_KEY   = process.env.UAT_SERVICE_ROLE_KEY

// Tables in dependency order: parents before children.
// If you add a new table, add it here in the right position.
const TABLES = [
  'settings',
  'employees',
  'spark_transactions',
  'pending_vesting',
  'daily_given',
]

// ── Validation ────────────────────────────────────────────────────────────────

function validateEnv() {
  const missing = ['PROD_SUPABASE_URL','PROD_SERVICE_ROLE_KEY','UAT_SUPABASE_URL','UAT_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k])
  if (missing.length) {
    console.error('❌  Missing required env vars:', missing.join(', '))
    console.error('    Create a .env.sync file (see .env.sync.example) and run:')
    console.error('    node --env-file=.env.sync scripts/sync-prod-to-uat.js')
    process.exit(1)
  }
  if (PROD_URL === UAT_URL) {
    console.error('❌  PROD_SUPABASE_URL and UAT_SUPABASE_URL are the same — aborting to protect prod data.')
    process.exit(1)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchAll(client, table) {
  const { data, error } = await client.from(table).select('*')
  if (error) throw new Error(`Read "${table}" from prod: ${error.message}`)
  return data ?? []
}

async function clearTable(client, table) {
  // Delete all rows. The UUID filter is a workaround — Supabase REST API requires
  // at least one filter on DELETE; this filter matches every row.
  const { error } = await client
    .from(table)
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) throw new Error(`Clear "${table}" in UAT: ${error.message}`)
}

async function insertRows(client, table, rows) {
  const CHUNK_SIZE = 500
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const { error } = await client.from(table).insert(chunk)
    if (error) throw new Error(`Insert into "${table}" (offset ${i}): ${error.message}`)
  }
}

function pad(str, len) {
  return String(str).padEnd(len, ' ')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function sync() {
  validateEnv()

  const prod = createClient(PROD_URL, PROD_KEY)
  const uat  = createClient(UAT_URL,  UAT_KEY)

  console.log('')
  console.log('╔══════════════════════════════════════╗')
  console.log('║   DDE Spark Portal — Prod → UAT Sync ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  Started: ${new Date().toISOString()}`)
  console.log(`  Prod:    ${PROD_URL}`)
  console.log(`  UAT:     ${UAT_URL}`)
  console.log('')

  // ── Step 1: Read all prod data upfront ──────────────────────────────────────
  console.log('  📖 Reading production tables…')
  const data = {}
  for (const table of TABLES) {
    data[table] = await fetchAll(prod, table)
    console.log(`     ${pad(table, 22)} ${data[table].length} rows`)
  }

  // ── Step 2: Clear UAT in reverse FK order ───────────────────────────────────
  console.log('')
  console.log('  🗑  Clearing UAT tables (reverse FK order)…')
  const reverseOrder = [...TABLES].reverse()
  for (const table of reverseOrder) {
    await clearTable(uat, table)
    console.log(`     cleared: ${table}`)
  }

  // ── Step 3: Insert into UAT in FK order ────────────────────────────────────
  console.log('')
  console.log('  📥 Inserting into UAT…')
  for (const table of TABLES) {
    const rows = data[table]
    if (rows.length === 0) {
      console.log(`     ${pad(table, 22)} (empty — skipped)`)
      continue
    }
    await insertRows(uat, table, rows)
    console.log(`     ${pad(table, 22)} ✓ ${rows.length} rows`)
  }

  console.log('')
  console.log(`  ✅ Sync complete.  ${new Date().toISOString()}`)
  console.log('')
}

sync().catch(err => {
  console.error('')
  console.error('❌ Sync failed:', err.message)
  console.error('')
  process.exit(1)
})
