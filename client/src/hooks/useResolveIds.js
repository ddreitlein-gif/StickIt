import { useState, useEffect } from 'react'

/**
 * Resolves short_code URL params to full UUIDs via /api/resolve.
 * Accepts { event, judge, meet } — any combination.
 * Returns { eventId, judgeId, meetId, loading }.
 * If the param is already a UUID (length > 6), passes it through.
 */
export default function useResolveIds({ event, judge, meet } = {}) {
  const [resolved, setResolved] = useState({ eventId: null, judgeId: null, meetId: null, loading: true })

  useEffect(() => {
    if (!event && !judge && !meet) {
      setResolved({ eventId: null, judgeId: null, meetId: null, loading: false })
      return
    }

    const params = new URLSearchParams()
    if (event) params.set('event', event)
    if (judge) params.set('judge', judge)
    if (meet) params.set('meet', meet)

    fetch(`/api/resolve?${params}`)
      .then(r => r.json())
      .then(d => setResolved({ ...d, loading: false }))
      .catch(() => {
        // Fallback: use params as-is (they might already be UUIDs)
        setResolved({
          eventId: event || null,
          judgeId: judge || null,
          meetId: meet || null,
          loading: false,
        })
      })
  }, [event, judge, meet])

  return resolved
}
