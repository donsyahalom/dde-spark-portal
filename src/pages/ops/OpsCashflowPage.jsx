import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmtK, fmt } from '../../lib/opsFormat'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { supabase } from '../../lib/supabase'
import { useState, useEffect } from 'react'

// Draws a red background band over the future portion of the chart
// (everything from this week's index onward).
const futureBandPlugin = {
  id: 'futureBand',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts.fromIdx && opts.fromIdx !== 0) return
    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart
    const n = chart.data.labels.length
    if (opts.fromIdx >= n) return

    const xLeft  = x.getPixelForValue(opts.fromIdx)
    const xRight = x.getPixelForValue(n - 1)
    const tickW  = n > 1 ? x.getPixelForValue(1) - x.getPixelForValue(0) : 20
    const left   = xLeft  - tickW / 2
    const right  = xRight + tickW / 2

    ctx.save()
    ctx.fillStyle = 'rgba(220, 70, 70, 0.10)'
    ctx.fillRect(left, top, right - left, bottom - top)
    ctx.strokeStyle = 'rgba(220, 70, 70, 0.45)'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.stroke()
    ctx.restore()
  },
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="ops-text-dim ops-small">{label}</span>
      <span style={{ fontWeight: strong ? 700 : 500, color: strong ? 'var(--gold)' : 'var(--white)' }}>{value}</span>
    </div>
  )
}

