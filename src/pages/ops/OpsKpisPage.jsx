import { useState } from 'react'
import { Line } from 'react-chartjs-2'
import OpsChartBox from '../../components/ops/OpsChartBox'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { sparkOpts } from '../../lib/opsChartOpts'

export default function OpsKpisPage() {
  const { kpiSparks } = useOpsData()
  const [customName, setCustomName]   = useState('')
  const [customValue, setCustomValue] = useState('')
  const [customs, setCustoms] = useState([
    { name: 'Tools lost per quarter', value: '$2,140' },
    { name: 'RFIs open > 7 days',     value: '3' },
  ])

  const addCustom = () => {
    if (!customName.trim() || !customValue.trim()) return
    setCustoms([...customs, { name: customName.trim(), value: customValue.trim() }])
    setCustomName('')
    setCustomValue('')
  }

  return (
    <div>
      <div className="ops-grid-3">
        {kpiSparks.map((k) => (
          <OpsSectionCard key={k.id} title={k.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div className="ops-kpi-value" style={{ fontSize: '1.4rem' }}>{k.value}</div>
              <div style={{ width: 160 }}>
                <OpsChartBox size="spark">
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
              </div>
            </div>
          </OpsSectionCard>
        ))}
      </div>

      <OpsSectionCard
        title="Custom KPIs"
        subtitle="Track anything — tool shrinkage, callback rate, safety hours. Free-form name, free-form value."
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div className="ops-stat-lbl" style={{ marginBottom: 4 }}>KPI name</div>
            <input
              className="ops-input"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
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

        <div className="ops-grid-3">
          {customs.map((c, i) => (
            <div key={i} className="ops-kpi">
              <div className="ops-kpi-label">{c.name}</div>
              <div className="ops-kpi-value" style={{ fontSize: '1.3rem' }}>{c.value}</div>
            </div>
          ))}
        </div>
      </OpsSectionCard>
    </div>
  )
}
