import { createContext, useContext, useState, useCallback } from 'react'

// Shared state between the Cashflow page's forecast-timing selector and
// the A/R page's Payment History "Apply to Cashflow" action.  The A/R
// tab can mutate this without either page knowing about the other's
// internals, and the Cashflow page renders a banner describing what the
// user currently sees.

const Ctx = createContext(null)

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const med  = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function OpsCashflowBasisProvider({ children }) {
  const [basis, setBasisState] = useState('due')
  const [perCustomer, setPerCustomer] = useState({})
  const [fallbackAvg, setFallback] = useState(null)
  const [appliedSummary, setAppliedSummary] = useState(null)

  const setBasis = useCallback((b) => {
    setBasisState(b)
    if (b === 'due') {
      setPerCustomer({})
      setFallback(null)
      setAppliedSummary(null)
    }
  }, [])

  const applyPaymentHistory = useCallback((rows, portfolioAvg) => {
    const map = {}
    rows.forEach((r) => { map[r.name] = mean(r._deltas) })
    const avgs = Object.values(map)
    setBasisState('payhist')
    setPerCustomer(map)
    setFallback(portfolioAvg)
    setAppliedSummary(
      avgs.length
        ? { customers: avgs.length, median: med(avgs), min: Math.min(...avgs), max: Math.max(...avgs) }
        : null,
    )
  }, [])

  const daysForCustomer = useCallback((name) => {
    if (basis === 'due') return 0
    const base = perCustomer[name] ?? fallbackAvg ?? 0
    const shift = base - 30 // Net-30 baseline
    return basis === 'blended' ? shift / 2 : shift
  }, [basis, perCustomer, fallbackAvg])

  return (
    <Ctx.Provider value={{ basis, setBasis, perCustomer, fallbackAvg, appliedSummary, applyPaymentHistory, daysForCustomer }}>
      {children}
    </Ctx.Provider>
  )
}

export function useOpsCashflowBasis() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useOpsCashflowBasis must be used inside <OpsCashflowBasisProvider>')
  return c
}
