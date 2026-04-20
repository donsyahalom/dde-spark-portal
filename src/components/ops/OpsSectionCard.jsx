// Generic titled card.  Header can show a right-aligned control (e.g. a
// basis selector) via the `right` prop.
export default function OpsSectionCard({ title, subtitle, right, children, className = '' }) {
  const hasHead = title || right || subtitle
  return (
    <div className={`ops-card ${className}`.trim()}>
      {hasHead && (
        <div className="ops-card-head">
          <div>
            {title ? <div className="ops-card-title">{title}</div> : null}
            {subtitle ? <div className="ops-card-sub">{subtitle}</div> : null}
          </div>
          {right}
        </div>
      )}
      <div className="ops-card-body">{children}</div>
    </div>
  )
}
