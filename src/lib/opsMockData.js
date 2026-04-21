// Mock fixtures ported from the dashboard scaffold, extended for the
// Direct Cost / retainage / PO / service-vs-contract / A/R-aging build.
// When Supabase-backed ops.* views are live, delete this file and have
// useOpsData() query the views instead.  The *shape* of each export is
// the contract the pages rely on.

// --------------------------------------------------------------------
//  Top-level KPIs
// --------------------------------------------------------------------
export const KPIS = {
  COMBINED: [
    { id: 'rev',  label: 'Revenue (YTD)', value: '$41.8M', delta: '+7.1% YoY',    tone: 'pos' },
    { id: 'gp',   label: 'Gross Profit',  value: '$5.87M', delta: '14.1% margin', tone: 'pos' },
    { id: 'net',  label: 'Net Profit',    value: '$1.92M', delta: '4.6% net',     tone: 'pos' },
    { id: 'cash', label: 'Cash on hand',  value: '$1.51M', delta: '3 accounts',   tone: 'neutral' },
    { id: 'ar',   label: 'A/R (balance)', value: '$2.84M', delta: 'DSO 41 d',     tone: 'neutral' },
    { id: 'ap',   label: 'A/P (balance)', value: '$918K',  delta: 'DPO 32 d',     tone: 'neutral' },
  ],
  DDE: [
    { id: 'rev',  label: 'Revenue (YTD)', value: '$28.9M', delta: '+5.4% YoY',    tone: 'pos' },
    { id: 'gp',   label: 'Gross Profit',  value: '$4.02M', delta: '13.9% margin', tone: 'pos' },
    { id: 'net',  label: 'Net Profit',    value: '$1.31M', delta: '4.5% net',     tone: 'pos' },
    { id: 'cash', label: 'Cash on hand',  value: '$847K',  delta: 'Chase 1234 / 5678', tone: 'neutral' },
    { id: 'ar',   label: 'A/R (balance)', value: '$1.92M', delta: 'DSO 43 d',     tone: 'neutral' },
    { id: 'ap',   label: 'A/P (balance)', value: '$612K',  delta: 'DPO 33 d',     tone: 'neutral' },
  ],
  DCM: [
    { id: 'rev',  label: 'Revenue (YTD)', value: '$8.4M',  delta: '+11.2% YoY',   tone: 'pos' },
    { id: 'gp',   label: 'Gross Profit',  value: '$1.32M', delta: '15.7% margin', tone: 'pos' },
    { id: 'net',  label: 'Net Profit',    value: '$420K',  delta: '5.0% net',     tone: 'pos' },
    { id: 'cash', label: 'Cash on hand',  value: '$421K',  delta: 'M&T 4412',     tone: 'neutral' },
    { id: 'ar',   label: 'A/R (balance)', value: '$602K',  delta: 'DSO 37 d',     tone: 'neutral' },
    { id: 'ap',   label: 'A/P (balance)', value: '$198K',  delta: 'DPO 30 d',     tone: 'neutral' },
  ],
  SILK: [
    { id: 'rev',  label: 'Revenue (YTD)', value: '$4.5M',  delta: '+8.6% YoY',    tone: 'pos' },
    { id: 'gp',   label: 'Gross Profit',  value: '$530K',  delta: '11.8% margin', tone: 'pos' },
    { id: 'net',  label: 'Net Profit',    value: '$188K',  delta: '4.2% net',     tone: 'pos' },
    { id: 'cash', label: 'Cash on hand',  value: '$242K',  delta: 'Webster 0091', tone: 'neutral' },
    { id: 'ar',   label: 'A/R (balance)', value: '$318K',  delta: 'DSO 34 d',     tone: 'neutral' },
    { id: 'ap',   label: 'A/P (balance)', value: '$108K',  delta: 'DPO 28 d',     tone: 'neutral' },
  ],
}

// --------------------------------------------------------------------
//  Monthly P&L — field name stays `cogs` internally to avoid a
//  ripple-rename; UI labels say "Direct Cost" throughout.
// --------------------------------------------------------------------
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const REV_DDE  = [2.1,2.3,2.5,2.4,2.7,2.9,3.0,3.2,3.1,3.3,3.4,3.8].map((x) => x * 1e6)
const COGS_DDE = [1.78,1.96,2.14,2.06,2.31,2.48,2.57,2.74,2.65,2.82,2.90,3.24].map((x) => x * 1e6)

function buildPnl(scale) {
  const revenue = REV_DDE.map((v) => Math.round(v * scale))
  const cogs    = COGS_DDE.map((v, i) => Math.round(v * scale * (revenue[i] / REV_DDE[i] / scale)))
  // Burden (labor taxes/benefits/WC) lives inside direct cost.  ~15%
  // of direct cost is a reasonable electrical-contractor blended load
  // (field labor ≈45% of DC × ~33% burden rate).
  const burden   = cogs.map((c) => Math.round(c * 0.15))
  const gp       = revenue.map((r, i) => r - cogs[i])
  const overhead = revenue.map((r) => Math.round(r * 0.09))
  const net      = gp.map((g, i) => g - overhead[i])
  const gpPct    = revenue.map((r, i) => +((gp[i] / r) * 100).toFixed(1))
  const priorRevenue = revenue.map((r) => Math.round(r * 0.93))
  const goalRevenue  = revenue.map((r) => Math.round(r * 1.05))
  return { labels: MONTHS, revenue, cogs, burden, gp, overhead, net, gpPct, priorRevenue, goalRevenue }
}

