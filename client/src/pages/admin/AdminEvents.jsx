import { useState, useEffect, useMemo } from 'react'
import { authHeaders, checkApiResponse } from '../../utils/api'

function disciplineLabel(d) {
  if (d === 'dual_mogul') return 'Dual Moguls'
  if (d === 'aerials') return 'Aerials'
  return 'Moguls'
}

export default function AdminEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedMeets, setExpandedMeets] = useState(new Set())
  const [search, setSearch] = useState('')

  const fetchEvents = () => {
    setLoading(true)
    fetch('/api/admin/events', { headers: authHeaders() })
      .then(checkApiResponse)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }

  useEffect(fetchEvents, [])

  const toggleLock = async (event) => {
    const action = event.locked ? 'unlock' : 'lock'
    await fetch(`/api/admin/events/${event.id}/${action}`, { method: 'PUT', headers: authHeaders() })
    fetchEvents()
  }

  const toggleLockAll = async (meet, shouldLock) => {
    // v1.25.00 (B-5) — confirm bulk lock changes
    const n = meet.events.length
    const verb = shouldLock ? 'Lock' : 'Unlock'
    if (!window.confirm(`${verb} all ${n} event${n !== 1 ? 's' : ''} in ${meet.meet_name}?`)) return
    const action = shouldLock ? 'lock-all' : 'unlock-all'
    await fetch(`/api/admin/meets/${meet.meet_id}/${action}`, { method: 'PUT', headers: authHeaders() })
    fetchEvents()
  }

  // v1.25.02 — hide/show events on the public Live Scores listing (independent of lock)
  const toggleHide = async (event) => {
    const action = event.hide_livescores ? 'show' : 'hide'
    await fetch(`/api/admin/events/${event.id}/${action}`, { method: 'PUT', headers: authHeaders() })
    fetchEvents()
  }

  const toggleHideAll = async (meet, shouldHide) => {
    const n = meet.events.length
    const verb = shouldHide ? 'Hide' : 'Show'
    if (!window.confirm(`${verb} all ${n} event${n !== 1 ? 's' : ''} in ${meet.meet_name} on Live Scores?`)) return
    const action = shouldHide ? 'hide-all' : 'show-all'
    await fetch(`/api/admin/meets/${meet.meet_id}/${action}`, { method: 'PUT', headers: authHeaders() })
    fetchEvents()
  }

  // v1.25.00 (B-9b) — deliberately re-open a finalized event
  const [reopenMsg, setReopenMsg] = useState('')
  const reopenEvent = async (event) => {
    if (!window.confirm(`Re-open "${event.name}"? Its status returns to In Progress so scores can be corrected. The event will need to be finalized again.`)) return
    setReopenMsg('')
    const r = await fetch(`/api/admin/events/${event.id}/reopen`, { method: 'POST', headers: authHeaders() })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setReopenMsg(d.error || 'Re-open failed')
    } else {
      setReopenMsg(`Re-opened "${event.name}".`)
    }
    fetchEvents()
  }

  const toggleMeet = (meetId) => {
    setExpandedMeets(prev => {
      const next = new Set(prev)
      if (next.has(meetId)) next.delete(meetId)
      else next.add(meetId)
      return next
    })
  }

  // Group events by meet, preserving server sort order (date DESC)
  const meetGroups = useMemo(() => {
    const map = new Map()
    for (const e of events) {
      if (!map.has(e.meet_id)) {
        map.set(e.meet_id, { meet_id: e.meet_id, meet_name: e.meet_name, meet_date: e.meet_date, meet_location: e.meet_location, events: [] })
      }
      map.get(e.meet_id).events.push(e)
    }
    let groups = [...map.values()]
    // v1.25.00 (B-5) — client-side search over meet + event names
    const t = search.trim().toLowerCase()
    if (t) {
      groups = groups
        .map(g => {
          const meetHit = (g.meet_name || '').toLowerCase().includes(t)
          const evs = meetHit ? g.events : g.events.filter(e => (e.name || '').toLowerCase().includes(t))
          return evs.length ? { ...g, events: evs } : null
        })
        .filter(Boolean)
    }
    return groups
  }, [events, search])

  return (
    <div>
      <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white mb-2">
        Event Management
      </h2>
      {/* v1.25.00 (B-5) — explain what locking does */}
      <p className="text-xs text-slate-400 mb-4">
        Locked events are hidden from the Officials dashboard and reject all changes. They remain visible on public scoreboards.
        Hidden events do not appear on the public Live Scores page or the Viewer API list, but direct scoreboard links still work.
        Locking and hiding are independent — an event can be either, both, or neither.
      </p>
      <input
        type="text"
        placeholder="Search meets and events…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-md bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 mb-4"
      />
      {reopenMsg && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-blue-900/30 border border-blue-700/50 text-blue-200 text-sm">{reopenMsg}</div>
      )}

      {loading ? (
        <div className="text-slate-500 py-8 text-center">Loading...</div>
      ) : meetGroups.length === 0 ? (
        <div className="text-slate-500 py-8 text-center">No events found.</div>
      ) : (
        <div className="space-y-4">
          {meetGroups.map(meet => {
            const isExpanded = expandedMeets.has(meet.meet_id)
            const allLocked = meet.events.every(e => e.locked)
            const someLocked = meet.events.some(e => e.locked)
            const allHidden = meet.events.every(e => e.hide_livescores)
            const someHidden = meet.events.some(e => e.hide_livescores)
            return (
              <div key={meet.meet_id} className="rounded-xl border border-slate-700/50 overflow-hidden">
                {/* Meet Header */}
                <div className="flex items-center justify-between bg-slate-800/80 px-4 py-3">
                  <button
                    onClick={() => toggleMeet(meet.meet_id)}
                    className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                  >
                    <span className={`text-slate-400 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    <div>
                      <span className="text-white font-medium text-sm">{meet.meet_name}</span>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span>{meet.meet_date}</span>
                        {!isExpanded && <span>{meet.events.length} event{meet.events.length !== 1 ? 's' : ''}</span>}
                        {!isExpanded && someLocked && (
                          <span className="text-amber-400">{allLocked ? 'All locked' : 'Partially locked'}</span>
                        )}
                        {!isExpanded && someHidden && (
                          <span className="text-purple-400">{allHidden ? 'Hidden from Live Scores' : 'Partially hidden from Live Scores'}</span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleLockAll(meet, !allLocked)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        allLocked
                          ? 'text-green-400 hover:bg-green-500/20 border border-green-500/30'
                          : 'text-amber-400 hover:bg-amber-500/20 border border-amber-500/30'
                      }`}
                    >
                      {allLocked ? 'Unlock All' : 'Lock All'}
                    </button>
                    <button
                      onClick={() => toggleHideAll(meet, !allHidden)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        allHidden
                          ? 'text-green-400 hover:bg-green-500/20 border border-green-500/30'
                          : 'text-purple-400 hover:bg-purple-500/20 border border-purple-500/30'
                      }`}
                    >
                      {allHidden ? 'Show All' : 'Hide All'}
                    </button>
                  </div>
                </div>

                {/* Events Table — collapsible */}
                {isExpanded && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-800/40 text-left">
                        <th className="px-4 py-2 text-xs text-slate-400 uppercase tracking-wider font-medium">Event</th>
                        <th className="px-4 py-2 text-xs text-slate-400 uppercase tracking-wider font-medium">Discipline</th>
                        <th className="px-4 py-2 text-xs text-slate-400 uppercase tracking-wider font-medium">Status</th>
                        <th className="px-4 py-2 text-xs text-slate-400 uppercase tracking-wider font-medium">Lock</th>
                        <th className="px-4 py-2 text-xs text-slate-400 uppercase tracking-wider font-medium">Live Scores</th>
                        <th className="px-4 py-2 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {meet.events.map(event => (
                        <tr key={event.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 text-white font-medium">{event.name}</td>
                          <td className="px-4 py-3 text-slate-300">{disciplineLabel(event.discipline)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              event.status === 'active' ? 'bg-green-500/20 text-green-400' :
                              event.status === 'complete' ? 'bg-blue-500/20 text-blue-400' :
                              'bg-slate-500/20 text-slate-400'
                            }`}>
                              {event.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {event.locked ? (
                              <span className="text-amber-400 text-sm" title="Locked">&#128274;</span>
                            ) : (
                              <span className="text-slate-500 text-sm" title="Unlocked">&#128275;</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {event.hide_livescores ? (
                              <span className="text-purple-400 text-xs font-medium" title="Hidden from Live Scores">Hidden</span>
                            ) : (
                              <span className="text-slate-500 text-xs" title="Visible on Live Scores">Visible</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {event.status === 'complete' && (
                              <button
                                onClick={() => reopenEvent(event)}
                                className="mr-2 px-3 py-1 rounded text-xs font-medium text-blue-400 hover:bg-blue-500/20 border border-blue-500/30 transition-colors"
                              >
                                Re-open
                              </button>
                            )}
                            <button
                              onClick={() => toggleLock(event)}
                              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                event.locked
                                  ? 'text-green-400 hover:bg-green-500/20 border border-green-500/30'
                                  : 'text-amber-400 hover:bg-amber-500/20 border border-amber-500/30'
                              }`}
                            >
                              {event.locked ? 'Unlock' : 'Lock'}
                            </button>
                            <button
                              onClick={() => toggleHide(event)}
                              className={`ml-2 px-3 py-1 rounded text-xs font-medium transition-colors ${
                                event.hide_livescores
                                  ? 'text-green-400 hover:bg-green-500/20 border border-green-500/30'
                                  : 'text-purple-400 hover:bg-purple-500/20 border border-purple-500/30'
                              }`}
                            >
                              {event.hide_livescores ? 'Show' : 'Hide'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
