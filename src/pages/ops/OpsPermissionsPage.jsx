import { useState, useEffect } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'
import { useAuth } from '../../context/AuthContext'

// Permissions tab — Don's directive:
//   "it should read based on the admin > permissions and see who has
//    permissions to see that tab. Those people should all be listed
//    on the dashboard permissions tab."
//
// We back this with ops.dashboard_users, which is auto-projected from
// public.employees (the same table the OpsRoute guard checks).  Anyone
// with is_admin = TRUE or job_grade = 'Owner' shows up here.
//
// Empty-state UI: if no users come back (deploy hasn't applied the
// patch yet, or no admins/owners exist) we tell the user how to fix it.

const ALL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pnl',      label: 'Company P&L' },
  { id: 'jobs',     label: 'Jobs P&L' },
  { id: 'cashflow', label: 'Cashflow' },
  { id: 'ar',       label: 'A/R' },
  { id: 'ap',       label: 'A/P' },
  { id: 'payroll',  label: 'Payroll' },
  { id: 'kpis',     label: 'KPIs' },
  { id: 'perms',    label: 'Permissions' },
]

const ALL_FIELDS = [
  // Headline financial numbers
  { id: 'revenue_dollar',     label: 'Hide Revenue $' },
  { id: 'gp_dollar',          label: 'Hide GP $' },
  { id: 'gp_percent',         label: 'Hide GP %' },
  { id: 'direct_cost',        label: 'Hide Direct Cost $' },
  { id: 'contract_amount',    label: 'Hide Contract amount' },
  { id: 'bank_balance',       label: 'Hide Bank balances' },
  { id: 'overhead_net',       label: 'Hide Overhead + Net Profit' },
  // Cost bucket breakdown
  { id: 'cost_buckets',       label: 'Hide Cost bucket split' },
  { id: 'labor_hours',        label: 'Hide Labor hours' },
  // Productivity / earned value
  { id: 'productivity',       label: 'Hide Productivity / earned-value' },
  { id: 'rev_per_field_hr',   label: 'Hide Revenue per field hour' },
  // Retainage
  { id: 'retainage_held',     label: 'Hide Retainage held' },
  { id: 'retainage_due',      label: 'Hide Retainage due schedule' },
  // A/R
  { id: 'aging_90',           label: 'Hide 90+ aging' },
  { id: 'ar_email',           label: 'Hide Weekly A/R email settings' },
  // POs / work orders
  { id: 'po_list',            label: 'Hide PO list' },
  { id: 'po_outstanding',     label: 'Hide PO outstanding $' },
  { id: 'work_orders',        label: 'Hide Service work-orders' },
  // Payroll
  { id: 'payroll_detail',     label: 'Hide Payroll register detail' },
  { id: 'payroll_rates',      label: 'Hide Employee pay rates' },
  // KPIs
  { id: 'kpi_values',         label: 'Hide KPI values' },
]