export const PNL = {
  COMBINED: buildPnl(1.45),
  DDE:      buildPnl(1.0),
  DCM:      buildPnl(0.29),
  SILK:     buildPnl(0.16),
}

// --------------------------------------------------------------------
//  Jobs
// --------------------------------------------------------------------
// Every job now carries:
//   type:          'contract' | 'service'
//   7 direct-cost buckets: labor, material, subs, equipment, bonds,
//                          permits, other  (sum ≈ directCost)
//   budgetLaborHrs / actualLaborHrs  (productivity inputs)
//   retainagePct  (contract terms, usually 10%)
//   retainageHeld (current $ retained by customer)
// Service jobs do NOT have a fixed contract $ — they bill T&M via WOs,
// so `contract` is null and `revenue` is billed-to-date.
//
// sub/lab/mat kept as back-compat aliases so the old code path still
// functions in case anything we missed reads them.  New code should
// use labor/material/subs.
function enrichJob(j) {
  const direct = j.labor + j.material + j.subs + j.equipment + j.bonds + j.permits + j.other
  const gp     = j.revenue - direct
  const gpPct  = j.revenue ? +((gp / j.revenue) * 100).toFixed(1) : 0
  const subPct = j.revenue ? Math.round((j.subs / j.revenue) * 100) : 0
  // Retainage-release schedule tied to % complete:
  //   <95%  : hold full retainage
  //    95%  : release 50% of retainage (less a 2% punchlist hold)
  //   100%  : release the remainder (final billing / closeout)
  // We express expected releases as future events; current retained is
  // whatever hasn't been released yet.
  const contractedRetention = Math.round((j.contract || j.revenue) * (j.retainagePct / 100))
  const releaseSchedule = j.type === 'service' ? [] : [
    { atPctCmp: 95,  releasePct: 50, note: '50% release at substantial completion, less 2% punchlist hold' },
    { atPctCmp: 100, releasePct: 48, note: 'Final release at closeout (minus warranty reserve)' },
  ]
  return {
    ...j,
    // back-compat field aliases
    lab: j.labor, mat: j.material, sub: j.subs,
    directCost: direct,
    gpDol: gp,
    gpPct,
    subPct,
    contractedRetention,
    releaseSchedule,
  }
}

const JOBS_DDE_RAW = [
  // Contract jobs
  { num:'2430', name:'West Haven HS',        type:'contract', contract:2800000, revenue:2743000,
    labor:1290000, material:420000, subs:520000, equipment:85000, bonds:42000, permits:18000, other:65000,
    budgetLaborHrs:24800, actualLaborHrs:24100, pctCmp:100, status:'Closed',
    retainagePct:10, retainageHeld: 55000, customer:'West Haven BOE' },

  { num:'2512', name:'Sage Park Apts C',     type:'contract', contract:1920000, revenue:1104000,
    labor: 520000, material:190000, subs:240000, equipment:52000, bonds:19000, permits: 8000, other:21000,
    budgetLaborHrs:12500, actualLaborHrs:10400, pctCmp:58,  status:'Active',
    retainagePct:10, retainageHeld:110400, customer:'Sage Park Development LLC' },

  { num:'2544', name:'Hartford Municipal',   type:'contract', contract:3500000, revenue:1225000,
    labor: 440000, material:160000, subs:290000, equipment:45000, bonds:26000, permits:18000, other:26000,
    budgetLaborHrs:29200, actualLaborHrs:10900, pctCmp:35,  status:'Active',
    retainagePct:10, retainageHeld:122500, customer:'State of Connecticut DAS' },

  { num:'2580', name:'Watertown Courthouse', type:'contract', contract: 960000, revenue: 812000,
    labor: 335000, material:120000, subs:178000, equipment:28000, bonds:12000, permits: 8000, other:22000,
    budgetLaborHrs: 7400, actualLaborHrs: 7700, pctCmp:85,  status:'Active',
    retainagePct:10, retainageHeld: 81200, customer:'City of Waterbury' },

  { num:'2601', name:'UConn Gampel Reno',    type:'contract', contract:1400000, revenue: 280000,
    labor:  92000, material: 26000, subs: 60000, equipment:10000, bonds:11000, permits: 6000, other:12000,
    budgetLaborHrs:11800, actualLaborHrs: 2200, pctCmp:20,  status:'Active',
    retainagePct:10, retainageHeld: 28000, customer:'UConn Health' },

  { num:'2622', name:'MGM Expansion – Ph1',  type:'contract', contract:2200000, revenue: 154000,
    labor:  52000, material: 12000, subs: 32000, equipment: 6000, bonds: 9000, permits: 4000, other: 8000,
    budgetLaborHrs:18400, actualLaborHrs: 1200, pctCmp:7,   status:'Hold',
    retainagePct:10, retainageHeld: 15400, customer:'MGM Tribal (Mohegan)' },

  // Service jobs — T&M, no fixed contract, billed per work order
  { num:'SV-DDE-01', name:'Yale NHH — Service Master', type:'service', contract:null, revenue:142000,
    labor:   78000, material:18000, subs: 12000, equipment: 4000, bonds:    0, permits: 1500, other: 3500,
    budgetLaborHrs: 1650, actualLaborHrs: 1480, pctCmp: 0, status:'Active',
    retainagePct: 0, retainageHeld: 0, customer:'Yale New Haven Health' },

  { num:'SV-DDE-02', name:'Pratt & Whitney — Plant Svc', type:'service', contract:null, revenue: 88000,
    labor:   46000, material: 9000, subs:  6000, equipment: 3000, bonds:    0, permits:   800, other: 2200,
    budgetLaborHrs:  980, actualLaborHrs:  920, pctCmp: 0, status:'Active',
    retainagePct: 0, retainageHeld: 0, customer:'Pratt & Whitney' },
]

