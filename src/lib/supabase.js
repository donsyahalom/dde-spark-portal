// Supabase JS client.  Reads URL + anon key from the build-time env so
// keys never end up in source.  In Netlify, set the two VITE_SUPABASE_*
// variables in Site configuration -> Environment variables (Builds
// scope), then trigger "Clear cache and deploy site" so Vite re-reads
// them.
//
// IMPORTANT: use the anon/public key here, NOT the service_role key.
// The service_role key bypasses Row-Level Security and must never ship
// in a browser bundle.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Don't throw — the live hook's try/catch will fall back to mocks if
  // the client can't be built — but make the misconfiguration loud in
  // the console so we can spot it without opening the network tab.
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing at build time. ' +
    'Live ops.* queries will fail and the portal will render mocks. ' +
    'Set these in Netlify env (Builds scope) and re-deploy with cache cleared.'
  )
}

export const supabase = createClient(
  SUPABASE_URL || 'https://invalid.local',
  SUPABASE_ANON_KEY || 'invalid'
)
