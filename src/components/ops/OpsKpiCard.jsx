export default function OpsKpiCard({ kpi }) {
  const tone = kpi.tone || 'neutral'
  return (
    <div className="ops-kpi">
      <div className="ops-kpi-label">{kpi.label}</div>
      <div className="ops-kpi-value">{kpi.value}</div>
      {kpi.delta ? <div className={`ops-kpi-delta ${tone}`}>{kpi.delta}</div> : null}
    </div>
  )
}
