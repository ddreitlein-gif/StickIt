export default function AthleteBar({ bib, name, meta = [], right = null, className = '' }) {
  return (
    <div className={`tablet-athlete-bar ${className}`}>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          {bib != null && bib !== '' && <span className="tablet-bib">#{bib}</span>}
          <span className="tablet-athlete-name truncate">{name || '—'}</span>
        </div>
        {meta.length > 0 && (
          <div className="tablet-athlete-meta">
            {meta.map((m, i) =>
              typeof m === 'string'
                ? <span key={i}>{m}</span>
                : <span key={i}>{m}</span>
            )}
          </div>
        )}
      </div>
      {right && <div className="flex items-center gap-3 flex-shrink-0">{right}</div>}
    </div>
  )
}
