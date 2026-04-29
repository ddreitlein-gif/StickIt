import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

const DIVISIONS = ['Alaska', 'Northwest', 'Far West', 'Intermountain', 'Rocky', 'Central', 'Eastern', 'National Event', 'Other']

const STATUS_STYLE = {
  active:   { cls: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'In Progress' },
  complete: { cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Complete' },
  setup:    { cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30', label: 'Setup' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.setup
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>
      {status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
      {s.label}
    </span>
  )
}

function disciplineLabel(d) {
  if (d === 'dual_mogul') return 'Dual Moguls'
  if (d === 'aerials') return 'Aerials'
  return 'Moguls'
}

export default function LiveScores() {
  const [meets, setMeets] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [division, setDivision] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedMeets, setExpandedMeets] = useState(new Set())

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 10 })
    if (division) params.set('division', division)
    fetch(`/api/meets/livescores?${params}`)
      .then(r => r.json())
      .then(data => {
        setMeets(data.meets || [])
        setTotalPages(data.totalPages || 1)
      })
      .catch(() => setMeets([]))
      .finally(() => setLoading(false))
  }, [page, division])

  const handleDivisionChange = (val) => {
    setDivision(val)
    setPage(1)
  }

  const toggleMeet = (meetId) => {
    setExpandedMeets(prev => {
      const next = new Set(prev)
      if (next.has(meetId)) next.delete(meetId)
      else next.add(meetId)
      return next
    })
  }

  return (
    <div className="min-h-screen" style={{ background: '#0a1628', fontFamily: "'Barlow', sans-serif", color: '#e8f0f8' }}>
      {/* Header */}
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-4">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1.5">
            <span>&larr;</span> Home
          </Link>
          <h1 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase">
            Live Scores
          </h1>
          <div className="w-16" />
        </div>

        {/* Division Filter */}
        <div className="flex items-center gap-3 mb-6">
          <label className="text-xs text-slate-400 uppercase tracking-wider font-medium">Division:</label>
          <select
            className="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500 backdrop-blur"
            value={division}
            onChange={e => handleDivisionChange(e.target.value)}
          >
            <option value="">All Divisions</option>
            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Meets List */}
      <div className="max-w-4xl mx-auto px-4 pb-8">
        {loading ? (
          <div className="text-center py-16 text-slate-500">Loading...</div>
        ) : meets.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            {division ? 'No meets found for this division.' : 'No meets found.'}
          </div>
        ) : (
          <div className="space-y-4">
            {meets.map(meet => {
              const isExpanded = expandedMeets.has(meet.id)
              const eventCount = meet.events ? meet.events.length : 0
              return (
                <div key={meet.id} className="rounded-xl border border-slate-700/50 bg-slate-800/30 backdrop-blur overflow-hidden">
                  {/* Meet Header — clickable to toggle */}
                  <button
                    onClick={() => toggleMeet(meet.id)}
                    className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-slate-700/20 transition-colors"
                  >
                    <div>
                      <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-lg font-semibold tracking-wide text-white">
                        {meet.name}
                      </h2>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        <span>{meet.location}</span>
                        <span>{new Date(meet.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        {meet.meet_ranking && <span className="text-slate-500">{meet.meet_ranking}</span>}
                        {!isExpanded && <span className="text-slate-500">{eventCount} event{eventCount !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <span className={`text-slate-400 text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                  </button>

                  {/* Events — collapsible */}
                  {isExpanded && (
                    <>
                      {eventCount > 0 ? (
                        <div className="divide-y divide-slate-700/20 border-t border-slate-700/30">
                          {meet.events.map(event => (
                            <Link
                              key={event.id}
                              to={`/scoreboard/${event.short_code || event.id}`}
                              className="flex items-center justify-between px-5 py-3 hover:bg-slate-700/20 transition-colors"
                            >
                              <div>
                                <span className="text-sm text-white font-medium">{event.name}</span>
                                <span className="ml-3 text-xs text-slate-500">{disciplineLabel(event.discipline)}</span>
                              </div>
                              <StatusBadge status={event.status} />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="px-5 py-3 text-xs text-slate-500 border-t border-slate-700/30">No events</div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
