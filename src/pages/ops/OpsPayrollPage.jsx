import { useMemo, useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { fmt, fmtK } from '../../lib/opsFormat'

// Payroll page — Don's directives:
//   1. "remove per diem entirely. DDE does not pay per diem." → no
//      perDiem column, no perDiem KPI card, no perDiem in totals.
//   2. "i want a button that models OT proportionally across the jobs
//      a tech worked, instead of dumping all of it onto the last job."
//      → "Model OT" button calls loadModeledOt() and we apply the
//      result client-side via applyModeledOt().  Toggle off to revert
//      to raw Sage allocation.
//
// We keep an in-memory toggle (`modeled`) so the user can flip back
// and forth.  When modeled is on we render `linesModeled`; otherwise
// we render the raw `payrollLines` from Sage.

const COLUMNS = [
  { id: 'employee',    label: 'Employee',    align: 'left',  fmt: (v) => v },
  { id: 'job',         label: 'Job',         align: 'left',  fmt: (v) => v },
  { id: 'weekEnding',  label: 'Week ending', align: 'left',  fmt: (v) => v },
  { id: 'regHrs',      label: 'Reg hrs',     align: 'right', fmt: (v) => (v || 0).toFixed(2) },
  { id: 'otHrs',       label: 'OT hrs',      align: 'right', fmt: (v) => (v || 0).toFixed(2) },
  { id: 'regPay',      label: 'Reg pay',     align: 'right', fmt: (v) => fmt(v) },
  { id: 'otPay',       label: 'OT pay',      align: 'right', fmt: (v) => fmt(v) },
  { id: 'burden',      label: 'Burden',      align: 'right', fmt: (v) => fmt(v) },
  { id: 'totalCost',   label: 'Total cost',  align: 'right', fmt: (v) => fmt(v) },
]

const SUM_FIELDS = ['regHrs', 'otHrs', 'regPay', 'otPay', 'burden', 'totalCost']

export default function OpsPayrollPage() {
  const { payrollLines, loadModeledOt, applyModeledOt } = useOpsData()
  const [modeled, setModeled] = useState(false)
  const [modeledRows, setModeledRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')

  // The lines we actually render.  When `modeled` is on AND we have
  // a successful modeled response, we project it via applyModeledOt.
  const lines = useMemo(() => {
    if (modeled && modeledRows && applyModeledOt) {
      try {
        return applyModeledOt(payrollLines || [], modeledRows)
      } catch (e) {
        // If projection blows up, fall back to raw.
        console.error('applyModeledOt failed', e)
        return payrollLines || []
      }
    }
    return payrollLines || []
  }, [modeled, modeledRows, payrollLines, applyModeledOt])

  const filtered = useMemo(() => {
    if (!q.trim()) return lines
    const needle = q.toLowerCase()
    return lines.filter((r) =>
      (r.employee || '').toLowerCase().includes(needle) ||
      (r.job || '').toLowerCase().includes(needle))
  }, [lines, q])

  const totals = useMemo(() => {
    const t = Object.fromEntries(SUM_FIELDS.map((f) => [f, 0]))
    for (const r of filtered) for (const f of SUM_FIELDS) t[f] += r[f] || 0
    return t
  }, [filtered])

  const onModelOt = async () => {
    if (!loadModeledOt) {
      setErr('Modeled-OT loader not available in this build.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const rows = await loadModeledOt()
      setModeledRows(rows || [])
      setModeled(true)
    } catch (e) {
      console.error(e)
      setErr(e.message || 'Failed to load modeled OT')
    } finally {
      setBusy(false)
    }
  }

  const onRevert = () => {
    setModeled(false)
  }

  return (
    <div>
      <div className="ops-grid-4">
        <OpsSectionCard title="Reg hours">
          <div className="ops-kpi-value">{totals.regHrs.toFixed(0)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="OT hours">
          <div className="ops-kpi-value">{totals.otHrs.toFixed(0)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="Total payroll cost">
          <div className="ops-kpi-value">{fmtK(totals.totalCost)}</div>
        </OpsSectionCard>
        <OpsSectionCard title="OT % of hours">
          <div className="ops-kpi-value">
            {totals.regHrs + totals.otHrs > 0
              ? Math.round((totals.otHrs / (totals.regHrs + totals.otHrs)) * 100)
              : 0}%
          </div>
        </OpsSectionCard>
      </div>

      <OpsSectionCard
        title="Payroll register"
        subtitle={
          modeled
            ? 'OT is being modeled — distributed proportionally across the jobs each tech worked that week, instead of dumped on the last job.'
            : 'Raw Sage allocation. Click "Model OT" to redistribute overtime proportionally across each tech\'s jobs for the week.'
        }
        right={
          <div className="ops-toolbar">
            {modeled ? (
              <button
                className="btn btn-outline btn-sm"
                onClick={onRevert}
                title="Revert to raw Sage allocation"
              >
                Revert to raw
              </button>
            ) : (
              <button
                className="btn btn-gold btn-sm"
                onClick={onModelOt}
                disabled={busy}
                title="Distribute OT proportionally across each tech's jobs"
              >
                {busy ? 'Modeling…' : 'Model OT'}
              </button>
            )}
            <input
              className="ops-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employee / job"
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
              {COLUMNS.map((c) => (
                <th key={c.id} className={c.align === 'right' ? 'right' : ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={(r.employee || '') + (r.weekEnding || '') + (r.job || '') + i}>
                {COLUMNS.map((c) => (
                  <td
                    key={c.id}
                    className={c.align === 'right' ? 'right' : ''}
                    style={c.id === 'employee' || c.id === 'totalCost' ? { fontWeight: 600 } : undefined}
                  >
                    {c.fmt(r[c.id])}
                  </td>
                ))}
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={COLUMNS.length} className="center ops-text-dim" style={{ padding: '24px 0' }}>
                  No payroll lines match the current filters.
                </td>
              </tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 700 }}>Totals</td>
                {SUM_FIELDS.map((f) => {
                  const col = COLUMNS.find((c) => c.id === f)
                  return (
                    <td key={f} className="right" style={{ fontWeight: 700 }}>
                      {col ? col.fmt(totals[f]) : totals[f]}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </OpsSectionCard>
    </div>
  )
}
