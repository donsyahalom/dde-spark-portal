import { createContext, useContext, useState, useCallback } from 'react'

// Owns the four global UI filters — pc, basis, period, compare.  The
// OpsLayout toolbar exposes the controls; pages read the current state
// to slice their data and render subtitles.

const Ctx = createContext(null)

const PC_SUBTITLE = {
  COMBINED: 'All profit centers',
  DDE:      'DuBaldo Electric',
  DCM:      'DCM (Prop Mgmt)',
  SILK:     'Silk City',
}

export function OpsViewStateProvider({ children }) {
  const [pc, setPc]           = useState('DDE')
  const [basis, setBasis]     = useState('Accrual')
  const [period, setPeriod]   = useState('ytd')
  const [compare, setCompare] = useState('none')

  const subtitle = useCallback(
    () => `${PC_SUBTITLE[pc]} · ${basis} basis`,
    [pc, basis],
  )

  return (
    <Ctx.Provider value={{ pc, basis, period, compare, setPc, setBasis, setPeriod, setCompare, subtitle }}>
      {children}
    </Ctx.Provider>
  )
}

export function useOpsViewState() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useOpsViewState must be used inside <OpsViewStateProvider>')
  return ctx
}
