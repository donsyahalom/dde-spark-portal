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

// Register Chart.js components at module-load time.  Registering inside a
// useEffect runs too late — the <Line>/<Bar> children in this wrapper are
// rendered before the parent's effect fires, so the chart tries to build
// with an unregistered "category" scale and crashes the whole page.
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

// Fixed-height wrapper for every chart.  `.ops-chart` CSS gives a
// deterministic box so Chart.js' maintainAspectRatio:false doesn't grow
// the canvas forever.
export default function OpsChartBox({ size = 'lg', children, className = '' }) {
  return (
    <div className={`ops-chart ${size} ${className}`.trim()}>
      {children}
    </div>
  )
}
