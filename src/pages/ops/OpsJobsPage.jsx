import { useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import OpsChartBox from '../../components/ops/OpsChartBox'
import { useOpsData } from '../../hooks/useOpsData'
import { useAuth } from '../../context/AuthContext'
import { moneyLineOpts, PALETTE } from '../../lib/opsChartOpts'
import { fmt, fmtK, pct } from '../../lib/opsFormat'

// Jobs P&L — Don's directives, all in one page:
//
//   1. Per-row Contract/Service override.  "the admin should be able to
//      set that. Nobody else. It should persist to all users once the
//      admin makes a change."  Implemented via setJobTypeOverride()
//      from the hook, which writes to ops.job_type_overrides.  Non-
//      admins see the chip but the dropdown is disabled.  Once a
//      change is saved, refresh() pulls the override back through
//      ops.jobs and ops.ar_invoices so AR re-buckets too.
//
//   2. Top-10 contributors on Direct Cost.  Hover any bar in the
//      Direct Cost chart and the tooltip shows the top 10 cost
//      buckets (labor / material / sub / equip / other) for that job
//      ordered by $ contribution.
//
//   3. Split company productivity + revenue/field-hour into Contract
//      vs Service columns.  We compute earned-value style metrics
//      (revenue per field hour, GP per field hour) for the contract
//      pool and the service pool separately and render two cards
//      side-by-side.

export default function OpsJobsPage() {
  const { jobs, setJobTypeOverride, clearJobTypeOverride, refresh } = useOpsData()
  const { currentUser } = useAuth()
  const isAdmin = Boolean(currentUser?.is_admin)
  const adminEmail = currentUser?.email || null

  const [savingKey, setSavingKey] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [showService, setShowService] = useState(true)
  const [showContract, setShowContract] = useState(true)

  const filtered = useMemo(() => {
    let rows = jobs || []
    if (!showContract) rows = rows.filter((j) => j.type === 'service')
    if (!showService)  rows = rows.filter((j) => j.type !== 'service')
    if (q.trim()) {
      const needle = q.toLowerCase()
      rows = rows.filter((j) =>
        (j.name || '').toLowerCase().includes(needle) ||
        (j.num || '').toString().toLowerCase().includes(needle))
    }
    return rows
  }, [jobs, q, showContract, showService])

  // ── Top-N by Direct Cost, with breakdown for the tooltip ──
  const topByDirectCost = useMemo(() => {
    return (filtered || [])
      .slice()
      .sort((a, b) => (b.directCost || 0) - (a.directCost || 0))
      .slice(0, 10)
  }, [filtered])

  const dcChartData = {
    labels: topByDirectCost.map((j) => `${j.num} · ${j.name?.slice(0, 18) || ''}`),
    datasets: [
      { label: 'Labor',     data: topByDirectCost.map((j) => j.laborCost     || 0), backgroundColor: 'rgba(111,168,255,0.65)', borderColor: PALETTE.blue,  borderWidth: 1, stack: 'dc' },
      { label: 'Material',  data: topByDirectCost.map((j) => j.materialCost  || 0), backgroundColor: 'rgba(76,175,80,0.65)',   borderColor: PALETTE.green, borderWidth: 1, stack: 'dc' },
      { label: 'Subcontract', data: topByDirectCost.map((j) => j.subCost     || 0), backgroundColor: 'rgba(255,193,7,0.65)',   borderColor: '#ffc107',     borderWidth: 1, stack: 'dc' },
      { label: 'Equipment', data: topByDirectCost.map((j) => j.equipCost     || 0), backgroundColor: 'rgba(156,39,176,0.65)',  borderColor: '#9c27b0',     borderWidth: 1, stack: 'dc' },
      { label: 'Other',     data: topByDirectCost.map((j) => j.otherCost     || 0), backgroundColor: 'rgba(229,57,53,0.55)',   borderColor: PALETTE.red,   borderWidth: 1, stack: 'dc' },
    ],
  }

  const dcChartOpts = moneyLineOpts({
    plugins: {
      tooltip: {
        // Custom: show top-10 contributors (cost buckets) ranked by $
        // for the hovered job.
        callbacks: {
          title: (items) => {
            if (!items?.length) return ''
            const j = topByDirectCost[items[0].dataIndex]
            return j ? `${j.num} — ${j.name}` : ''
          },
          label: () => '',
          afterBody: (items) => {
            if (!items?.length) return []
            const j = topByDirectCost[items[0].dataIndex]
            if (!j) return []
            const buckets = [
              { label: 'Labor',     value: j.laborCost     || 0 },
              { label: 'Material',  value: j.materialCost  || 0 },
              { label: 'Subcontract', value: j.subCost     || 0 },
              { label: 'Equipment', value: j.equipCost     || 0 },
              { label: 'Other',     value: j.otherCost     || 0 },
            ]
              .filter((b) => b.value !== 0)
              .sort((a, b) => b.value - a.value)
              .slice(0, 10)
            const total = buckets.reduce((a, b) => a + b.value, 0) || 1
            const lines = buckets.map((b) =>
              `  ${b.label.padEnd(12, ' ')} ${fmtK(b.value)}  (${pct(b.value / total)})`,
            )
            return [
              `Total direct cost: ${fmtK(j.directCost || 0)}`,
              '',
              'Top contributors:',
              ...lines,
            ]
          },
        },
      },
    },
    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } },
  })

  // ── Productivity split: contract vs service ──
  const prodSummary = useMemo(() => {
    const split = (rows) => {
      const fieldHrs = rows.reduce((a, j) => a + (j.fieldHours || 0), 0)
      const revenue  = rows.reduce((a, j) => a + (j.revenue    || 0), 0)
      const gp       = rows.reduce((a, j) => a + (j.gp         || 0), 0)
      const earned   = rows.reduce((a, j) => a + (j.earnedValue || 0), 0)
      const directCost = rows.reduce((a, j) => a + (j.directCost || 0), 0)
      return {
        rows: rows.length,
        fieldHrs,
        revenue,
        gp,
        gpPct:           revenue > 0 ? (gp / revenue) * 100 : 0,
        revPerFieldHr:   fieldHrs > 0 ? revenue / fieldHrs : 0,
        gpPerFieldHr:    fieldHrs > 0 ? gp / fieldHrs : 0,
        earned,
        directCost,
        productivityPct: earned > 0 ? (earned / Math.max(directCost, 1)) * 100 : null,
      }
    }
    const contract = split((jobs || []).filter((j) => j.type !== 'service'))
    const service  = split((jobs || []).filter((j) => j.type === 'service'))
    return { contract, service }
  }, [jobs])

  const onTypeChange = async (job, nextType) => {
    if (!isAdmin) return
    if (!setJobTypeOverride || !clearJobTypeOverride) {
      setErr('Override API not available — patch_features.sql may not be applied yet.')
      return
    }
    const key = `${job.source_company}::${job.job_recnum}`
    setSavingKey(key)
    setErr(null)
    try {
      // 'auto' clears the override; any other value sets it.
      if (nextType === 'auto') {
        await clearJobTypeOverride({
          source_company: job.source_company,
          job_recnum:     job.job_recnum,
        })
      } else {
        await setJobTypeOverride({
          source_company: job.source_company,
          job_recnum:     job.job_recnum,
          override_type:  nextType,        // 'contract' | 'service'
          set_by_email:   adminEmail,
        })
      }
      if (refresh) await refresh()
    } catch (e) {
      console.error(e)
      setErr(e.message || 'Failed to save override')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div>
      {/* Productivity split */}
      <div className="ops-grid-2">
        <ProductivityCard title="Contract productivity" data={prodSummary.contract} accent="contract" />
        <ProductivityCard title="Service productivity"  data={prodSummary.service}  accent="service"  />
      </div>

      <OpsSectionCard
        title="Direct cost — top 10 jobs"
        subtitle="Hover a bar to see the top contributing cost buckets for that job."
      >
        <OpsChartBox size="lg">
          <Bar data={dcChartData} options={dcChartOpts} />
        </OpsChartBox>
      </OpsSectionCard>

      <OpsSectionCard
        title="Jobs"
        subtitle={
          isAdmin
            ? 'Click the type cell on any row to override Contract↔Service. Persists for everyone.'
            : 'Type column reflects the current Contract/Service classification (admin-controlled).'
        }
        right={
          <div className="ops-toolbar">
            <label className="ops-checkbox" style={{ marginRight: 8 }}>
              <input type="checkbox" checked={showContract} onChange={(e) => setShowContract(e.target.checked)} />
              Contract
            </label>
            <label className="ops-checkbox" style={{ marginRight: 8 }}>
              <input type="checkbox" checked={showService}  onChange={(e) => setShowService(e.target.checked)} />
              Service
            </label>
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search job name / #"
              style={{ width: 240 }}
            />
          </div>
        }
      >
        {err && (
          <div className="ops-text-neg ops-small" style={{ marginBottom: 8 }}>
            {err}
          </div>
        )}
        <table className="ops-table">
          <thead>
            <tr>
              <th>Job #</th>
              <th>Name</th>
              <th>Type</th>
              <th className="right">Contract $</th>
              <th className="right">Revenue</th>
              <th className="right">Direct cost</th>
              <th className="right">GP</th>
              <th className="right">GP %</th>
              <th className="right">% complete</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((j) => {
              const key = `${j.source_company}::${j.job_recnum}`
              const isService  = j.type === 'service'
              const overridden = Boolean(j.typeOverridden)
              const currentSel = overridden ? (isService ? 'service' : 'contract') : 'auto'
              const gpClass = (j.gpPct || 0) < 10 ? 'ops-text-warn' : (j.gpPct || 0) < 0 ? 'ops-text-neg' : ''
              return (
                <tr key={key}>
                  <td style={{ fontWeight: 600 }}>{j.num}</td>
                  <td>{j.name}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        className="ops-input"
                        value={currentSel}
                        disabled={savingKey === key}
                        onChange={(e) => onTypeChange(j, e.target.value)}
                        style={{ padding: '2px 6px', fontSize: '0.8rem' }}
                        title={overridden ? 'Admin override — click to change' : 'Auto-classified — click to override'}
                      >
                        <option value="auto">Auto</option>
                        <option value="contract">Contract</option>
                        <option value="service">Service</option>
                      </select>
                    ) : (
                      <span className={`chip ${isService ? 'hold' : 'active'}`} title={overridden ? 'Admin-overridden' : 'Auto-classified'}>
                        {isService ? 'Service' : 'Contract'}
                        {overridden ? ' *' : ''}
                      </span>
                    )}
                  </td>
                  <td className="right">{fmt(j.contractAmount)}</td>
                  <td className="right">{fmt(j.revenue)}</td>
                  <td className="right">{fmt(j.directCost)}</td>
                  <td className="right" style={{ fontWeight: 600 }}>{fmt(j.gp)}</td>
                  <td className={`right ${gpClass}`}>{Math.round(j.gpPct || 0)}%</td>
                  <td className="right">{Math.round((j.pctComplete || 0) * 100)}%</td>
                </tr>
              )
            })}
            {!filtered.length && (
              <tr><td colSpan={9} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                No jobs match the current filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </OpsSectionCard>
    </div>
  )
}

