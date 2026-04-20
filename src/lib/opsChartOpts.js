// Shared Chart.js option presets.  All ops charts run on a dark background
// so axis/grid colors differ from the original Tailwind-light scaffold.

import { fmtK } from './opsFormat'

const AXIS   = 'rgba(255,255,255,0.55)' // --white-dim
const GRID   = 'rgba(240,192,64,0.10)'  // faint gold lines on dark
const LEGEND = 'rgba(255,255,255,0.85)' // --white-soft

export const moneyLineOpts = (overrides = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'top',
      align: 'end',
      labels: { color: LEGEND, font: { size: 11 } },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const label = ctx.dataset.label || ''
          const val = ctx.parsed.y
          return `${label}: ${fmtK(val)}`
        },
      },
    },
    ...(overrides.plugins || {}),
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: AXIS, font: { size: 10 } } },
    y: {
      position: 'left',
      grid: { color: GRID },
      ticks: { color: AXIS, font: { size: 10 }, callback: (v) => fmtK(Number(v)) },
    },
    ...(overrides.scales || {}),
  },
  ...overrides,
})

export const sparkOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  elements: { point: { radius: 0 } },
}

// Colors chosen to read on the dark green + gold background
export const PALETTE = {
  blue:   '#6FA8FF',
  red:    '#E05555',
  green:  '#5EE88A',
  gold:   '#F0C040',
  purple: '#C08AFF',
  amber:  '#F59E0B',
  dim:    'rgba(255,255,255,0.55)',
}
