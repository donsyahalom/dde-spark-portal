import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── Grade code → full name ─────────────────────────────────────────────────
function expandGrade(code) {
  if (!code) return ''
  const prefixMap = {
    Pre:  'Pre-Apprentice',
    A:    'Apprentice',
    J:    'Journeyman',
    F:    'Foreman',
    P:    'Project Manager',
    O:    'Office',
  }
  // Special cases
  if (/^Owner$/i.test(code)) return 'Owner'
  // Match prefix + number, e.g. "J3", "Pre1", "P4"
  const m = code.match(/^([A-Za-z]+)(\d+)$/)
  if (m) {
    const prefix = m[1]
    const num = m[2]
    // Try exact prefix first, then uppercase
    const label = prefixMap[prefix] || prefixMap[prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()] || prefix
    return `${label} ${num}`
  }
  return code
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt$(n, decimals = 0) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPct(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toFixed(1) + '%'
}

// ── Stat tile ─────────────────────────────────────────────────────────────────
function Tile({ label, value, sub, color = 'var(--white-soft)' }) {
  return (
    <div style={{
      padding: '16px 18px', borderRadius: '10px',
      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
      minWidth: '140px',
    }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--white-dim)', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

// ── Range bar ─────────────────────────────────────────────────────────────────
function RangeBar({ value, min, max, label }) {
  if (!min && !max) return null
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0
  return (
    <div style={{ marginBottom: '10px' }}>
      {label && <div style={{ fontSize: '0.75rem', color: 'var(--white-dim)', marginBottom: '4px' }}>{label}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--white-dim)', minWidth: '60px' }}>{fmt$(min)}</span>
        <div style={{ flex: 1, height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'var(--gold)', borderRadius: '6px', transition: 'width 0.6s ease' }} />
          {value > 0 && (
            <div style={{
              position: 'absolute', left: `${pct}%`, top: '50%', transform: 'translate(-50%,-50%)',
              width: '14px', height: '14px', borderRadius: '50%',
              background: 'var(--gold)', border: '2px solid rgba(0,0,0,0.6)',
              boxShadow: '0 0 6px rgba(240,192,64,0.6)',
            }} />
          )}
        </div>
        <span style={{ fontSize: '0.78rem', color: 'var(--white-dim)', minWidth: '60px', textAlign: 'right' }}>{fmt$(max)}</span>
      </div>
      {value > 0 && (
        <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--gold)', marginTop: '4px' }}>
          Your position: {fmt$(value)} ({pct.toFixed(0)}% of range)
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function CompensationPage() {
  const { currentUser } = useAuth()
  const [emp, setEmp] = useState(null)
  const [settings, setSettings] = useState({})
  const [gradeCompMap, setGradeCompMap] = useState({})   // job_grade -> comp row
  const [gradeRespMap, setGradeRespMap] = useState({})   // job_grade -> responsibilities text
  const [systemGrades, setSystemGrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewGradeOffset, setViewGradeOffset] = useState(0)  // 0 = own, 1 = +1, 2 = +2

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    const [
      { data: empRow },
      { data: sData },
      { data: compRows },
      { data: respRows },
      { data: gradeListRows },
    ] = await Promise.all([
      supabase.from('employees').select('*').eq('id', currentUser.id).single(),
      supabase.from('settings').select('*'),
      supabase.from('perf_grade_compensation').select('*'),
      supabase.from('perf_grade_responsibilities').select('*'),
      supabase.from('custom_lists').select('value, sort_order').eq('list_type', 'job_grade').order('sort_order'),
    ])
    if (empRow) setEmp(empRow)
    if (sData) {
      const o = {}; sData.forEach(s => { o[s.key] = s.value }); setSettings(o)
    }
    if (compRows) {
      const m = {}; compRows.forEach(r => { m[r.job_grade] = r }); setGradeCompMap(m)
    }
    if (respRows) {
      const m = {}; respRows.forEach(r => { m[r.job_grade] = r.responsibilities }); setGradeRespMap(m)
    }
    setSystemGrades((gradeListRows || []).map(r => r.value))
    setLoading(false)
  }

  // ── Resolve effective visibility (employee override → global) ─────────────
  const resolveShow = (empField, settingKey) => {
    if (emp && emp[empField] !== null && emp[empField] !== undefined) return emp[empField]
    return settings[settingKey] === 'true' || settings[settingKey] === true
  }

  const showWage        = resolveShow('show_wage',         'show_wage')
  const showRange       = resolveShow('show_range',        'show_range')
  const showTargetBonus = resolveShow('show_target_bonus', 'show_target_bonus')
  const showBonusShare  = resolveShow('show_bonus_share',  'show_bonus_share')

  // ── Grade navigation ───────────────────────────────────────────────────────
  const myGradeIdx = useMemo(() => {
    if (!emp?.job_grade || systemGrades.length === 0) return -1
    return systemGrades.indexOf(emp.job_grade)
  }, [emp, systemGrades])

  const viewGrade = useMemo(() => {
    if (myGradeIdx < 0) return emp?.job_grade || null
    const targetIdx = Math.min(myGradeIdx + viewGradeOffset, systemGrades.length - 1)
    return systemGrades[targetIdx] || emp?.job_grade
  }, [myGradeIdx, viewGradeOffset, systemGrades, emp])

  const maxOffset = useMemo(() => {
    if (myGradeIdx < 0) return 0
    return Math.min(2, systemGrades.length - 1 - myGradeIdx)
  }, [myGradeIdx, systemGrades])

  const viewComp = gradeCompMap[viewGrade] || null
  const viewResp = gradeRespMap[viewGrade] || null

  // ── Compensation calculations ─────────────────────────────────────────────
  const vehicleRate    = parseFloat(settings.vehicle_hourly_rate || 7.74)
  const totalRevenue   = parseFloat(settings.total_revenue || 0)
  const targetMinimum  = parseFloat(settings.target_minimum || 0)
  const bonusSharePct  = parseFloat(settings.target_bonus_share_pct || 0)

  // Bonus pool = max(0, (revenue - minimum) * pct%)
  const bonusPool = Math.max(0, (totalRevenue - targetMinimum) * (bonusSharePct / 100))

  // Employee's own annual comp (for bonus calculations)
  const empWageType   = emp?.wage_type || 'hourly'
  const empWageAmount = parseFloat(emp?.wage_amount || 0)
  const empHasVehicle = emp?.has_company_vehicle || false
  const empTargetBonusPct  = parseFloat(emp?.target_bonus_pct || 0)
  const empBonusSharePct   = parseFloat(emp?.bonus_share_pct || 0)

  // Annual equivalent for current employee
  const empAnnualBase = empWageType === 'salary'
    ? empWageAmount
    : empWageAmount * 40 * 52   // 40h/wk × 52 weeks

  const vehicleAnnualValue = empHasVehicle
    ? vehicleRate * 40 * 52
    : 0

  const empTotalComp = empAnnualBase + vehicleAnnualValue

  // Target bonus dollar amount
  const empTargetBonusAmt = empWageType === 'salary'
    ? empAnnualBase * (empTargetBonusPct / 100)
    : empWageAmount * (empTargetBonusPct / 100)   // % of hourly rate (annual dollar TBD)

  // Bonus share dollar amount from pool
  const empBonusShareAmt = bonusPool * (empBonusSharePct / 100)

  // ── Grade comp for view level (used for range/compare) ────────────────────
  const gradeWageMin   = parseFloat(viewComp?.wage_min || 0)
  const gradeWageMax   = parseFloat(viewComp?.wage_max || 0)
  const gradeWageType  = viewComp?.wage_type || 'hourly'
  const gradeTargetBonusPct  = parseFloat(viewComp?.target_bonus_pct || 0)
  const gradeBonusSharePct   = parseFloat(viewComp?.bonus_share_pct || 0)

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--white-dim)' }}>
        <div className="spark-loader" style={{ margin: '0 auto 16px' }}></div>
        Loading compensation data…
      </div>
    )
  }

  const isViewingOwn = viewGradeOffset === 0
  const arrows = '→'.repeat(viewGradeOffset)
  const viewingLabel = isViewingOwn
    ? `My Grade — ${viewGrade} (${expandGrade(viewGrade)})`
    : `${arrows}${viewGrade} — ${expandGrade(viewGrade)}`

  return (
    <div className="fade-in">
      <h1 className="page-title">💵 My Pay & Compensation</h1>

      {/* ── Prominent grade display ── */}
      <div style={{
        marginBottom: '24px', padding: '20px 24px', borderRadius: '12px',
        background: 'rgba(240,192,64,0.07)', border: '1px solid rgba(240,192,64,0.3)',
      }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--white-dim)', marginBottom: '6px' }}>
          Your Current Grade
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 700,
          color: 'var(--gold)', letterSpacing: '0.06em', lineHeight: 1.1,
        }}>
          {emp?.job_grade || '—'}
        </div>
        <div style={{ fontSize: '1.15rem', color: 'var(--white-soft)', marginTop: '6px', fontWeight: 500 }}>
          {expandGrade(emp?.job_grade)}
        </div>
        {emp?.job_title && (
          <div style={{ fontSize: '0.88rem', color: 'var(--white-dim)', marginTop: '4px' }}>{emp.job_title}</div>
        )}
      </div>

      {/* ── Grade level toggle ── */}
      {maxOffset > 0 && (
        <div style={{
          marginBottom: '20px', padding: '12px 16px', borderRadius: '10px',
          background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.2)',
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--white-dim)', marginRight: '4px' }}>View level:</span>
          {[0, 1, 2].filter(o => o <= maxOffset).map(o => {
            const targetGrade = o === 0 ? emp?.job_grade : systemGrades[Math.min(myGradeIdx + o, systemGrades.length - 1)]
            const arrows = '→'.repeat(o)
            const label = o === 0
              ? `${emp?.job_grade} — ${expandGrade(emp?.job_grade)}`
              : `${arrows}${targetGrade} — ${expandGrade(targetGrade)}`
            return (
              <button
                key={o}
                className={`btn ${viewGradeOffset === o ? 'btn-gold' : 'btn-outline'} btn-sm`}
                onClick={() => setViewGradeOffset(o)}
                style={{ fontFamily: o > 0 ? 'var(--font-display)' : undefined, letterSpacing: o > 0 ? '0.04em' : undefined }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Banner when viewing a higher grade ── */}
      {!isViewingOwn && (
        <div style={{
          marginBottom: '20px', padding: '12px 16px', borderRadius: '10px',
          background: 'rgba(94,232,138,0.06)', border: '1px solid rgba(94,232,138,0.2)',
          fontSize: '0.85rem', color: 'var(--white-dim)',
        }}>
          👆 Showing expected compensation and responsibilities for <strong style={{ color: 'var(--green-bright)' }}>{viewGrade}</strong>.
          This is what you can expect at that level.
        </div>
      )}

      {/* ── Own compensation summary (always own grade) ── */}
      {(showWage || showTargetBonus || showBonusShare) && isViewingOwn && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-title">💵 My Compensation</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: showRange ? '16px' : 0 }}>
            {showWage && empWageAmount > 0 && (
              <Tile
                label={empWageType === 'hourly' ? 'My Hourly Rate' : 'My Annual Salary'}
                value={empWageType === 'hourly' ? `${fmt$(empWageAmount, 2)}/hr` : fmt$(empWageAmount)}
                color="var(--gold)"
              />
            )}
            {showWage && empHasVehicle && (
              <Tile
                label="Company Vehicle"
                value={`${fmt$(vehicleRate, 2)}/hr`}
                sub={`≈ ${fmt$(vehicleAnnualValue)}/yr`}
                color="var(--white-soft)"
              />
            )}
            {showWage && empWageAmount > 0 && (
              <Tile
                label="Total Comp (Est. Annual)"
                value={fmt$(empTotalComp)}
                sub={empHasVehicle ? 'Base + vehicle' : 'Base only'}
                color="var(--green-bright)"
              />
            )}
            {showTargetBonus && empTargetBonusPct > 0 && (
              <Tile
                label="Target Bonus"
                value={fmtPct(empTargetBonusPct)}
                sub={empTargetBonusAmt > 0 ? `≈ ${fmt$(empTargetBonusAmt)}` : undefined}
                color="var(--gold)"
              />
            )}
            {showBonusShare && empBonusSharePct > 0 && (
              <Tile
                label="Bonus Share"
                value={fmtPct(empBonusSharePct)}
                sub={empBonusShareAmt > 0 ? `≈ ${fmt$(empBonusShareAmt)} from pool` : (bonusPool <= 0 ? 'Pool not yet funded' : undefined)}
                color="var(--green-bright)"
              />
            )}
          </div>

          {/* Range bar — show own grade range */}
          {showRange && gradeWageMin > 0 && gradeWageMax > 0 && empWageAmount > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--white-dim)', marginBottom: '10px' }}>
                {emp?.job_grade} grade range ({gradeWageType === 'hourly' ? 'Hourly' : 'Annual Salary'}):
              </div>
              <RangeBar
                value={empWageAmount}
                min={gradeWageMin}
                max={gradeWageMax}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Grade info card ── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-title">
          📊 {viewingLabel} — Compensation Range
          {!isViewingOwn && <span style={{ fontSize: '0.78rem', color: 'var(--white-dim)', fontFamily: 'var(--font-body)', fontWeight: 400, marginLeft: '8px' }}>(preview)</span>}
        </div>

        {viewComp ? (
          <>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: gradeWageMin > 0 ? '16px' : 0 }}>
              <Tile
                label="Wage Type"
                value={gradeWageType === 'hourly' ? 'Hourly' : 'Salary'}
                color="var(--white-soft)"
              />
              {gradeWageMin > 0 && (
                <Tile
                  label={gradeWageType === 'hourly' ? 'Min Rate' : 'Min Salary'}
                  value={gradeWageType === 'hourly' ? `${fmt$(gradeWageMin, 2)}/hr` : fmt$(gradeWageMin)}
                  color="var(--white-dim)"
                />
              )}
              {gradeWageMax > 0 && (
                <Tile
                  label={gradeWageType === 'hourly' ? 'Max Rate' : 'Max Salary'}
                  value={gradeWageType === 'hourly' ? `${fmt$(gradeWageMax, 2)}/hr` : fmt$(gradeWageMax)}
                  color="var(--gold)"
                />
              )}
              {gradeTargetBonusPct > 0 && (
                <Tile
                  label="Target Bonus"
                  value={fmtPct(gradeTargetBonusPct)}
                  color="var(--green-bright)"
                />
              )}
              {gradeBonusSharePct > 0 && (
                <Tile
                  label="Bonus Share"
                  value={fmtPct(gradeBonusSharePct)}
                  color="var(--green-bright)"
                />
              )}
            </div>

            {gradeWageMin > 0 && gradeWageMax > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--white-dim)', marginBottom: '8px' }}>
                  {viewGrade} range:
                </div>
                <RangeBar
                  value={isViewingOwn ? empWageAmount : 0}
                  min={gradeWageMin}
                  max={gradeWageMax}
                />
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--white-dim)', fontSize: '0.85rem' }}>
            Compensation range not yet set for this grade. Contact your admin.
          </p>
        )}
      </div>

      {/* ── Job responsibilities ── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-title">
          📋 {viewingLabel} — Responsibilities
          {!isViewingOwn && <span style={{ fontSize: '0.78rem', color: 'var(--white-dim)', fontFamily: 'var(--font-body)', fontWeight: 400, marginLeft: '8px' }}>(preview)</span>}
        </div>

        {viewResp ? (
          <div style={{
            fontSize: '0.88rem', color: 'var(--white-soft)', lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
            background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '14px 16px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {viewResp}
          </div>
        ) : (
          <p style={{ color: 'var(--white-dim)', fontSize: '0.85rem' }}>
            Responsibilities have not been set for this grade yet.
          </p>
        )}
      </div>

      {/* ── Bonus pool info (if show_bonus_share and pool > 0) ── */}
      {showBonusShare && empBonusSharePct > 0 && bonusPool > 0 && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-title">🏆 Bonus Pool Breakdown</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <Tile label="Company Revenue" value={fmt$(totalRevenue)} color="var(--white-soft)" />
            <Tile label="Target Minimum" value={fmt$(targetMinimum)} color="var(--white-dim)" />
            <Tile label="Bonus Pool" value={fmt$(bonusPool)} sub={`${fmtPct(bonusSharePct)} of revenue above minimum`} color="var(--green-bright)" />
            <Tile
              label="Your Share"
              value={fmt$(empBonusShareAmt)}
              sub={`${fmtPct(empBonusSharePct)} of pool`}
              color="var(--gold)"
            />
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--white-dim)', lineHeight: 1.5 }}>
            Your bonus share is calculated as {fmtPct(empBonusSharePct)} of the total bonus pool.
            The pool is funded when company revenue exceeds {fmt$(targetMinimum)}.
          </p>
        </div>
      )}
    </div>
  )
}