const JOBS_DCM_RAW = [
  { num:'D101', name:'CCSU Parking Deck', type:'contract', contract:1200000, revenue:840000,
    labor:280000, material:120000, subs:180000, equipment:32000, bonds:15000, permits:10000, other:28000,
    budgetLaborHrs: 6400, actualLaborHrs: 4580, pctCmp:70, status:'Active',
    retainagePct:10, retainageHeld: 84000, customer:'State of Connecticut DAS' },

  { num:'D118', name:'New Haven Pier',    type:'contract', contract: 680000, revenue:476000,
    labor:155000, material: 64000, subs:108000, equipment:22000, bonds: 8000, permits: 5000, other:14000,
    budgetLaborHrs: 3400, actualLaborHrs: 3080, pctCmp:70, status:'Active',
    retainagePct:10, retainageHeld: 47600, customer:'City of New Haven' },

  { num:'D132', name:'Waterbury Garage',  type:'contract', contract: 950000, revenue:190000,
    labor: 58000, material: 20000, subs: 45000, equipment: 8000, bonds: 6000, permits: 4000, other: 9000,
    budgetLaborHrs: 5000, actualLaborHrs:  980, pctCmp:20, status:'Active',
    retainagePct:10, retainageHeld: 19000, customer:'City of Waterbury' },

  { num:'SV-DCM-01', name:'Mohegan Sun — Prop Svc', type:'service', contract:null, revenue: 62000,
    labor:  30000, material: 7000, subs:  4500, equipment: 2500, bonds:    0, permits:   500, other: 1500,
    budgetLaborHrs:  820, actualLaborHrs:  740, pctCmp: 0, status:'Active',
    retainagePct: 0, retainageHeld: 0, customer:'Mohegan Tribal Gaming' },
]

const JOBS_SILK_RAW = [
  { num:'S204', name:'Silk City Loft Rwr', type:'contract', contract:480000, revenue:432000,
    labor:148000, material: 50000, subs: 95000, equipment:14000, bonds: 5000, permits: 3500, other: 8500,
    budgetLaborHrs: 3000, actualLaborHrs: 2720, pctCmp:90, status:'Active',
    retainagePct:10, retainageHeld: 43200, customer:'Silk City Loft LLC' },

  { num:'S212', name:'Mansfield Retail',   type:'contract', contract:310000, revenue:217000,
    labor: 78000, material: 30000, subs: 46000, equipment: 7000, bonds: 2500, permits: 1500, other: 4500,
    budgetLaborHrs: 1700, actualLaborHrs: 1510, pctCmp:70, status:'Active',
    retainagePct:10, retainageHeld: 21700, customer:'Mansfield Retail Ventures' },

  { num:'SV-SILK-01', name:'Mystic Seaport — Ongoing Svc', type:'service', contract:null, revenue: 34000,
    labor: 18000, material: 3500, subs:  2200, equipment: 1200, bonds:    0, permits:   300, other:   800,
    budgetLaborHrs:  410, actualLaborHrs:  380, pctCmp: 0, status:'Active',
    retainagePct: 0, retainageHeld: 0, customer:'Mystic Seaport Museum' },
]

const JOBS_DDE  = JOBS_DDE_RAW.map(enrichJob)
const JOBS_DCM  = JOBS_DCM_RAW.map(enrichJob)
const JOBS_SILK = JOBS_SILK_RAW.map(enrichJob)

export const JOBS = {
  COMBINED: [...JOBS_DDE, ...JOBS_DCM, ...JOBS_SILK],
  DDE:  JOBS_DDE,
  DCM:  JOBS_DCM,
  SILK: JOBS_SILK,
}

