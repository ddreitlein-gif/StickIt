import { useState, useEffect, useLayoutEffect } from 'react'
import api from '../../utils/api'

/**
 * v2.0.00 (Step 3, R4 / D10) — permanent overlay path: /overlay (no event
 * code), venue mode only. Always renders the athlete currently on course in
 * ANY event of the adopted meet by embedding the existing per-event overlay
 * (/overlay/:eventCode) and swapping it as the active event changes — unless
 * the operator pinned one event from the Scoring Computer. Entered ONCE into
 * the YoloBox; survives across meets and seasons. Transparent, zero chrome.
 */
export default function VenueOverlay() {
  const [target, setTarget] = useState(null)

  // Transparent canvas for the broadcast mixer — same rule as Overlay.jsx.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('background', 'transparent', 'important')
    document.body.style.setProperty('background', 'transparent', 'important')
    return () => {
      document.documentElement.style.removeProperty('background')
      document.body.style.removeProperty('background')
    }
  }, [])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const t = await api.venueRoleTarget('overlay')
        if (!alive) return
        setTarget(prev => (prev && prev.url === t.url ? prev : t))
      } catch (_) { /* keep last target — broadcast canvases never show errors */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  if (!target || target.error || !target.url) return null // silent on broadcast canvases

  return (
    <iframe
      key={target.url}
      src={target.url}
      title="venue-overlay"
      allowTransparency="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none', background: 'transparent' }}
    />
  )
}
