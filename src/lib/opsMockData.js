// Mock fixtures ported verbatim from the dashboard scaffold.
// Every number came out of the HTML mockup so the ops pages render the
// same charts/tables you've been looking at.  When Supabase-backed
// `ops.*` views are live, delete this file and have useOpsData() query
// the views instead.

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
//  Monthly P&L
// --------------------------------------------------------------------
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const REV_DDE  = [2.1,2.3,2.5,2.4,2.7,2.9,3.0,3.2,3.1,3.3,3.4,3.8].map((x) => x * 1e6)
const COGS_DDE = [1.78,1.96,2.14,2.06,2.31,2.48,2.57,2.74,2.65,2.82,2.90,3.24].map((x) => x * 1e6)

function buildPnl(scale) {
  const revenue = REV_DDE.map((v) => Math.round(v * scale))
  const cogs    = COGS_DDE.map((v, i) => Math.round(v * scale * (revenue[i] / REV_DDE[i] / scale)))
  const gp       = revenue.map((r, i) => r - cogs[i])
  const overhead = revenue.map((r) => Math.round(r * 0.09))
  const net      = gp.map((g, i) => g - overhead[i])
  const gpPct    = revenue.map((r, i) => +((gp[i] / r) * 100).toFixed(1))
  const priorRevenue = revenue.map((r) => Math.round(r * 0.93))
  const goalRevenue  = revenue.map((r) => Math.round(r * 1.05))
  return { labels: MONTHS, revenue, cogs, gp, overhead, net, gpPct, priorRevenue, goalRevenue }
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
const JOBS_DDE = [
  { num:'2430', name:'West Haven HS',       contract:2800000, revenue:2743000, lab:1290000, mat:480000, sub:670000, gpPct:14, subPct:28, pctCmp:100, status:'Closed', gpDol:0 },
  { num:'2512', name:'Sage Park Apts C',    contract:1920000, revenue:1104000, lab: 520000, mat:220000, sub:310000, gpPct:12, subPct:33, pctCmp:58,  status:'Active', gpDol:0 },
  { num:'2544', name:'Hartford Municipal',  contract:3500000, revenue:1225000, lab: 440000, mat:180000, sub:380000, gpPct:18, subPct:31, pctCmp:35,  status:'Active', gpDol:0 },
  { num:'2580', name:'Watertown Courthouse',contract: 960000, revenue: 812000, lab: 335000, mat:128000, sub:228000, gpPct: 9, subPct:34, pctCmp:85,  status:'Active', gpDol:0 },
  { num:'2601', name:'UConn Gampel Reno',   contract:1400000, revenue: 280000, lab:  92000, mat: 30000, sub: 78000, gpPct:21, subPct:28, pctCmp:20,  status:'Active', gpDol:0 },
  { num:'2622', name:'MGM Expansion – Ph1', contract:2200000, revenue: 154000, lab:  52000, mat: 14000, sub: 42000, gpPct:23, subPct:27, pctCmp:7,   status:'Hold',   gpDol:0 },
]
JOBS_DDE.forEach((j) => { j.gpDol = Math.round(j.revenue * j.gpPct / 100) })

const JOBS_DCM = [
  { num:'D101', name:'CCSU Parking Deck', contract:1200000, revenue:840000, lab:280000, mat:160000, sub:260000, gpPct:17, subPct:31, pctCmp:70, status:'Active', gpDol:0 },
  { num:'D118', name:'New Haven Pier',    contract: 680000, revenue:476000, lab:155000, mat: 82000, sub:150000, gpPct:19, subPct:32, pctCmp:70, status:'Active', gpDol:0 },
  { num:'D132', name:'Waterbury Garage',  contract: 950000, revenue:190000, lab: 58000, mat: 26000, sub: 62000, gpPct:23, subPct:33, pctCmp:20, status:'Active', gpDol:0 },
]
JOBS_DCM.forEach((j) => { j.gpDol = Math.round(j.revenue * j.gpPct / 100) })

const JOBS_SILK = [
  { num:'S204', name:'Silk City Loft Rwr', contract:480000, revenue:432000, lab:148000, mat:64000, sub:130000, gpPct:21, subPct:30, pctCmp:90, status:'Active', gpDol:0 },
  { num:'S212', name:'Mansfield Retail',   contract:310000, revenue:217000, lab: 78000, mat:38000, sub: 60000, gpPct:19, subPct:28, pctCmp:70, status:'Active', gpDol:0 },
]
JOBS_SILK.forEach((j) => { j.gpDol = Math.round(j.revenue * j.gpPct / 100) })

export const JOBS = {
  COMBINED: [...JOBS_DDE, ...JOBS_DCM, ...JOBS_SILK],
  DDE:  JOBS_DDE,
  DCM:  JOBS_DCM,
  SILK: JOBS_SILK,
}

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
export const AR_INVOICES = [
  { invoice:'INV-9812', job:'West Haven HS',       invDate:'2026-01-18', dueDate:'2026-02-17', total:214200, balance:38200, ageDays:92 },
  { invoice:'INV-9766', job:'Sage Park Apts C',    invDate:'2025-12-28', dueDate:'2026-01-27', total: 73500, balance:21400, ageDays:113 },
  { invoice:'INV-9933', job:'Watertown Courthouse',invDate:'2026-04-05', dueDate:'2026-05-05', total: 84100, balance:84100, ageDays:15 },
  { invoice:'INV-9951', job:'Hartford Municipal',  invDate:'2026-03-22', dueDate:'2026-04-21', total:128000, balance:64000, ageDays:29 },
  { invoice:'INV-9977', job:'UConn Gampel Reno',   invDate:'2026-04-10', dueDate:'2026-05-10', total: 45000, balance:45000, ageDays:10 },
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
//  Permissions — synced users
// --------------------------------------------------------------------
export const PERM_USERS = [
  { sparksId:'sp_3841', name:'Angelina DuBaldo', email:'angelina@dubaldo.com', role:'admin',   pcs:['DDE','DCM','SILK'], hiddenTabs:[], hiddenFields:[], jobAccess:'all' },
  { sparksId:'sp_3901', name:'Paulette Anderson', email:'paulette@dubaldo.com', role:'finance', pcs:['DDE','DCM','SILK'], hiddenTabs:[], hiddenFields:[], jobAccess:'all' },
  { sparksId:'sp_4012', name:'Dan Mulligan',      email:'dan@dubaldo.com',      role:'pm',      pcs:['DDE'],              hiddenTabs:['ar','ap'], hiddenFields:[], jobAccess:'assigned' },
  { sparksId:'sp_4298', name:'Paul Diliberto',    email:'paul@dubaldo.com',     role:'manager', pcs:['DCM'],              hiddenTabs:[], hiddenFields:[], jobAccess:'all' },
  { sparksId:'sp_4177', name:'Scott Williams',    email:'scott@dubaldo.com',    role:'viewer',  pcs:['DDE'],              hiddenTabs:['ar','ap','perms'], hiddenFields:['revenue_dollar','gp_dollar','contract_amount','bank_balance'], jobAccess:'whitelist', jobAccessList:['2430','2512'] },
]
