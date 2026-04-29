import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { sparkOpts } from '../../lib/opsChartOpts'

// Local persistence for custom KPIs until the server-side table lands.
// Schema note for the future DB migration:
//   kpi (
//     id uuid primary key,
//     name text not null,
//     kind text check (kind in ('single','timeseries')) not null,
//     value text,                     -- single: the display value
//     color text,                     -- optional accent color (timeseries)
//     created_at timestamptz default now(),
//     created_by uuid references employees(id)
//   )
//   kpi_point (
//     id uuid primary key,
//     kpi_id uuid references kpi(id) on delete cascade,
//     period text not null,           -- e.g. '2026-Q1', 'Jan 2026', week-start
//     value  numeric not null,
//     note   text
//   )
const LS_KEY = 'dde.ops.customKpis.v2'

// Accent colors cycle through this palette so each time-series KPI card
// has its own hue without forcing the user to pick one.
const TS_COLORS = ['#6FA8FF', '#5EE88A', '#F0C040', '#C08AFF', '#E05555', '#F59E0B']

function loadCustoms() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  // Seed defaults on first load — old data points from the mockup.
  return [
    { kind: 'single', name: 'Tools lost per quarter', value: '$2,140' },
    { kind: 'single', name: 'RFIs open > 7 days',     value: '3' },
  ]
}
function saveCustoms(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch {}
}

