import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { OpsViewStateProvider, useOpsViewState } from '../../context/OpsViewStateContext'
import { OpsCashflowBasisProvider } from '../../context/OpsCashflowBasisContext'
import '../../ops.css'

const SUBNAV = [
  { to: '/ops',            label: 'Overview',  end: true },
  { to: '/ops/pnl',        label: 'Company P&L' },
  { to: '/ops/jobs',       label: 'Jobs P&L' },
  { to: '/ops/cashflow',   label: 'Cashflow' },
  { to: '/ops/ar',         label: 'A/R' },
  { to: '/ops/ap',         label: 'A/P' },
  { to: '/ops/payroll',    label: 'Payroll' },
  { to: '/ops/kpis',       label: 'KPIs' },
  { to: '/ops/permissions',label: 'Permissions' },
]

const PCS = [
  { id: 'COMBINED', label: 'Combined' },
  { id: 'DDE',      label: 'DuBaldo Electric' },
  { id: 'DCM',      label: 'DCM (Prop Mgmt)' },
  { id: 'SILK',     label: 'Silk City' },
]

const PAGE_TITLE = {
  '/ops':             'Overview',
  '/ops/pnl':         'Company P&L',
  '/ops/jobs':        'Jobs P&L',
  '/ops/cashflow':    'Cashflow',
  '/ops/ar':          'A/R Detail',
  '/ops/ap':          'A/P Detail',
  '/ops/payroll':     'Payroll',
  '/ops/kpis':        'KPIs',
  '/ops/permissions': 'Permissions',
}

// ── header row: page title + basis/period/compare toolbar ────────────
function OpsHeader() {
  const { pathname } = useLocation()
  const { basis, setBasis, period, setPeriod, compare, setCompare, subtitle } = useOpsViewState()

  // Exact match first, then prefix match
  const title =
    PAGE_TITLE[pathname] ||
    Object.entries(PAGE_TITLE).find(([k]) => k !== '/ops' && pathname.startsWith(k))?.[1] ||
    'Operations'

  return (
    <div className="ops-header">
      <div>
        <h1>{title}</h1>
        <div className="ops-subtitle">{subtitle()}</div>
      </div>
      <div className="ops-toolbar">
        <div className="ops-toggle">
          {['Accrual', 'Cash'].map((b) => (
            <button
              key={b}
              onClick={() => setBasis(b)}
              className={basis === b ? 'active' : ''}
            >{b}</button>
          ))}
        </div>
        <select className="ops-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="mtd">MTD</option>
          <option value="qtd">QTD</option>
          <option value="ytd">YTD</option>
          <option value="ttm">Trailing 12</option>
          <option value="last_month">Last month</option>
          <option value="last_quarter">Last quarter</option>
          <option value="last_year">Last year</option>
          <option value="custom">Custom…</option>
        </select>
        <select className="ops-select" value={compare} onChange={(e) => setCompare(e.target.value)}>
          <option value="none">Compare: none</option>
          <option value="prior">vs prior period</option>
          <option value="goal">vs goal</option>
          <option value="both">vs prior + goal</option>
        </select>
      </div>
    </div>
  )
}

// ── profit-center pills + tab row ────────────────────────────────────
function OpsSubnav() {
  const { pc, setPc } = useOpsViewState()
  return (
    <>
      <div className="ops-pc">
        {PCS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPc(p.id)}
            className={pc === p.id ? 'active' : ''}
          >{p.label}</button>
        ))}
      </div>
      <div className="ops-subnav">
        {SUBNAV.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >{t.label}</NavLink>
        ))}
      </div>
    </>
  )
}

// ── The main ops shell — sits inside Sparks' main Layout <Outlet /> ──
export default function OpsLayout() {
  return (
    <OpsViewStateProvider>
      <OpsCashflowBasisProvider>
        <div className="ops-root fade-in">
          <OpsHeader />
          <OpsSubnav />
          <Outlet />
        </div>
      </OpsCashflowBasisProvider>
    </OpsViewStateProvider>
  )
}