// ── Helper presentational card for the contract/service productivity split ──
function ProductivityCard({ title, data, accent }) {
  const cls = accent === 'service' ? 'hold' : 'active'
  return (
    <OpsSectionCard
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {title}
          <span className={`chip ${cls}`}>{accent === 'service' ? 'Service' : 'Contract'}</span>
        </span>
      }
      subtitle={`${data.rows} job${data.rows === 1 ? '' : 's'} in scope.`}
    >
      <div className="ops-grid-2">
        <div className="ops-kpi">
          <div className="ops-kpi-label">Revenue</div>
          <div className="ops-kpi-value">{fmtK(data.revenue)}</div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label">GP</div>
          <div className="ops-kpi-value">{fmtK(data.gp)}</div>
          <div className="ops-small ops-text-dim">{Math.round(data.gpPct)}%</div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label">Field hours</div>
          <div className="ops-kpi-value">{Math.round(data.fieldHrs).toLocaleString()}</div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label">Revenue / field hr</div>
          <div className="ops-kpi-value">{data.fieldHrs > 0 ? fmt(data.revPerFieldHr) : '—'}</div>
          <div className="ops-small ops-text-dim">
            GP / field hr: {data.fieldHrs > 0 ? fmt(data.gpPerFieldHr) : '—'}
          </div>
        </div>
      </div>
      {data.productivityPct != null && (
        <div className="ops-small ops-text-dim" style={{ marginTop: 8 }}>
          Earned-value productivity: <strong>{Math.round(data.productivityPct)}%</strong>
          {' '}(earned ${fmtK(data.earned)} on direct cost ${fmtK(data.directCost)})
        </div>
      )}
    </OpsSectionCard>
  )
}