// Parse any value-ish input ("$1,240", "3.5%", "42") into a number for
// charting.  If no digits present, returns null and that point is dropped.
function toNumber(v) {
  if (v == null) return null
  const s = String(v).replace(/[$,%\s]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function OpsKpisPage() {
  const { kpiSparks } = useOpsData()

  // Persisted custom-KPI list.
  const [customs, setCustoms] = useState(loadCustoms)
  useEffect(() => { saveCustoms(customs) }, [customs])

  // ── Add-KPI form state ────────────────────────────────────────
  //   newKind   : 'single' | 'timeseries'
  //   newName   : KPI label
  //   newValue  : single-mode display value
  //   newPoints : timeseries rows — array of { period, value }
  const [newKind, setNewKind]   = useState('single')
  const [newName, setNewName]   = useState('')
  const [newValue, setNewValue] = useState('')
  const [newPoints, setNewPoints] = useState([
    { period: '', value: '' },
    { period: '', value: '' },
  ])

  const addPointRow = () => setNewPoints([...newPoints, { period: '', value: '' }])
  const updatePointRow = (idx, patch) =>
    setNewPoints(newPoints.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  const removePointRow = (idx) =>
    setNewPoints(newPoints.filter((_, i) => i !== idx))

  const resetForm = () => {
    setNewName('')
    setNewValue('')
    setNewPoints([{ period: '', value: '' }, { period: '', value: '' }])
  }

  const addKpi = () => {
    if (!newName.trim()) return
    if (newKind === 'single') {
      if (!newValue.trim()) return
      setCustoms([...customs, { kind: 'single', name: newName.trim(), value: newValue.trim() }])
    } else {
      const cleaned = newPoints
        .map((p) => ({ period: p.period.trim(), value: p.value.trim() }))
        .filter((p) => p.period && p.value)
      if (!cleaned.length) return
      const color = TS_COLORS[customs.filter((c) => c.kind === 'timeseries').length % TS_COLORS.length]
      setCustoms([
        ...customs,
        { kind: 'timeseries', name: newName.trim(), points: cleaned, color },
      ])
    }
    resetForm()
  }

  const removeKpi = (idx) =>
    setCustoms(customs.filter((_, i) => i !== idx))

  return (
    <div>
      {/*
        Top row — built-in sparked KPIs from the mock data source.  These
        are the company-level metrics the whole org sees.
      */}
      <div
        className="ops-kpi-top"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        {kpiSparks.map((k) => (
          <OpsSectionCard key={k.id} title={k.label}>
            <div className="ops-kpi-value" style={{ fontSize: '1.7rem', marginBottom: 10 }}>{k.value}</div>
            <OpsChartBox size="sm">
              <Line
                data={{
                  labels: k.data.map((_, i) => String(i)),
                  datasets: [{
                    data: k.data,
                    borderColor: k.color,
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    borderWidth: 2,
                  }],
                }}
                options={sparkOpts}
              />
            </OpsChartBox>
          </OpsSectionCard>
        ))}
      </div>

      <OpsSectionCard
        title="Custom KPIs"
        subtitle="Track anything — tool shrinkage, callback rate, safety hours. Single-value or multi-period time series. Time-series entries render as their own sparkline."
      >
        {/* ── Add KPI form ────────────────────────────────────── */}
        <div
          style={{
            padding: 14,
            border: '1px solid var(--border-bright)',
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div className="ops-toggle" role="group" aria-label="KPI kind" style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setNewKind('single')}
              className={newKind === 'single' ? 'active' : ''}
            >Single value</button>
            <button
              type="button"
              onClick={() => setNewKind('timeseries')}
              className={newKind === 'timeseries' ? 'active' : ''}
            >Time series</button>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: newKind === 'timeseries' ? 12 : 0 }}>
            <div>
              <div className="ops-stat-lbl" style={{ marginBottom: 4 }}>KPI name</div>
              <input
                className="ops-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. PM:Field ratio"
                style={{ width: 260 }}
                list="opsKpiSuggestions"
              />
              <datalist id="opsKpiSuggestions">
                <option value="PM:Field ratio" />
                <option value="Tool shrinkage $" />
                <option value="Callback rate" />
                <option value="Safety hours since last incident" />
                <option value="Submittal turnaround (days)" />
              </datalist>
            </div>
            {newKind === 'single' && (
              <>
                <div>
                  <div className="ops-stat-lbl" style={{ marginBottom: 4 }}>Value</div>
                  <input
                    className="ops-input"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="free-form (e.g. $2,140 or 34%)"
                    style={{ width: 220 }}
                  />
                </div>
                <button className="btn btn-gold btn-sm" onClick={addKpi}>Add KPI</button>
              </>
            )}
          </div>

          {newKind === 'timeseries' && (
            <>
              <div className="ops-small ops-text-dim" style={{ marginBottom: 6 }}>
                Each row is one data point (e.g. month, quarter, or week).
                Value must be numeric — currency / % symbols are stripped automatically.
              </div>
              <table className="ops-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Value</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {newPoints.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="ops-input"
                          style={{ width: '100%' }}
                          value={p.period}
                          onChange={(e) => updatePointRow(i, { period: e.target.value })}
                          placeholder="e.g. 2026-Q1, Mar 2026, Wk 04-17"
                        />
                      </td>
                      <td>
                        <input
                          className="ops-input"
                          style={{ width: '100%' }}
                          value={p.value}
                          onChange={(e) => updatePointRow(i, { value: e.target.value })}
                          placeholder="e.g. 34, 2.4%, $18,500"
                        />
                      </td>
                      <td>
                        <button
                          className="ops-btn ghost"
                          onClick={() => removePointRow(i)}
                          disabled={newPoints.length <= 1}
                        >Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="ops-btn ghost" onClick={addPointRow}>+ Add point</button>
                <button className="btn btn-gold btn-sm" onClick={addKpi}>Save KPI</button>
              </div>
            </>
          )}
        </div>

        {/* ── Rendered custom KPIs ─────────────────────────────── */}
        {customs.length === 0 ? (
          <div className="ops-small ops-text-dim">No custom KPIs yet. Add one above.</div>
        ) : (
          <div className="ops-grid-3">
            {customs.map((c, i) => {
              if (c.kind === 'timeseries') {
                const labels = c.points.map((p) => p.period)
                const data   = c.points.map((p) => toNumber(p.value))
                const last   = c.points[c.points.length - 1]
                return (
                  <div key={i} className="ops-kpi" style={{ position: 'relative' }}>
                    <div className="ops-kpi-label">{c.name}</div>
                    <div className="ops-kpi-value" style={{ fontSize: '1.3rem', marginBottom: 6 }}>
                      {last?.value ?? '—'}
                      <span className="ops-small ops-text-dim" style={{ marginLeft: 8, fontWeight: 400 }}>
                        ({last?.period})
                      </span>
                    </div>
                    <OpsChartBox size="sm">
                      <Line
                        data={{
                          labels,
                          datasets: [{
                            data,
                            borderColor: c.color || TS_COLORS[0],
                            backgroundColor: 'transparent',
                            tension: 0.3,
                            borderWidth: 2,
                          }],
                        }}
                        options={sparkOpts}
                      />
                    </OpsChartBox>
                    <button
                      className="ops-btn ghost"
                      onClick={() => removeKpi(i)}
                      style={{ position: 'absolute', top: 6, right: 6, fontSize: '0.7rem', padding: '2px 8px' }}
                      aria-label={`Remove ${c.name}`}
                    >×</button>
                  </div>
                )
              }
              // single-value KPI
              return (
                <div key={i} className="ops-kpi" style={{ position: 'relative' }}>
                  <div className="ops-kpi-label">{c.name}</div>
                  <div className="ops-kpi-value" style={{ fontSize: '1.3rem' }}>{c.value}</div>
                  <button
                    className="ops-btn ghost"
                    onClick={() => removeKpi(i)}
                    style={{ position: 'absolute', top: 6, right: 6, fontSize: '0.7rem', padding: '2px 8px' }}
                    aria-label={`Remove ${c.name}`}
                  >×</button>
                </div>
              )
            })}
          </div>
        )}
      </OpsSectionCard>
    </div>
  )
}
