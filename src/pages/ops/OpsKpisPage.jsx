import { useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'

// Per Don's directive: "remove all the ones that are there now and start
// fresh."  We removed the canned sparkline cards (revenue, GP, etc.) and
// the seeded custom KPIs entirely.  This page is now a blank slate where
// the team can add anything they care about — tool shrinkage, callback
// rate, safety hours, etc.
//
// State is in-memory only.  When we wire the ops_kpis settings table,
// we'll persist customs there with auth.email() as the owner.

export default function OpsKpisPage() {
  const [customName, setCustomName]   = useState('')
  const [customValue, setCustomValue] = useState('')
  const [customs, setCustoms]         = useState([])

  const addCustom = () => {
    if (!customName.trim() || !customValue.trim()) return
    setCustoms([...customs, { name: customName.trim(), value: customValue.trim() }])
    setCustomName('')
    setCustomValue('')
  }

  const removeCustom = (i) => {
    setCustoms(customs.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <OpsSectionCard
        title="KPIs"
        subtitle="Start fresh — add the metrics that matter for DuBaldo Electric. Free-form name, free-form value."
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div className="ops-stat-lbl" style={{ marginBottom: 4 }}>KPI name</div>
            <input
              className="ops-input"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Callback rate"
              style={{ width: 280 }}
              list="opsKpiSuggestions"
            />
            <datalist id="opsKpiSuggestions">
              <option value="PM:Field ratio" />
              <option value="Tool shrinkage $" />
              <option value="Callback rate" />
              <option value="Safety hours since last incident" />
              <option value="Submittal turnaround (days)" />
              <option value="RFIs open > 7 days" />
            </datalist>
          </div>
          <div>
            <div className="ops-stat-lbl" style={{ marginBottom: 4 }}>Value</div>
            <input
              className="ops-input"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="free-form"
              style={{ width: 200 }}
            />
          </div>
          <button className="btn btn-gold btn-sm" onClick={addCustom}>Add KPI</button>
        </div>

        {customs.length === 0 ? (
          <div className="ops-text-dim ops-small" style={{ padding: '12px 0' }}>
            No KPIs yet. Add one above to start tracking.
          </div>
        ) : (
          <div className="ops-grid-3">
            {customs.map((c, i) => (
              <div key={i} className="ops-kpi" style={{ position: 'relative' }}>
                <button
                  onClick={() => removeCustom(i)}
                  className="btn btn-outline btn-xs"
                  title="Remove KPI"
                  style={{ position: 'absolute', top: 8, right: 8, padding: '2px 6px', fontSize: '0.7rem' }}
                >
                  ×
                </button>
                <div className="ops-kpi-label">{c.name}</div>
                <div className="ops-kpi-value" style={{ fontSize: '1.3rem' }}>{c.value}</div>
              </div>
            ))}
          </div>
        )}
      </OpsSectionCard>
    </div>
  )
}
