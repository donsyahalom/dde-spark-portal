import { createContext, useContext, useState, useCallback } from 'react'

// Owns the four global UI filters — pc, basis, period, compare.  The
// OpsLayout toolbar exposes the controls; pages read the current state
// to slice their data and render subtitles.
//
// jobTypeOverrides: { [jobNum]: 'contract' | 'service' }
//   User-driven re-classifications that override the Sage-sourced `type`
//   field.  Stored in localStorage so the choice survives page reloads.
//   The A/R page reads the effective type (via applyJobTypeOverrides) so
//   that moving a job between Contract and Service also re-routes its
//   invoices between the AR and SR aging reports.

const Ctx = createContext(null)

const PC_SUBTITLE = {
  COMBINED: 'All profit centers',
  DDE:      'DuBaldo Electric',
  DCM:      'DCM (Prop Mgmt)',
  SILK:     'Silk City',
}

const LS_KEY = 'dde.ops.jobTypeOverrides'

function loadOverrides() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveOverrides(o) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)) } catch {}
}

export function OpsViewStateProvider({ children }) {
  const [pc, setPc]           = useState('DDE')
  const [basis, setBasis]     = useState('Accrual')
  const [period, setPeriod]   = useState('ttm')
  const [compare, setCompare] = useState('none')

  // { [jobNum]: 'contract' | 'service' } — persisted to localStorage
  const [jobTypeOverrides, setJobTypeOverridesRaw] = useState(loadOverrides)

  const setJobTypeOverride = useCallback((jobNum, newType) => {
    setJobTypeOverridesRaw((prev) => {
      const next = { ...prev, [jobNum]: newType }
      saveOverrides(next)
      return next
    })
  }, [])

  // Apply overrides to an array of jobs — returns new array with type
  // fields patched so every consumer (Jobs page, A/R page, productivity
  // cards, etc.) sees the user-adjusted classification without extra wiring.
  const applyJobTypeOverrides = useCallback(
    (jobs) =>
      jobs.map((j) =>
        jobTypeOverrides[j.num]
          ? { ...j, type: jobTypeOverrides[j.num], _typeOverridden: true }
          : j,
      ),
    [jobTypeOverrides],
  )

  const subtitle = useCallback(
    () => `${PC_SUBTITLE[pc]} · ${basis} basis`,
    [pc, basis],
  )

  return (
    <Ctx.Provider value={{
      pc, basis, period, compare,
      setPc, setBasis, setPeriod, setCompare, subtitle,
      jobTypeOverrides,
      setJobTypeOverride,
      applyJobTypeOverrides,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useOpsViewState() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useOpsViewState must be used inside <OpsViewStateProvider>')
  return ctx
}