// --------------------------------------------------------------------
//  Purchase Orders (contract jobs only)
// --------------------------------------------------------------------
// Outstanding = (amount - billed).  Outstanding is a *commitment* — an
// expected future direct cost that isn't yet on the books, so the
// Jobs P&L commits row adds it to actual direct cost for true-up.
export const PURCHASE_ORDERS = [
  // 2430 West Haven HS
  { po:'PO-10145', jobNum:'2430', vendor:'Graybar Electric',   desc:'Switchgear + feeders',   amount:142000, billed:142000, status:'closed' },
  { po:'PO-10146', jobNum:'2430', vendor:'ABC Supply',          desc:'Conduit + fittings',     amount: 68000, billed: 68000, status:'closed' },
  { po:'PO-10147', jobNum:'2430', vendor:'Crescent Electric',   desc:'Lighting fixtures',      amount: 54000, billed: 54000, status:'closed' },
  // 2512 Sage Park
  { po:'PO-10212', jobNum:'2512', vendor:'Graybar Electric',   desc:'Panel boards',            amount: 88000, billed: 52000, status:'open' },
  { po:'PO-10213', jobNum:'2512', vendor:'Gexpro',              desc:'Receptacles + devices',   amount: 34000, billed: 18000, status:'open' },
  { po:'PO-10214', jobNum:'2512', vendor:'E&R Scaffolding',     desc:'Lift rental — 8 wk',      amount: 22100, billed: 22100, status:'closed' },
  // 2544 Hartford Municipal
  { po:'PO-10344', jobNum:'2544', vendor:'Graybar Electric',   desc:'Gear + ATS',              amount:186000, billed: 48000, status:'open' },
  { po:'PO-10345', jobNum:'2544', vendor:'Crescent Electric',   desc:'Fire alarm devices',     amount: 42000, billed: 14000, status:'open' },
  // 2580 Watertown Courthouse
  { po:'PO-10580', jobNum:'2580', vendor:'Graybar Electric',   desc:'Feeders + switchgear',    amount: 96000, billed: 72000, status:'open' },
  { po:'PO-10581', jobNum:'2580', vendor:'Rexel',               desc:'Lighting',                amount: 38000, billed: 30000, status:'open' },
  // 2601 UConn Gampel
  { po:'PO-10601', jobNum:'2601', vendor:'Graybar Electric',   desc:'Initial material release',amount: 28000, billed: 10000, status:'open' },
  // D101 CCSU Parking Deck
  { po:'PO-10D01', jobNum:'D101', vendor:'Allied Concrete',     desc:'Precast + rebar',         amount:120000, billed: 82000, status:'open' },
  { po:'PO-10D02', jobNum:'D101', vendor:'Ring Power',          desc:'Crane rental',            amount: 38000, billed: 22000, status:'open' },
  // D118 New Haven Pier
  { po:'PO-10D18', jobNum:'D118', vendor:'Allied Concrete',     desc:'Pilings',                 amount: 74000, billed: 60000, status:'open' },
  // S204 Silk City Loft
  { po:'PO-10S04', jobNum:'S204', vendor:'Graybar Electric',   desc:'Panels + devices',        amount: 38000, billed: 34000, status:'open' },
]

// --------------------------------------------------------------------
//  Work Orders (service jobs only)
// --------------------------------------------------------------------
export const WORK_ORDERS = [
  { wo:'WO-8823', jobNum:'SV-DDE-01', customer:'Yale New Haven Health', opened:'2026-04-01', closed:'2026-04-02', description:'Breaker replacement — ICU feeder',         hours:28, rate:145, billed:12600, status:'invoiced' },
  { wo:'WO-8845', jobNum:'SV-DDE-01', customer:'Yale New Haven Health', opened:'2026-04-05', closed:'2026-04-05', description:'Emergency lighting audit + replacements',   hours:12, rate:145, billed: 5400, status:'invoiced' },
  { wo:'WO-8871', jobNum:'SV-DDE-01', customer:'Yale New Haven Health', opened:'2026-04-12', closed:null,         description:'UPS battery swap — OR suite',                hours:18, rate:145, billed:    0, status:'open' },
  { wo:'WO-8902', jobNum:'SV-DDE-02', customer:'Pratt & Whitney',       opened:'2026-03-28', closed:'2026-04-08', description:'Plant 3 — 480V feeder trace',                hours:44, rate:138, billed:18800, status:'invoiced' },
  { wo:'WO-8934', jobNum:'SV-DDE-02', customer:'Pratt & Whitney',       opened:'2026-04-10', closed:null,         description:'CNC controller install assist',              hours: 9, rate:138, billed:    0, status:'open' },
  { wo:'WO-9011', jobNum:'SV-DCM-01', customer:'Mohegan Tribal Gaming', opened:'2026-04-02', closed:'2026-04-04', description:'Garage gate controller replacement',         hours:24, rate:132, billed:11400, status:'invoiced' },
  { wo:'WO-9042', jobNum:'SV-DCM-01', customer:'Mohegan Tribal Gaming', opened:'2026-04-14', closed:null,         description:'Parking-lot bollard repairs',                hours:16, rate:132, billed:    0, status:'open' },
  { wo:'WO-9101', jobNum:'SV-SILK-01',customer:'Mystic Seaport Museum', opened:'2026-03-30', closed:'2026-04-06', description:'Dockside receptacles replacement',           hours:22, rate:128, billed: 9500, status:'invoiced' },
  { wo:'WO-9138', jobNum:'SV-SILK-01',customer:'Mystic Seaport Museum', opened:'2026-04-13', closed:null,         description:'Gift-shop HVAC control power',               hours:11, rate:128, billed:    0, status:'open' },
]

// Build a weekly S-curve for a given total — same logic as the mockup
export function buildWeekly(revTot, costTot, weeks = 16) {
  const labels = Array.from({ length: weeks }, (_, i) => 'wk ' + (i + 1))
  const sCurve = (i) => {
    const x = i / (weeks - 1)
    return 1 / (1 + Math.exp(-10 * (x - 0.5)))
  }
  const cum = labels.map((_, i) => sCurve(i))
  const totalArea = cum[cum.length - 1]
  const revenue = cum.map((c, i) => {
    const prev = i === 0 ? 0 : cum[i - 1]
    return Math.round(((c - prev) / totalArea) * revTot)
  })
  const cogs = cum.map((c, i) => {
    const prev = i === 0 ? 0 : cum[i - 1]
    return Math.round(((c - prev) / totalArea) * costTot)
  })
  const gp = revenue.map((r, i) => r - cogs[i])
  return { labels, revenue, cogs, gp }
}