export default function OpsCashflowPage() {
  const { cashflow, arInvoices, apInvoices, loading: _opsLoading } = useOpsData()

  // Live bank balances from sage.gl_accounts
  const [banks, setBanks]   = useState([])
  const [banksLoading, setBanksLoading] = useState(true)

  useEffect(() => {
    supabase.schema('sage').from('gl_accounts')
      .select('short_name,long_name,current_balance')
      .eq('account_type', 1)
      .eq('is_active', true)
      .order('recnum')
      .then(({ data }) => {
        setBanks(data || [])
        setBanksLoading(false)
      })
  }, [])

  // AR aging buckets from live arInvoices
  const arBuckets = useMemo(() => {
    const today = new Date()
    const addDays = (d, n) => new Date(+d + n * 86400000)
    const b = { d14: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
    for (const inv of arInvoices) {
      const bal = inv.balance || 0
      if (bal <= 0) continue
      const due = inv.dueDate ? new Date(inv.dueDate) : null
      if (!due) { b.d60 += bal; continue }
      const days = Math.round((due - today) / 86400000)
      if (days >= 0 && days <= 14)       b.d14  += bal
      else if (days > 14 && days <= 30)  b.d30  += bal
      else if (days > 30 && days <= 60)  b.d60  += bal
      else if (days > 60 && days <= 90)  b.d90  += bal
      else if (days > 90)                b.d90p += bal
      else                               b.d14  += bal  // overdue, expect soon
    }
    return b
  }, [arInvoices])

  // AP aging buckets from live apInvoices
  const apBuckets = useMemo(() => {
    const today = new Date()
    const b = { d14: 0, d30: 0, d60: 0, d90: 0 }
    for (const inv of apInvoices) {
      const bal = inv.balance || 0
      if (bal <= 0) continue
      const due = inv.dueDate ? new Date(inv.dueDate) : null
      if (!due) { b.d30 += bal; continue }
      const days = Math.round((due - today) / 86400000)
      if (days >= 0 && days <= 14)       b.d14 += bal
      else if (days > 14 && days <= 30)  b.d30 += bal
      else if (days > 30 && days <= 60)  b.d60 += bal
      else                               b.d90 += bal
    }
    return b
  }, [apInvoices])

  const totalCash = useMemo(() => banks.reduce((s, b) => s + (b.current_balance || 0), 0), [banks])

  // Find the index of the current week in the labels array.
  // cashflow_weekly view uses 'Mon DD' labels (e.g. 'May 05').
  // The view orders past→future with current week included,
  // so future starts at the first label AFTER today's week.
  const futureFromIdx = useMemo(() => {
    if (!cashflow.weeks?.length) return null
    const todayWeekLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
      .replace(',', '')
    // Find the label closest to today — the view's label is the week's Monday
    // formatted as 'Mon DD'. Walk from start and mark where future begins.
    // Simpler: the view always has 26 past + current + 13 future = 40 rows.
    // Current week is at index 26 (0-based). Future starts at index 27.
    return 27
  }, [cashflow.weeks])

  const chartData = {
    labels: cashflow.weeks,
    datasets: [
      { label: 'Cash',    data: cashflow.cash,    borderColor: PALETTE.blue,  backgroundColor: 'transparent', tension: 0.3, borderWidth: 2.5 },
      { label: 'Inflow',  data: cashflow.inflow,  borderColor: PALETTE.green, backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5 },
      { label: 'Outflow', data: cashflow.outflow, borderColor: PALETTE.red,   backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5 },
    ],
  }

  const chartOpts = useMemo(() => ({
    ...moneyLineOpts(),
    plugins: {
      ...moneyLineOpts().plugins,
      futureBand: { fromIdx: futureFromIdx },
      legend: { display: true, position: 'top', align: 'end',
        labels: { color: 'rgba(255,255,255,0.85)', font: { size: 11 } } },
    },
  }), [futureFromIdx])

  if (_opsLoading) return <div style={{ padding: '40px 20px', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', textAlign: 'center' }}>Loading data…</div>

  return (
    <div>
      {/* Bank balances */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        {banksLoading ? (
          <OpsSectionCard title="Bank accounts">
            <div className="ops-small ops-text-dim">Loading…</div>
          </OpsSectionCard>
        ) : (
          <>
            {banks.map((b) => (
              <OpsSectionCard key={b.short_name} title={b.long_name || b.short_name}>
                <div className="ops-kpi-value" style={{ fontSize: '1.4rem' }}>{fmt(b.current_balance)}</div>
              </OpsSectionCard>
            ))}
            {banks.length > 1 && (
              <OpsSectionCard title="Total cash" style={{ background: 'rgba(240,192,64,0.06)' }}>
                <div className="ops-kpi-value" style={{ fontSize: '1.4rem', color: 'var(--gold)' }}>{fmt(totalCash)}</div>
                <div className="ops-small ops-text-dim">{banks.length} accounts</div>
              </OpsSectionCard>
            )}
          </>
        )}
      </div>

      {/* Cashflow chart */}
      {cashflow.weeks?.length > 0 && (
        <OpsSectionCard
          title="Weekly cash position"
          subtitle="Historical data left of red line · forecast (projected) right of red line. Based on GL transactions, AR receipts, and AP payments."
          right={
            <span style={{ fontSize: '0.78rem', padding: '3px 12px', borderRadius: 6,
              background: 'rgba(220,70,70,0.12)', border: '1px solid rgba(220,70,70,0.4)',
              color: 'rgba(255,140,140,0.9)' }}>
              ⚠ Future — projected
            </span>
          }
        >
          <OpsChartBox size="lg">
            <Line data={chartData} options={chartOpts} plugins={[futureBandPlugin]} />
          </OpsChartBox>
        </OpsSectionCard>
      )}

      {/* AR / AP buckets */}
      <div className="ops-grid-2">
        <OpsSectionCard title="Expected inflows" subtitle="Open A/R invoices bucketed by due date">
          <Row label="Due within 14 days"   value={fmtK(arBuckets.d14)} />
          <Row label="Due 15 – 30 days"     value={fmtK(arBuckets.d30)} />
          <Row label="Due 31 – 60 days"     value={fmtK(arBuckets.d60)} />
          <Row label="Due 61 – 90 days"     value={fmtK(arBuckets.d90)}  strong />
          <Row label="Due > 90 days"        value={fmtK(arBuckets.d90p)} strong />
          <Row label="Total open A/R"
            value={fmtK(arBuckets.d14 + arBuckets.d30 + arBuckets.d60 + arBuckets.d90 + arBuckets.d90p)}
            strong />
        </OpsSectionCard>
        <OpsSectionCard title="Expected outflows" subtitle="Open A/P invoices bucketed by due date">
          <Row label="Due within 14 days"   value={fmtK(apBuckets.d14)} />
          <Row label="Due 15 – 30 days"     value={fmtK(apBuckets.d30)} />
          <Row label="Due 31 – 60 days"     value={fmtK(apBuckets.d60)} />
          <Row label="Due > 60 days"        value={fmtK(apBuckets.d90)}  strong />
          <Row label="Total open A/P"
            value={fmtK(apBuckets.d14 + apBuckets.d30 + apBuckets.d60 + apBuckets.d90)}
            strong />
        </OpsSectionCard>
      </div>
    </div>
  )
}
