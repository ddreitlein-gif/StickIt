// Sidebar reference panel — generic. Caller supplies sections, each containing
// rows of {label, value, swatch?}. Color of swatch/label is driven by the
// `quality` field which maps to one of: ex / gd / av / mg / po.
const SWATCH_COLOR = {
  ex: '#4ade80',
  gd: '#86efac',
  av: '#fbbf24',
  mg: '#fb923c',
  po: '#f87171',
}

// Slide-03 component-column reference pills — a horizontal row of small
// colored badges (Excellent/Good/Adequate/Poor) shown at the bottom of each
// component scoring column.
export function RefPillRow({ pills = [] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map((p, i) => (
        <span
          key={i}
          className={`tablet-ref-pill q-${p.quality || 'av'}`}
        >
          <strong>{p.label}</strong>
          {p.range && <span className="range">{p.range}</span>}
        </span>
      ))}
    </div>
  )
}

export default function ReferencePanel({ title, sections = [], width = 260, className = '' }) {
  return (
    <div className={`tablet-ref-panel ${className}`} style={{ width, flexShrink: 0 }}>
      {title && <div className="tablet-ref-title">{title}</div>}
      {sections.map((s, si) => (
        <div key={si} className="flex flex-col gap-2">
          {si > 0 && <div className="tablet-divider" />}
          {s.heading && (
            <div
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: 'var(--tablet-dim)' }}
            >
              {s.heading}
            </div>
          )}
          {s.rows && s.rows.map((r, ri) => (
            <div key={ri} className="tablet-ref-row">
              <span className="rl">
                {r.swatch && (
                  <span
                    className="swatch"
                    style={{ background: SWATCH_COLOR[r.quality] || r.swatch }}
                  />
                )}
                <span className={r.quality ? `q-${r.quality}` : ''}>{r.label}</span>
              </span>
              {r.value && <span className="rr">{r.value}</span>}
            </div>
          ))}
          {s.bullets && (
            <ul className="text-xs space-y-1" style={{ color: 'var(--tablet-dim)' }}>
              {s.bullets.map((b, bi) => (
                <li key={bi} className="flex gap-2">
                  <span style={{ color: 'var(--tablet-muted)' }}>•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