// --------------------------------------------------------------------
//  Cashflow
// --------------------------------------------------------------------
export const CASHFLOW = {
  weeks:   Array.from({ length: 13 }, (_, i) => 'wk ' + (i + 1)),
  cash:    [1510,1498,1522,1535,1491,1450,1380,1420,1465,1510,1540,1562,1580].map((x) => x * 1000),
  inflow:  [210,180,240,260,190,155,140,210,230,245,225,210,200].map((x) => x * 1000),
  outflow: [198,195,217,248,235,195,212,170,185,200,195,188,182].map((x) => x * 1000),
}

// --------------------------------------------------------------------
//  A/R + A/P
// --------------------------------------------------------------------
// A/R invoices gained:
//   type:      'AR' (contract) | 'SR' (service)
//   customer:  billing customer name (for aging roll-up)
// A/P unchanged.
//
// Dates are referenced vs today=2026-04-21 so ageDays lines up.
export const AR_INVOICES = [
  // Contract (AR)
  { invoice:'INV-9812', type:'AR', customer:'West Haven BOE',            job:'2430 West Haven HS',       invDate:'2026-01-18', dueDate:'2026-02-17', total:214200, balance: 38200, ageDays: 63 },
  { invoice:'INV-9766', type:'AR', customer:'Sage Park Development LLC', job:'2512 Sage Park Apts C',    invDate:'2025-12-28', dueDate:'2026-01-27', total: 73500, balance: 21400, ageDays: 84 },
  { invoice:'INV-9933', type:'AR', customer:'City of Waterbury',         job:'2580 Watertown Courthouse',invDate:'2026-04-05', dueDate:'2026-05-05', total: 84100, balance: 84100, ageDays: 0  },
  { invoice:'INV-9951', type:'AR', customer:'State of Connecticut DAS',  job:'2544 Hartford Municipal',  invDate:'2026-03-22', dueDate:'2026-04-21', total:128000, balance: 64000, ageDays: 0  },
  { invoice:'INV-9977', type:'AR', customer:'UConn Health',              job:'2601 UConn Gampel Reno',   invDate:'2026-04-10', dueDate:'2026-05-10', total: 45000, balance: 45000, ageDays: 0  },
  { invoice:'INV-9989', type:'AR', customer:'City of New Haven',         job:'D118 New Haven Pier',      invDate:'2026-03-11', dueDate:'2026-04-10', total: 96000, balance: 96000, ageDays:11  },
  { invoice:'INV-9992', type:'AR', customer:'State of Connecticut DAS',  job:'D101 CCSU Parking Deck',   invDate:'2026-03-15', dueDate:'2026-04-14', total:120000, balance: 48000, ageDays: 7  },
  { invoice:'INV-9816', type:'AR', customer:'West Haven BOE',            job:'2430 West Haven HS',       invDate:'2025-11-14', dueDate:'2025-12-14', total: 62000, balance:  9400, ageDays:128 },
  { invoice:'INV-9820', type:'AR', customer:'Sage Park Development LLC', job:'2512 Sage Park Apts C',    invDate:'2025-10-02', dueDate:'2025-11-01', total: 48000, balance: 14200, ageDays:171 },

  // Service (SR)
  { invoice:'SR-2144',  type:'SR', customer:'Yale New Haven Health',     job:'SV-DDE-01 Service Master', invDate:'2026-03-28', dueDate:'2026-04-27', total: 18000, balance: 18000, ageDays: 0  },
  { invoice:'SR-2151',  type:'SR', customer:'Pratt & Whitney',           job:'SV-DDE-02 Plant Svc',      invDate:'2026-04-08', dueDate:'2026-05-08', total: 18800, balance: 18800, ageDays: 0  },
  { invoice:'SR-2132',  type:'SR', customer:'Mohegan Tribal Gaming',     job:'SV-DCM-01 Prop Svc',       invDate:'2026-03-05', dueDate:'2026-04-04', total: 11400, balance: 11400, ageDays:17  },
  { invoice:'SR-2089',  type:'SR', customer:'Yale New Haven Health',     job:'SV-DDE-01 Service Master', invDate:'2026-01-30', dueDate:'2026-03-01', total: 22400, balance:  9600, ageDays:51  },
  { invoice:'SR-2068',  type:'SR', customer:'Mystic Seaport Museum',     job:'SV-SILK-01 Ongoing Svc',   invDate:'2026-01-12', dueDate:'2026-02-11', total:  9500, balance:  9500, ageDays:69  },
  { invoice:'SR-1994',  type:'SR', customer:'Pratt & Whitney',           job:'SV-DDE-02 Plant Svc',      invDate:'2025-11-20', dueDate:'2025-12-20', total: 14200, balance:  2100, ageDays:122 },
]

