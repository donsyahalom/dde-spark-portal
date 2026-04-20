import { useEffect } from 'react'
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

// Fixed-height wrapper + lazy Chart.js registration.  The mockup learned
// the hard way that <canvas> without a height and maintainAspectRatio:
// false grows forever; the `.ops-chart` CSS gives every chart a
// deterministic box.

let registered = false
function ensureRegistered() {
  if (registered) return
  ChartJS.register(
    ArcElement,
    BarElement,
    CategoryScale,
    Filler,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
  )
  registered = true
}

export default function OpsChartBox({ size = 'lg', children, className = '' }) {
  useEffect(() => { ensureRegistered() }, [])
  return (
    <div className={`ops-chart ${size} ${className}`.trim()}>
      {children}
    </div>
  )
}
