import { useState } from 'react'
import OpsSectionCard from '../../components/ops/OpsSectionCard'
import { useOpsData } from '../../hooks/useOpsData'

const ALL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pnl',      label: 'Company P&L' },
  { id: 'jobs',     label: 'Jobs P&L' },
  { id: 'cashflow', label: 'Cashflow' },
  { id: 'ar',       label: 'A/R' },
  { id: 'ap',       label: 'A/P' },
  { id: 'kpis',     label: 'KPIs' },
  { id: 'perms',    label: 'Permissions' },
]

const ALL_FIELDS = [
  { id: 'revenue_dollar',  label: 'Hide Revenue $' },
  { id: 'gp_dollar',       label: 'Hide GP $' },
  { id: 'contract_amount', label: 'Hide Contract amount' },
  { id: 'bank_balance',    label: 'Hide Bank balances' },
  { id: 'overhead_net',    label: 'Hide Overhead + Net Profit' },
  { id: 'aging_90',        label: 'Hide 90+ aging' },
  { id: 'kpi_values',      label: 'Hide KPI values' },
]

export default function OpsPermissionsPage() {
  const { permUsers } = useOpsData()
  const [selected, setSelected] = useState(permUsers[0]?.sparksId ?? '')
  const [local, setLocal] = useState(
    Object.fromEntries(permUsers.map((u) => [u.sparksId, { ...u }])),
  )

  const user = local[selected]

  const update = (patch) =>
    setLocal((prev) => ({ ...prev, [selected]: { ...prev[selected], ...patch } }))

  const toggleTab = (tabId) => {
    const hidden = user.hiddenTabs.includes(tabId)
    update({
      hiddenTabs: hidden
        ? user.hiddenTabs.filter((t) => t !== tabId)
        : [...user.hiddenTabs, tabId],
    })
  }
  const toggleField = (fid) => {
    const hidden = user.hiddenFields.includes(fid)
    update({
      hiddenFields: hidden
        ? user.hiddenFields.filter((f) => f !== fid)
        : [...user.hiddenFields, fid],
    })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
      <div className="ops-userlist">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-bright)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)' }}>Users</div>
            <div className="ops-small ops-text-dim">Synced from DDE Sparks SSO</div>
          </div>
          <button className="btn btn-outline btn-xs">Sync now</button>
        </div>
        {Object.values(local).map((u) => (
          <button
            key={u.sparksId}
            onClick={() => setSelected(u.sparksId)}
            className={selected === u.sparksId ? 'active' : ''}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="name">{u.name}</div>
                <div className="meta">{u.email}</div>
              </div>
              <div className="role">{u.role}</div>
            </div>
            <div className="meta" style={{ marginTop: 4 }}>sparks: {u.sparksId}</div>
          </button>
        ))}
      </div>

      <div>
        {user ? (
          <>
            <OpsSectionCard
              title={user.name}
              subtitle={`${user.email} · sparks: ${user.sparksId}`}
              right={
                <select
                  className="ops-select"
                  value={user.role}
                  onChange={(e) => update({ role: e.target.value })}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="pm">Project manager</option>
                  <option value="finance">Finance</option>
                  <option value="viewer">Viewer</option>
                </select>
              }
            >
              <div>
                <div className="ops-stat-lbl" style={{ marginBottom: 8 }}>Profit-center scoping</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {['DDE', 'DCM', 'SILK'].map((pc) => (
                    <label key={pc} className="ops-checkbox">
                      <input
                        type="checkbox"
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
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="jobAccess"
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
                  value={(user.jobAccessList ?? []).join(', ')}
                  onChange={(e) => update({ jobAccessList: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="Job numbers, comma-separated (e.g. 2430, 2512)"
                  style={{ marginTop: 12, width: '100%' }}
                />
              )}
            </OpsSectionCard>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button className="btn btn-outline btn-sm">Discard</button>
              <button className="btn btn-gold btn-sm">Save changes</button>
            </div>
          </>
        ) : (
          <div className="ops-text-dim">Select a user.</div>
        )}
      </div>
    </div>
  )
}