export const AP_INVOICES = [
  { vendor:'Graybar Electric', invoice:'SI-44821', job:'Watertown Courthouse',dueDate:'2026-05-04', total:38200, balance:38200, ageDays:2 },
  { vendor:'ABC Supply',       invoice:'SI-11092', job:'Sage Park Apts C',    dueDate:'2026-05-08', total:61400, balance:61400, ageDays:6 },
  { vendor:'Local 90 Fringes', invoice:'DUE-APR',  job:'(company)',           dueDate:'2026-04-30', total:48000, balance:48000, ageDays:0 },
  { vendor:'E&R Scaffolding',  invoice:'SI-2199',  job:'Sage Park Apts C',    dueDate:'2026-03-20', total:22100, balance:22100, ageDays:31 },
  { vendor:'Gexpro',           invoice:'SI-66712', job:'Hartford Municipal',  dueDate:'2026-04-12', total:18400, balance: 8200, ageDays:8  },
  { vendor:'Crescent Electric',invoice:'SI-30214', job:'West Haven HS',       dueDate:'2026-01-28', total:14200, balance: 2100, ageDays:82 },
]

// --------------------------------------------------------------------
//  Payment history — largest customers
// --------------------------------------------------------------------
export const PAYMENT_HISTORY = [
  { name:'Yale New Haven Health',     active:true,  paid:1_842_000, trend:'down', deltas:[28,32,29,31,27,35,30,33,29,30,34,28,31,29,32,30,27] },
  { name:'State of Connecticut DAS',  active:true,  paid:1_405_000, trend:'flat', deltas:[44,48,46,51,42,45,49,47,44,46,50,45,48,43,47,44,49,46] },
  { name:'Hartford HealthCare',       active:true,  paid:  988_000, trend:'up',   deltas:[22,24,21,26,23,25,22,24,23,22,25,24,120,27] },
  { name:'Sage Park Development LLC', active:true,  paid:  742_000, trend:'down', deltas:[58,62,71,68,74,66,79,70,72,68,81,65,69,73] },
  { name:'West Haven BOE',            active:true,  paid:  681_000, trend:'flat', deltas:[36,38,34,40,37,39,35,38,37,36,41,38] },
  { name:'City of Waterbury',         active:true,  paid:  612_000, trend:'flat', deltas:[42,45,41,46,44,48,43,47,44,42,46,45,43,47] },
  { name:'UConn Health',              active:true,  paid:  528_000, trend:'up',   deltas:[30,32,28,34,31,29,33,30,31,29,32,30] },
  { name:'Watertown Housing Auth.',   active:true,  paid:  471_000, trend:'down', deltas:[49,52,54,58,51,55,57,50,53,56,59,52,154] },
  { name:'MGM Tribal (Mohegan)',      active:true,  paid:  402_000, trend:'flat', deltas:[25,27,24,28,26,23,27,25,26,24,28,26] },
  { name:'Mystic Seaport Museum',     active:true,  paid:  318_000, trend:'up',   deltas:[34,36,33,38,35,37,34,36,35,37,34,36] },
  { name:'Pratt & Whitney',           active:false, paid:  285_000, trend:'flat', deltas:[31,33,30,35,32,34,31,33,32,34,31,33] },
  { name:'CT DOT (legacy contract)',  active:false, paid:  261_000, trend:'down', deltas:[62,68,71,74,65,69,72,67,70,66,73,68] },
  { name:'Foxwoods Resort',           active:false, paid:  203_000, trend:'flat', deltas:[38,41,37,43,39,42,38,41,40,39,42,38] },
]

// --------------------------------------------------------------------
//  KPI spark lines
// --------------------------------------------------------------------
export const KPI_SPARKS = [
  { id:'kpiSafety',    label:'Safety incidents',  value:'0 (rolling 12)',   data:[2,1,0,0,1,0,0,1,0,0,0,0], color:'#5EE88A' },
  { id:'kpiWinRate',   label:'Bid win rate',      value:'34%',              data:[22,24,28,30,31,29,32,34,33,35,34,34], color:'#6FA8FF' },
  { id:'kpiCsat',      label:'Customer sat (CSAT)',value:'4.6 / 5',         data:[4.4,4.5,4.5,4.6,4.5,4.6,4.6,4.7,4.6,4.5,4.6,4.6], color:'#6FA8FF' },
  { id:'kpiHeadcount', label:'Headcount',         value:'127 field + office',data:[112,115,118,120,122,123,125,124,126,126,127,127], color:'#FFFFFF' },
  { id:'kpiCoYield',   label:'Change-order yield',value:'6.1% of contract', data:[9.2,8.5,7.9,7.5,7.1,6.8,6.4,6.2,6.0,6.1,6.2,6.1], color:'#F0C040' },
]

// --------------------------------------------------------------------
//  Payroll — weekly register lines (demo snapshot)
// --------------------------------------------------------------------
// Each row is "one employee on one job for one pay period" — the grain
// the timecard system hands off to payroll.  Hours fields are straight
// numbers; computePayroll() below derives wages + the full burden stack.
//
// Burden-rate assumptions used by computePayroll():
//   FICA         7.65%   of wages         (SS + Medicare employer half)
//   FUTA         0.6%    of wages         (simple, uncapped for demo)
//   SUTA         2.7%    of wages         (CT blended)
//   Workers Comp 8.5%    of wages         (electrical / mech blended)
//   GL Liability 1.0%    of wages         (commercial GL pass-through)
//   Retirement   3.0%    of wages         (employer match)
//   Health       $185    flat per pay period / employee