export default function OpsPermissionsPage() {
  const { permUsers, refresh } = useOpsData()
  const { currentUser } = useAuth()
  const isAdmin = Boolean(currentUser?.is_admin)

  // Local working copy keyed by sparksId.  Re-seeded whenever
  // permUsers changes (e.g. after Sync now / refresh).
  const [local, setLocal] = useState({})
  const [selected, setSelected] = useState('')

  useEffect(() => {
    const next = Object.fromEntries(
      (permUsers || []).map((u) => [u.sparksId, { ...u }]),
    )
    setLocal(next)
    setSelected((prev) => (prev && next[prev]) ? prev : (permUsers?.[0]?.sparksId ?? ''))
  }, [permUsers])

  const user = local[selected]

  const update = (patch) =>
    setLocal((prev) => ({ ...prev, [selected]: { ...prev[selected], ...patch } }))

  const toggleTab = (tabId) => {
    if (!user) return
    const hidden = user.hiddenTabs.includes(tabId)
    update({
      hiddenTabs: hidden
        ? user.hiddenTabs.filter((t) => t !== tabId)
        : [...user.hiddenTabs, tabId],
    })
  }
  const toggleField = (fid) => {
    if (!user) return
    const hidden = user.hiddenFields.includes(fid)
    update({
      hiddenFields: hidden
        ? user.hiddenFields.filter((f) => f !== fid)
        : [...user.hiddenFields, fid],
    })
  }

  // ── Empty state — no users came back from ops.dashboard_users ──
  if (!permUsers || permUsers.length === 0) {
    return (
      <OpsSectionCard
        title="Permissions"
        subtitle="Auto-listed from Sparks portal admins and owners."
      >
        <div style={{ padding: '20px 4px' }}>
          <div className="ops-text-dim" style={{ marginBottom: 8 }}>
            No users have access to the ops dashboard yet.
          </div>
          <div className="ops-small ops-text-dim">
            This list is auto-built from the Sparks portal's admin / Owner roster.
            If someone should appear here, set them to <strong>admin</strong> or
            <strong>&nbsp;Owner</strong> in <em>Admin → Permissions</em> on the main portal.
          </div>
          <button
            className="btn btn-outline btn-sm"
            style={{ marginTop: 12 }}
            onClick={() => refresh && refresh()}
          >
            Refresh
          </button>
        </div>
      </OpsSectionCard>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
      <div className="ops-userlist">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-bright)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)' }}>Users</div>
            <div className="ops-small ops-text-dim">Auto-listed from admins + Owners</div>
          </div>
          <button className="btn btn-outline btn-xs" onClick={() => refresh && refresh()}>
            Refresh
          </button>
        </div>
        {Object.values(local).map((u) => (
          <button
            key={u.sparksId}
            onClick={() => setSelected(u.sparksId)}
            className={selected === u.sparksId ? 'active' : ''}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="name">{u.name || u.email}</div>
                <div className="meta">{u.email}</div>
              </div>
              <div className="role">{u.role}</div>
            </div>
          </button>
        ))}
      </div>

      <div>
        {user ? (
          <>
            <OpsSectionCard
              title={user.name || user.email}
              subtitle={`${user.email} · role: ${user.role}`}
              right={
                !isAdmin ? (
                  <span className="ops-small ops-text-dim">Read-only — admin to edit</span>
                ) : null
              }
            >
              <div>
                <div className="ops-stat-lbl" style={{ marginBottom: 8 }}>Profit-center scoping</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {['DDE', 'DCM', 'SILK'].map((pc) => (
                    <label key={pc} className="ops-checkbox">
                      <input
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={user.pcs.includes(pc)}
                        onChange={() => {
                          const on = user.pcs.includes(pc)
                          update({ pcs: on ? user.pcs.filter((p) => p !== pc) : [...user.pcs, pc] })
                        }}
                      />
                      {pc}
                    </label>
                  ))}
                </div>
              </div>
            </OpsSectionCard>

            <OpsSectionCard title="Tab visibility" subtitle="Uncheck any tab to hide it for this user.">
              <div className="ops-grid-4">
                {ALL_TABS.map((t) => (
                  <label key={t.id} className="ops-checkbox">
                    <input
                      type="checkbox"
                      disabled={!isAdmin}
                      checked={!user.hiddenTabs.includes(t.id)}
                      onChange={() => toggleTab(t.id)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </OpsSectionCard>

            <OpsSectionCard title="Field masking" subtitle="Toggle to redact specific numbers even on visible tabs.">
              <div className="ops-grid-2">
                {ALL_FIELDS.map((f) => (
                  <label key={f.id} className="ops-checkbox">
                    <input
                      type="checkbox"
                      disabled={!isAdmin}
                      checked={user.hiddenFields.includes(f.id)}
                      onChange={() => toggleField(f.id)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </OpsSectionCard>

            <OpsSectionCard title="Job-level access">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'all',       label: 'All jobs in their profit centers' },
                  { id: 'assigned',  label: "Only jobs where they're listed as PM/lead" },
                  { id: 'whitelist', label: 'Whitelist specific jobs' },
                  { id: 'blacklist', label: 'All jobs except a blacklist' },
                ].map((o) => (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: isAdmin ? 'pointer' : 'not-allowed' }}>
                    <input
                      type="radio"
                      name="jobAccess"
                      disabled={!isAdmin}
                      checked={user.jobAccess === o.id}
                      onChange={() => update({ jobAccess: o.id })}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
              {(user.jobAccess === 'whitelist' || user.jobAccess === 'blacklist') && (
                <input
                  className="ops-input"
                  disabled={!isAdmin}
                  value={(user.jobAccessList ?? []).join(', ')}
                  onChange={(e) => update({ jobAccessList: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="Job numbers, comma-separated (e.g. 2430, 2512)"
                  style={{ marginTop: 12, width: '100%' }}
                />
              )}
            </OpsSectionCard>

            {isAdmin && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button className="btn btn-outline btn-sm">Discard</button>
                <button className="btn btn-gold btn-sm">Save changes</button>
              </div>
            )}
          </>
        ) : (
          <div className="ops-text-dim">Select a user.</div>
        )}
      </div>
    </div>
  )
}
