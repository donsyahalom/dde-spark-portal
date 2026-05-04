import { useMemo, useState } from 'react'
import { Chart } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { useOpsViewState } from '../../context/OpsViewStateContext'
import { fmt, fmtK, pct } from '../../lib/opsFormat'
import { PALETTE } from '../../lib/opsChartOpts'

// ─────────────────────────────────────────────────────────────────────
// Determine whether the last period in pnl.labels is the current
// in-progress month.
//
// Primary check (live data): compare lastAcctPeriod + lastPostYear
// against today's month + year.  acct_period is 1-based month number
// in Sage.
//
// Fallback (mock / no year info): compare the 3-letter month
// abbreviation of the last label against today.  This works as long
// as labels are formatted as 'Jan', 'Feb', ... 'Dec'.
// ─────────────────────────────────────────────────────────────────────
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function isLastMonthIncomplete(pnl) {
  if (!pnl.labels.length) return false
  const now = new Date()
  const curMonth = now.getMonth() + 1   // 1-based
  const curYear  = now.getFullYear()

  // Precise check using acct_period + post_year (live data)
  if (pnl.lastAcctPeriod && pnl.lastPostYear) {
    return pnl.lastAcctPeriod === curMonth && pnl.lastPostYear === curYear
  }

  // Fallback: label string match (mock data / no year fields)
  const lastLabel = pnl.labels[pnl.labels.length - 1]
  return lastLabel === MONTH_ABBR[curMonth - 1]
}

// ─────────────────────────────────────────────────────────────────────
// Chart.js plugin — draws a translucent red band behind the last
// column group when the month is incomplete.
//
// Uses x.getPixelForValue() to find the exact centre of the last tick,
// then spans exactly half the tick-spacing on each side so the band
// covers the full grouped-bar cluster regardless of bar count/width.
// ─────────────────────────────────────────────────────────────────────
const incompleteBandPlugin = {
  id: 'incompleteBand',
  // Run beforeDatasetsDraw so the band sits underneath the bars
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts.active) return
    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart
    const lastIdx = chart.data.labels.length - 1
    if (lastIdx < 0) return

    const xCenter  = x.getPixelForValue(lastIdx)
    const tickStep = lastIdx > 0
      ? xCenter - x.getPixelForValue(lastIdx - 1)
      : x.getPixelForValue(1) - xCenter
    const left  = xCenter - tickStep / 2
    const right = xCenter + tickStep / 2

    ctx.save()
    // Fill
    ctx.fillStyle = 'rgba(220, 70, 70, 0.12)'
    ctx.fillRect(left, top, right - left, bottom - top)
    // Dashed left border
    ctx.strokeStyle = 'rgba(220, 70, 70, 0.45)'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(left, top);  ctx.lineTo(left, bottom);  ctx.stroke()
    ctx.beginPath(); ctx.moveTo(right, top); ctx.lineTo(right, bottom); ctx.stroke()
    ctx.restore()
  },
}