export const PAYROLL_LINES = [
  // Week ending 2026-04-10
  { week:'2026-04-10', emp:'Carlos Rodriguez', trade:'JW',    job:'2430', jobName:'West Haven HS',        regHrs:40, otHrs: 8, sickHrs:0, vacHrs:0, holHrs:0, perDiem:120, rate:52.00 },
  { week:'2026-04-10', emp:'Tyler O\u2019Brien',  trade:'JW',    job:'2430', jobName:'West Haven HS',        regHrs:40, otHrs: 4, sickHrs:0, vacHrs:0, holHrs:0, perDiem:120, rate:52.00 },
  { week:'2026-04-10', emp:'Miguel Fuentes',   trade:'AP4',   job:'2430', jobName:'West Haven HS',        regHrs:40, otHrs: 2, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:36.50 },
  { week:'2026-04-10', emp:'Jim Kowalski',     trade:'Fore',  job:'2512', jobName:'Sage Park Apts C',     regHrs:40, otHrs: 6, sickHrs:0, vacHrs:0, holHrs:0, perDiem:100, rate:58.00 },
  { week:'2026-04-10', emp:'Andre Chen',       trade:'JW',    job:'2512', jobName:'Sage Park Apts C',     regHrs:36, otHrs: 0, sickHrs:4, vacHrs:0, holHrs:0, perDiem:  0, rate:52.00 },
  { week:'2026-04-10', emp:'Luis Ortega',      trade:'AP3',   job:'2512', jobName:'Sage Park Apts C',     regHrs:40, otHrs: 2, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:32.00 },
  { week:'2026-04-10', emp:'Nate Hollis',      trade:'JW',    job:'2544', jobName:'Hartford Municipal',   regHrs:32, otHrs: 0, sickHrs:0, vacHrs:8, holHrs:0, perDiem:  0, rate:52.00 },
  { week:'2026-04-10', emp:'Kevin Doyle',      trade:'Fore',  job:'2544', jobName:'Hartford Municipal',   regHrs:40, otHrs: 4, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:58.00 },
  { week:'2026-04-10', emp:'Rashid Ali',       trade:'JW',    job:'2580', jobName:'Watertown Courthouse', regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem: 90, rate:52.00 },
  { week:'2026-04-10', emp:'Brian Shea',       trade:'AP2',   job:'2580', jobName:'Watertown Courthouse', regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem: 90, rate:28.50 },
  { week:'2026-04-10', emp:'Eric Pires',       trade:'PM',    job:'D101', jobName:'CCSU Parking Deck',    regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:62.00 },
  { week:'2026-04-10', emp:'Marco Delgado',    trade:'JW',    job:'D101', jobName:'CCSU Parking Deck',    regHrs:40, otHrs: 2, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:52.00 },

  // Week ending 2026-04-17
  { week:'2026-04-17', emp:'Carlos Rodriguez', trade:'JW',    job:'2430', jobName:'West Haven HS',        regHrs:40, otHrs: 6, sickHrs:0, vacHrs:0, holHrs:0, perDiem:120, rate:52.00 },
  { week:'2026-04-17', emp:'Tyler O\u2019Brien',  trade:'JW',    job:'2512', jobName:'Sage Park Apts C',     regHrs:38, otHrs: 2, sickHrs:2, vacHrs:0, holHrs:0, perDiem:100, rate:52.00 },
  { week:'2026-04-17', emp:'Miguel Fuentes',   trade:'AP4',   job:'2430', jobName:'West Haven HS',        regHrs:40, otHrs: 4, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:36.50 },
  { week:'2026-04-17', emp:'Jim Kowalski',     trade:'Fore',  job:'2512', jobName:'Sage Park Apts C',     regHrs:40, otHrs: 2, sickHrs:0, vacHrs:0, holHrs:0, perDiem:100, rate:58.00 },
  { week:'2026-04-17', emp:'Andre Chen',       trade:'JW',    job:'2512', jobName:'Sage Park Apts C',     regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:52.00 },
  { week:'2026-04-17', emp:'Luis Ortega',      trade:'AP3',   job:'2544', jobName:'Hartford Municipal',   regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:32.00 },
  { week:'2026-04-17', emp:'Nate Hollis',      trade:'JW',    job:'2544', jobName:'Hartford Municipal',   regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:52.00 },
  { week:'2026-04-17', emp:'Kevin Doyle',      trade:'Fore',  job:'2544', jobName:'Hartford Municipal',   regHrs:40, otHrs: 8, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:58.00 },
  { week:'2026-04-17', emp:'Rashid Ali',       trade:'JW',    job:'2580', jobName:'Watertown Courthouse', regHrs:40, otHrs: 4, sickHrs:0, vacHrs:0, holHrs:0, perDiem: 90, rate:52.00 },
  { week:'2026-04-17', emp:'Brian Shea',       trade:'AP2',   job:'2601', jobName:'UConn Gampel Reno',    regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:8, perDiem:  0, rate:28.50 },
  { week:'2026-04-17', emp:'Eric Pires',       trade:'PM',    job:'D101', jobName:'CCSU Parking Deck',    regHrs:40, otHrs: 0, sickHrs:0, vacHrs:0, holHrs:0, perDiem:  0, rate:62.00 },
  { week:'2026-04-17', emp:'Marco Delgado',    trade:'JW',    job:'D118', jobName:'New Haven Pier',       regHrs:40, otHrs: 6, sickHrs:0, vacHrs:0, holHrs:0, perDiem: 80, rate:52.00 },
]

