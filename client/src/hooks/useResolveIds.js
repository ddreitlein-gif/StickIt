import { useState, useEffect } from 'react'

/**
 * Resolves short_code URL params to full UUIDs via /api/resolve.
 * Accepts { event, judge, meet } — any combination.
 * Returns { eventId, judgeId, meetId, loading, resolveError }.
 * If the param is already a UUID (length > 6), passes it through.
 *
 * `resolveError` is true when:
 *  - the /api/resolve fetch failed (network error or non-2xx), OR
 *  - the API returned null for a requested ID (short-code didn't match
 *    a meet/event/judge), so callers can render a clear "not found"
 *    state instead of a blank page.
 */
export default function useResolveIds({ event, judge, meet } = {}) {
  const [resolved, setResolved] = useState({ eventId: null, judgeId: null, meetId: null, loading: true, resolveError: false })

  useEffect(() => {
    if (!event && !judge && !meet) {
      setResolved({ eventId: null, judgeId: null, meetId: null, loading: false, resolveError: false })
      return
    }

    const params = new URLSearchParams()
    if (event) params.set('event', event)
    if (judge) params.set('judge', judge)
    if (meet) params.set('meet', meet)

    fetch(`/api/resolve?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`resolve ${r.status}`)
        return r.json()
      })
      .then(d => {
        // If any requested ID came back null, the short-code didn't match.
        const failed =
          (event && !d.eventId) ||
          (judge && !d.judgeId) ||
          (meet && !d.meetId)
        setResolved({ ...d, loading: false, resolveError: !!failed })
      })
      .catch(() => {
        // Fallback: use params as-is (they might already be UUIDs) but flag
        // the error so callers can show a notice if the downstream fetch fails.
        setResolved({
          eventId: event || null,
          judgeId: judge || null,
          meetId: meet || null,
          loading: false,
          resolveError: true,
        })
      })
  }, [event, judge, meet])

  return resolved
}