export default function OpsPnlPage() {
  const { pnl, loading: _opsLoading } = useOpsData()
  const { period } = useOpsViewState()

  // ── Slice pnl arrays based on selected period ─────────────────────
  // pnl_monthly returns all months for the fiscal year (or available data).
  // MTD = current month only, QTD = current quarter, YTD = full year so far.
  const filteredPnl = useMemo(() => {
    if (!pnl.labels.length) return pnl
    const now      = new Date()
    const curMonth = now.getMonth() + 1   // 1-based
    const curYear  = now.getFullYear()
    const curQ     = Math.ceil(curMonth / 3)

    // Determine which indices to keep based on period
    let keepIndices = pnl.labels.map((_, i) => i)  // default: all (YTD)

    if (period === 'mtd') {
      // Only the current month — match by lastAcctPeriod if available
      // else match the last label (always current month)
      keepIndices = pnl.labels.reduce((acc, _, i) => {
        // Use acct_period from the raw rows if available via lastAcctPeriod
        // For now: keep only the last index (current/most recent month)
        if (i === pnl.labels.length - 1) acc.push(i)
        return acc
      }, [])
    } else if (period === 'qtd') {
      // Current quarter months: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
      const qStartMonth = (curQ - 1) * 3 + 1  // first month of current quarter
      const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      keepIndices = pnl.labels.reduce((acc, label, i) => {
        const mIdx = MONTH_ABBR.findIndex((m) => label.startsWith(m))
        const mNum = mIdx >= 0 ? mIdx + 1 : null
        if (mNum && mNum >= qStartMonth && mNum <= curMonth) acc.push(i)
        return acc
      }, [])
      // Fallback: last 3 indices if month matching fails
      if (!keepIndices.length) keepIndices = pnl.labels.map((_, i) => i).slice(-3)
    }
    // ytd: keep all

    const slice = (arr) => keepIndices.map((i) => arr[i] ?? 0)
    return {
      ...pnl,
      labels:  keepIndices.map((i) => pnl.labels[i]),
      revenue: slice(pnl.revenue),
      cogs:    slice(pnl.cogs),
      burden:  slice(pnl.burden),
      gp:      slice(pnl.gp),
      overhead:slice(pnl.overhead),
      net:     slice(pnl.net),
      gpPct:   slice(pnl.gpPct),
      priorRevenue: slice(pnl.priorRevenue || []),
      goalRevenue:  slice(pnl.goalRevenue  || []),
    }
  }, [pnl, period])

  const lastIdx       = filteredPnl.labels.length - 1
  const lastLabel     = filteredPnl.labels[lastIdx] ?? ''
  const monthPartial  = useMemo(() => isLastMonthIncomplete(filteredPnl), [pnl])

  const AXIS = 'rgba(255,255,255,0.82)'
  const GRID = 'rgba(240,192,64,0.14)'

  const data = {
    labels: filteredPnl.labels,
    datasets: [
      { type: 'bar',  label: 'Revenue',     data: filteredPnl.revenue,  backgroundColor: PALETTE.blue,   yAxisID: 'y' },
      { type: 'bar',  label: 'Direct Cost', data: filteredPnl.cogs,     backgroundColor: PALETTE.red,    yAxisID: 'y' },
      { type: 'bar',  label: 'Overhead',    data: filteredPnl.overhead, backgroundColor: PALETTE.amber,  yAxisID: 'y' },
      { type: 'line', label: 'Net Profit',  data: filteredPnl.net,      borderColor: PALETTE.purple,
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 2.5, yAxisID: 'y' },
      { type: 'line', label: 'GP Margin %', data: filteredPnl.gpPct,    borderColor: PALETTE.green,
        backgroundColor: 'transparent', borderDash: [4, 4], tension: 0.3, borderWidth: 2, yAxisID: 'y1' },
    ],
  }

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      // Pass active flag to the plugin so it only fires when needed
      incompleteBand: { active: monthPartial },
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: { color: 'rgba(255,255,255,0.95)', font: { size: 11 } },
      },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: (items) => {
            const label = items[0].label
            return monthPartial && label === lastLabel
              ? `${label}  ⚠ month in progress`
              : label
          },
          label: (ctx) => {
            if (ctx.datasetIndex !== 0) return null
            const i = ctx.dataIndex
            const lines = [
              `Revenue:     ${fmtK(filteredPnl.revenue[i])}`,
              `Direct Cost: ${fmtK(filteredPnl.cogs[i])}`,
              `GP $:        ${fmtK(filteredPnl.gp[i])}`,
              `GP margin %: ${pct(filteredPnl.gpPct[i])}`,
              `Overhead:    ${fmtK(filteredPnl.overhead[i])}`,
              `Net Profit:  ${fmtK(filteredPnl.net[i])}`,
            ]
            if (monthPartial && i === lastIdx) {
              lines.push('⚠ Partial month — figures not complete')
            }
            return lines
          },
        },
      },
    },
    scales: {
      x:  { grid: { display: false }, ticks: { color: AXIS, font: { size: 10 } } },
      y:  {
        position: 'left', grid: { color: GRID },
        ticks:    { color: AXIS, font: { size: 10 }, callback: (v) => fmtK(Number(v)) },
        title:    { display: true, text: '$', color: AXIS, font: { size: 10 } },
      },
      y1: {
        position: 'right', grid: { display: false },
        ticks:    { color: AXIS, font: { size: 10 }, callback: (v) => `${v}%` },
        suggestedMin: 0, suggestedMax: 35,
        title:    { display: true, text: '%', color: AXIS, font: { size: 10 } },
      },
    },
  }

  const totals = {
    rev:  filteredPnl.revenue.reduce((a, b) => a + b, 0),
    cogs: filteredPnl.cogs.reduce((a, b) => a + b, 0),
    gp:   filteredPnl.gp.reduce((a, b) => a + b, 0),
    oh:   filteredPnl.overhead.reduce((a, b) => a + b, 0),
    net:  filteredPnl.net.reduce((a, b) => a + b, 0),
  }
  const gpPct  = totals.rev ? (totals.gp  / totals.rev) * 100 : 0
  const netPct = totals.rev ? (totals.net / totals.rev) * 100 : 0


  if (_opsLoading) return <div style={{ padding: '40px 20px', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', textAlign: 'center' }}>Loading data…</div>

  return (
    <div>
      {/* KPI cards */}
      <div className="ops-grid-5">
        <OpsSectionCard title="Revenue">
          <div className="ops-kpi-value">{fmtK(totals.rev)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="Direct Cost">
          <div className="ops-kpi-value">{fmtK(totals.cogs)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="Gross Profit">
          <div className="ops-kpi-value">{fmtK(totals.gp)}</div>
          <div className="ops-small ops-text-dim">{pct(gpPct)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="Overhead">
          <div className="ops-kpi-value">{fmtK(totals.oh)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="Net Profit">
          <div className="ops-kpi-value">{fmtK(totals.net)}</div>
          <div className="ops-small ops-text-dim">{pct(netPct)}</div>
        </OpsSectionCard>
      </div>

      {/* Main chart */}
      <OpsSectionCard
        title="Revenue, Direct Cost, Overhead, Net Profit & GP %"
        subtitle={
          monthPartial
            ? `Hover any month for detail. Red band = ${lastLabel} is the current in-progress month — figures are partial.`
            : 'Hover any month — tooltip shows every series plus GP $ for the period.'
        }
        right={
          monthPartial ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
              background: 'rgba(220,70,70,0.12)',
              border: '1px solid rgba(220,70,70,0.4)',
              color: 'rgba(255,140,140,0.95)',
            }}>
              <span style={{ fontSize: '0.85rem' }}>⚠</span>
              {lastLabel} — month in progress
            </div>
          ) : null
        }
      >
        <OpsChartBox size="lg">
          <Chart
            type="bar"
            data={data}
            options={opts}
            plugins={[incompleteBandPlugin]}
          />
        </OpsChartBox>
      </OpsSectionCard>

      {/* Monthly detail table */}
      <OpsSectionCard
        title="Monthly detail"
        subtitle="Revenue, direct cost, labor burden (inside direct cost), gross profit, overhead, net profit."
      >
        <table className="ops-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="right">Revenue</th>
              <th className="right">Direct Cost</th>
              <th className="right">Burden</th>
              <th className="right">Gross Profit</th>
              <th className="right">GP %</th>
              <th className="right">Overhead</th>
              <th className="right">Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {filteredPnl.labels.map((m, i) => {
              const isPartial = monthPartial && i === lastIdx
              return (
                <tr
                  key={m}
                  style={isPartial ? { background: 'rgba(220,70,70,0.07)' } : undefined}
                >
                  <td>
                    {m}
                    {isPartial && (
                      <span style={{
                        marginLeft: 6, fontSize: '0.7rem', fontWeight: 600,
                        color: 'rgba(255,140,140,0.85)',
                        verticalAlign: 'middle',
                      }}>⚠ partial</span>
                    )}
                  </td>
                  <td className="right">{fmt(filteredPnl.revenue[i])}</td>
                  <td className="right">{fmt(filteredPnl.cogs[i])}</td>
                  <td className="right ops-text-dim">{fmt(filteredPnl.burden[i])}</td>
                  <td className="right">{fmt(filteredPnl.gp[i])}</td>
                  <td className="right">{pct(filteredPnl.gpPct[i])}</td>
                  <td className="right">{fmt(filteredPnl.overhead[i])}</td>
                  <td className={`right ${filteredPnl.net[i] >= 0 ? 'ops-text-pos' : 'ops-text-neg'}`}>
                    {fmt(filteredPnl.net[i])}
                  </td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--border-bright)', fontWeight: 700 }}>
              <td>Total</td>
              <td className="right">{fmt(totals.rev)}</td>
              <td className="right">{fmt(totals.cogs)}</td>
              <td className="right ops-text-dim">{fmt(filteredPnl.burden.reduce((a, b) => a + b, 0))}</td>
              <td className="right">{fmt(totals.gp)}</td>
              <td className="right">{pct(gpPct)}</td>
              <td className="right">{fmt(totals.oh)}</td>
              <td className={`right ${totals.net >= 0 ? 'ops-text-pos' : 'ops-text-neg'}`}>
                {fmt(totals.net)}
              </td>
            </tr>
          </tbody>
        </table>
      </OpsSectionCard>
    </div>
  )
}