export function computePayroll(line) {
  const regPay = line.regHrs  * line.rate
  const otPay  = line.otHrs   * line.rate * 1.5
  const sickPay = line.sickHrs * line.rate
  const vacPay  = line.vacHrs  * line.rate
  const holPay  = line.holHrs  * line.rate
  const wages  = regPay + otPay + sickPay + vacPay + holPay
  const fica       = wages * 0.0765
  const futa       = wages * 0.006
  const suta       = wages * 0.027
  const wc         = wages * 0.085
  const liability  = wages * 0.010
  const retirement = wages * 0.030
  const health     = 185
  const totalBurden = fica + futa + suta + wc + liability + retirement + health
  const totalCost   = wages + totalBurden + line.perDiem
  return {
    ...line,
    regPay, otPay, sickPay, vacPay, holPay, wages,
    fica, futa, suta, wc, liability, retirement, health,
    totalBurden, totalCost,
  }
}

// --------------------------------------------------------------------
//  Productivity helpers
// --------------------------------------------------------------------
// Earned-value style productivity for a single job:
//   earnedHrs = budgetLaborHrs × pctCmp / 100
//   productivity = earnedHrs / actualLaborHrs
// 1.00 = on plan.  > 1 = ahead (fewer actual hours than earned).
// < 1 = behind (actual hours exceed what % complete would justify).
// Excludes service jobs (no meaningful %cmp on T&M work).
export function jobProductivity(j) {
  if (!j || j.type === 'service' || !j.actualLaborHrs) {
    return { earnedHrs: 0, productivity: null }
  }
  const earnedHrs = j.budgetLaborHrs * (j.pctCmp / 100)
  return {
    earnedHrs,
    productivity: +(earnedHrs / j.actualLaborHrs).toFixed(2),
    revenuePerHour: +(j.revenue / j.actualLaborHrs).toFixed(2),
  }
}

// Company-wide productivity = total earned hrs / total actual hrs
// across contract jobs.  Same math as jobProductivity, just rolled up.
export function companyProductivity(jobs) {
  const contract = jobs.filter((j) => j.type === 'contract' && j.actualLaborHrs > 0)
  const earnedHrs = contract.reduce((s, j) => s + j.budgetLaborHrs * (j.pctCmp / 100), 0)
  const actualHrs = contract.reduce((s, j) => s + j.actualLaborHrs, 0)
  const revenue   = contract.reduce((s, j) => s + j.revenue, 0)
  const productivity = actualHrs ? +(earnedHrs / actualHrs).toFixed(2) : null
  return {
    earnedHrs: Math.round(earnedHrs),
    actualHrs,
    productivity,
    revenuePerHour: actualHrs ? +(revenue / actualHrs).toFixed(2) : null,
    jobCount: contract.length,
  }
}

// --------------------------------------------------------------------
//  A/R email report settings (default; persisted via localStorage on
//  the settings panel, swap to an ops_settings row when Supabase wires).
// --------------------------------------------------------------------
export const AR_EMAIL_DEFAULTS = {
  dayOfWeek: 5, // 0=Sun … 5=Fri … 6=Sat
  sendHour:  8, // 8 am local
  recipients: [
    { name: 'Scott Williams',    email: 'scott@dubaldo.com' },
    { name: 'Dan Mulligan',      email: 'dan@dubaldo.com' },
    { name: 'Paulette Anderson', email: 'paulette@dubaldo.com' },
    { name: 'Don DuBaldo',       email: 'don@dubaldo.com' },
  ],
  subject: 'DDE — Weekly A/R aging (contract + service)',
}

// --------------------------------------------------------------------
//  Permissions — synced users
// --------------------------------------------------------------------
export const PERM_USERS = [
  { sparksId:'sp_3841', name:'Angelina DuBaldo', email:'angelina@dubaldo.com', role:'admin',   pcs:['DDE','DCM','SILK'], hiddenTabs:[], hiddenFields:[], jobAccess:'all' },
  { sparksId:'sp_3901', name:'Paulette Anderson', email:'paulette@dubaldo.com', role:'finance', pcs:['DDE','DCM','SILK'], hiddenTabs:[], hiddenFields:[], jobAccess:'all' },
  { sparksId:'sp_4012', name:'Dan Mulligan',      email:'dan@dubaldo.com',      role:'pm',      pcs:['DDE'],              hiddenTabs:['ar','ap'], hiddenFields:[], jobAccess:'assigned' },
  { sparksId:'sp_4298', name:'Paul Diliberto',    email:'paul@dubaldo.com',     role:'manager', pcs:['DCM'],              hiddenTabs:[], hiddenFields:[], jobAccess:'all' },
  { sparksId:'sp_4177', name:'Scott Williams',    email:'scott@dubaldo.com',    role:'viewer',  pcs:['DDE'],              hiddenTabs:['ar','ap','perms'], hiddenFields:['revenue_dollar','gp_dollar','contract_amount','bank_balance'], jobAccess:'whitelist', jobAccessList:['2430','2512'] },
]
